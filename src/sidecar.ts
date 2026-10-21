// ============================================================
// Python sidecar bridge.
//
// The PSD pipeline lives in Python because that is where the mature PSD and
// bin-packing libraries are (psd-tools, Pillow, rectpack). It is called as a
// child process with one JSON request on stdin and one JSON response on
// stdout — deliberately not as a second MCP server, so the execution layer
// keeps a single tool surface and a single place that enforces capability
// gates and path safety.
//
// Diagnostics from the sidecar go to stderr, which is surfaced in error
// details rather than parsed.
// ============================================================

import { join } from 'node:path';

import { SpineHost } from './host';
import { SpineErrorCode, SpineResult, err, ok } from './types';

/** Protocol version this bridge speaks. */
export const SIDECAR_PROTOCOL_VERSION = 1;

/** Location of the sidecar project inside the package. */
export const SIDECAR_PROJECT_RELATIVE = 'python';

/** Raw outcome of running the sidecar. */
export interface SidecarOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be started at all. */
  spawnError?: string;
}

/** Runs the sidecar with a JSON request. Injected so tests stay hermetic. */
export type SidecarRunner = (
  request: Record<string, unknown>,
  options: { timeoutMs: number },
) => Promise<SidecarOutcome>;

/** The error shape the sidecar returns. */
interface SidecarError {
  code: string;
  message: string;
  hint: string;
}

/** Map sidecar error codes onto the execution layer's codes. */
export function mapSidecarCode(code: string): SpineErrorCode {
  switch (code) {
    case 'INVALID_ARGUMENT':
      return SpineErrorCode.InvalidArgument;
    case 'INPUT_MISSING':
      return SpineErrorCode.InputMissing;
    case 'DEPENDENCY_MISSING':
      return SpineErrorCode.DependencyMissing;
    case 'VALIDATION_FAILED':
      return SpineErrorCode.ValidationFailed;
    case 'PARSE_FAILED':
      return SpineErrorCode.ParseFailed;
    default:
      return SpineErrorCode.CliFailed;
  }
}

/** Default timeout: PSD parsing and packing on a large document. */
export const DEFAULT_SIDECAR_TIMEOUT_MS = 300_000;

/** Call the sidecar and decode its response. */
export async function callSidecar<T>(
  runner: SidecarRunner,
  request: Record<string, unknown>,
  timeoutMs: number = DEFAULT_SIDECAR_TIMEOUT_MS,
): Promise<SpineResult<T>> {
  const outcome = await runner(request, { timeoutMs });

  if (outcome.spawnError) {
    return err(
      SpineErrorCode.DependencyMissing,
      `The Python sidecar could not be started: ${outcome.spawnError}`,
      'Install uv (https://docs.astral.sh/uv/getting-started/installation/) and run: uv sync --project python. Everything except PSD generation works without it.',
    );
  }

  if (outcome.timedOut) {
    return err(
      SpineErrorCode.CliTimeout,
      `The Python sidecar did not finish within ${Math.round(timeoutMs / 1000)}s.`,
      'Large PSDs with many layers take longer; raise the timeout, or flatten layer groups that are not body parts.',
      { stderr: outcome.stderr.slice(0, 2000) },
    );
  }

  const trimmed = outcome.stdout.trim();
  if (trimmed.length === 0) {
    return err(
      SpineErrorCode.ParseFailed,
      'The Python sidecar produced no output.',
      'Run `uv sync --project python` and check that `uv run --project python spine-psd-sidecar` works.',
      { exitCode: outcome.code, stderr: outcome.stderr.slice(0, 2000) },
    );
  }

  // The response is the last JSON object on stdout, which keeps stray
  // library warnings from breaking the parse.
  const lastLine = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0).pop()!;

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    return err(
      SpineErrorCode.ParseFailed,
      'The Python sidecar response was not valid JSON.',
      'This usually means a library printed to stdout. Check the stderr output in the details.',
      { stdout: trimmed.slice(0, 2000), stderr: outcome.stderr.slice(0, 2000) },
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err(
      SpineErrorCode.ParseFailed,
      'The Python sidecar response was not an object.',
      'Expected {"ok": true, "data": ...} or {"ok": false, "error": ...}.',
      { stdout: trimmed.slice(0, 2000) },
    );
  }

  const response = parsed as { ok?: boolean; data?: T; error?: SidecarError };

  if (response.ok === true) {
    return ok(response.data as T, 'Sidecar call succeeded.');
  }

  const error = response.error;
  if (!error) {
    return err(
      SpineErrorCode.CliFailed,
      'The Python sidecar reported a failure without an error object.',
      'Report this with the PSD that triggered it.',
      { stdout: trimmed.slice(0, 2000) },
    );
  }

  return err(mapSidecarCode(error.code), error.message, error.hint, {
    sidecarCode: error.code,
    ...(outcome.stderr.trim().length > 0
      ? { stderr: outcome.stderr.slice(0, 2000) }
      : {}),
  });
}

/** What the sidecar reports about itself. */
export interface SidecarProbe {
  protocolVersion: number;
  python: string;
  dependencies: Record<string, string>;
  missing: string[];
  ready: boolean;
}

/** Ask the sidecar whether it can run. */
export async function probeSidecar(
  runner: SidecarRunner,
  timeoutMs = 60_000,
): Promise<SpineResult<SidecarProbe>> {
  const result = await callSidecar<SidecarProbe>(runner, { command: 'probe' }, timeoutMs);
  if (!result.ok) return result;

  if (result.data.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
    return err(
      SpineErrorCode.DependencyMissing,
      `The Python sidecar speaks protocol ${result.data.protocolVersion}, but this build expects ${SIDECAR_PROTOCOL_VERSION}.`,
      'Update the Power package so the TypeScript and Python halves match.',
    );
  }

  if (!result.data.ready) {
    return err(
      SpineErrorCode.DependencyMissing,
      `The Python sidecar is missing dependencies: ${result.data.missing.join(', ')}.`,
      'Run: uv sync --project python',
      { python: result.data.python },
    );
  }

  return ok(
    result.data,
    `Python ${result.data.python} sidecar ready (${Object.entries(result.data.dependencies)
      .map(([name, version]) => `${name} ${version}`)
      .join(', ')}).`,
  );
}

/**
 * Build a runner that invokes the sidecar through uv.
 *
 * uv is used rather than a bare `python` because it resolves and caches the
 * sidecar's own dependency set, so the Power does not depend on whatever
 * happens to be in the ambient Python environment.
 */
export function createUvSidecarRunner(host: SpineHost): SidecarRunner {
  const projectDir = join(host.packageRoot, SIDECAR_PROJECT_RELATIVE);

  return async (request, options) => {
    const { spawn } = await import('node:child_process');

    return new Promise<SidecarOutcome>((resolvePromise) => {
      const child = spawn(
        'uv',
        ['run', '--project', projectDir, 'spine-psd-sidecar'],
        { shell: false, windowsHide: true },
      );

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);

      const finish = (code: number | null, spawnError?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          code: timedOut ? null : code,
          stdout,
          stderr,
          timedOut,
          ...(spawnError ? { spawnError } : {}),
        });
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error: Error) => finish(null, error.message));
      child.on('close', (code) => finish(code));

      child.stdin?.write(JSON.stringify(request));
      child.stdin?.end();
    });
  };
}
