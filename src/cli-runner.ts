// ============================================================
// Spine CLI runner.
//
// Spawns the Spine command-line executable with an argument array (never a
// shell string), enforces a timeout, and maps the outcome onto the result
// envelope.
//
// Verified behaviour worth knowing: when a Spine editor instance is already
// running, the launcher hands the request to that instance and then waits
// indefinitely — the CLI never returns. The timeout below is what turns
// that into an actionable error instead of a hang.
// ============================================================

import { SpineCommand, formatCommandLine } from './cli-command';
import { SpineErrorCode, SpineResult, err, ok } from './types';

/** Raw outcome of a child process run. */
export interface SpawnOutcome {
  /** Exit code, or null when the process was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** Spawn abstraction so the runner can be tested without child processes. */
export type SpawnFn = (
  executable: string,
  args: string[],
  options: { timeoutMs: number; cwd?: string },
) => Promise<SpawnOutcome>;

/** Default CLI timeout: a cold editor start plus a modest export. */
export const DEFAULT_TIMEOUT_MS = 180_000;

/** What a completed CLI run reports back. */
export interface CliRunData {
  executable: string;
  args: string[];
  /** Display-only command line, handy for the developer to re-run manually. */
  commandLine: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Commands that were part of this invocation, for traceability. */
  commands: SpineCommand[];
}

/** Everything needed to perform one invocation. */
export interface CliInvocation {
  executable: string;
  args: string[];
  commands: SpineCommand[];
  timeoutMs?: number;
  cwd?: string;
}

const EDITOR_RUNNING_HINT = [
  'The Spine CLI launches a separate editor process. When a Spine editor window is already open,',
  'the launcher hands the request to the running instance and then waits forever.',
  'Close the Spine editor and retry, or raise the timeout if the project is genuinely large.',
].join(' ');

/** Pull the most useful lines out of CLI output for an error message. */
export function summarizeFailureOutput(stdout: string, stderr: string): string {
  const candidates = [...stderr.split(/\r?\n/), ...stdout.split(/\r?\n/)]
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const interesting = candidates.filter((line) =>
    /error|fail|exception|cannot|unable|invalid|not found|unrecognized|unknown/i.test(line),
  );

  const chosen = (interesting.length > 0 ? interesting : candidates.slice(-5)).slice(0, 8);
  return chosen.join('\n');
}

/** Run one Spine CLI invocation and classify the outcome. */
export async function runCli(
  spawn: SpawnFn,
  invocation: CliInvocation,
): Promise<SpineResult<CliRunData>> {
  const timeoutMs = invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const commandLine = formatCommandLine(invocation.executable, invocation.args);

  const outcome = await spawn(invocation.executable, invocation.args, {
    timeoutMs,
    ...(invocation.cwd ? { cwd: invocation.cwd } : {}),
  });

  const data: CliRunData = {
    executable: invocation.executable,
    args: invocation.args,
    commandLine,
    exitCode: outcome.code,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    durationMs: outcome.durationMs,
    commands: invocation.commands,
  };

  if (outcome.timedOut) {
    return err(
      SpineErrorCode.CliTimeout,
      `The Spine CLI did not finish within ${Math.round(timeoutMs / 1000)}s.`,
      EDITOR_RUNNING_HINT,
      { commandLine, stdout: outcome.stdout, stderr: outcome.stderr },
    );
  }

  if (outcome.code !== 0) {
    return err(
      SpineErrorCode.CliFailed,
      `The Spine CLI exited with code ${outcome.code}.\n${summarizeFailureOutput(
        outcome.stdout,
        outcome.stderr,
      )}`,
      'Re-run the printed command line manually to see the full output. A non-zero exit code means Spine rejected the command.',
      { commandLine, exitCode: outcome.code, stdout: outcome.stdout, stderr: outcome.stderr },
    );
  }

  return ok(
    data,
    `Spine CLI completed in ${(outcome.durationMs / 1000).toFixed(1)}s: ${commandLine}`,
  );
}

/**
 * Build a spawn function backed by `child_process.spawn`.
 *
 * `shell` is left off deliberately: arguments go to the process verbatim,
 * which removes any shell-injection surface from developer-supplied paths.
 */
export function createNodeSpawn(): SpawnFn {
  return async (executable, args, options) => {
    // Imported lazily so the pure modules stay importable in any environment.
    const { spawn } = await import('node:child_process');
    const startedAt = Date.now();

    return new Promise<SpawnOutcome>((resolvePromise) => {
      const child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        ...(options.cwd ? { cwd: options.cwd } : {}),
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        // SIGKILL fallback: the Spine launcher can ignore a polite kill.
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, 2000);
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          code: timedOut ? null : code,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      };

      child.on('error', (error: Error) => {
        stderr += `${error.message}\n`;
        finish(null);
      });
      child.on('close', (code) => finish(code));
    });
  };
}
