// ============================================================
// Environment tools: `spine_env_probe`.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SpineHost } from '../host';
import {
  SidecarProbe,
  SidecarRunner,
  createUvSidecarRunner,
  probeSidecar,
} from '../sidecar';
import { guardTool } from '../tool-result';
import {
  CAPABILITY_LABELS,
  probeEnvironment,
  summarizeEnvironment,
} from '../spine-env';
import { SpineEnvironment, SpineErrorCode, SpineResult, err, ok } from '../types';

/** Probe the local Spine installation using the injected host. */
export function probeWithHost(
  host: SpineHost,
  overrides: { executable?: string | null; userDataDir?: string | null } = {},
): SpineResult<SpineEnvironment> {
  const env = probeEnvironment({
    platform: host.platform,
    homeDir: host.homeDir,
    ...(host.programFiles ? { programFiles: host.programFiles } : {}),
    explicitExecutable: overrides.executable ?? host.explicitExecutable,
    explicitUserDataDir: overrides.userDataDir ?? host.explicitUserDataDir,
    exists: host.exists,
    readText: host.readText,
  });

  if (!env.found) {
    return err(
      SpineErrorCode.SpineNotFound,
      'No Spine command-line executable was found on this machine.',
      host.platform === 'win32'
        ? 'Install Spine, or pass `executable` pointing at Spine.com / SpineTrial.com (the .com console build is required for CLI use).'
        : 'Install Spine, or pass `executable` pointing at the Spine executable (Spine.app/Contents/MacOS/Spine on macOS, Spine.sh on Linux).',
      { searchedUserDataDir: env.userDataDir, notes: env.notes },
    );
  }

  const blocked = (Object.keys(CAPABILITY_LABELS) as Array<keyof typeof CAPABILITY_LABELS>)
    .filter((key) => !env.capabilities[key])
    .map((key) => CAPABILITY_LABELS[key]);

  const summaryLines = [summarizeEnvironment(env)];
  if (blocked.length > 0) {
    summaryLines.push(`Blocked by this edition: ${blocked.join(', ')}.`);
  }
  summaryLines.push(...env.notes);

  return ok(env, summaryLines.join('\n'));
}

/** Environment report, including the optional Python sidecar. */
export interface EnvProbeData {
  spine: SpineEnvironment;
  /** Null when the sidecar check was skipped. */
  sidecar:
    | { available: true; probe: SidecarProbe }
    | { available: false; reason: string; hint: string }
    | null;
}

/** Probe Spine and, unless skipped, the Python sidecar. */
export async function probeAll(
  host: SpineHost,
  runner: SidecarRunner,
  overrides: {
    executable?: string | null;
    userDataDir?: string | null;
    includeSidecar?: boolean;
  } = {},
): Promise<SpineResult<EnvProbeData>> {
  const spine = probeWithHost(host, overrides);
  if (!spine.ok) return spine;

  let sidecar: EnvProbeData['sidecar'] = null;
  const summaryLines = [spine.summary];

  if (overrides.includeSidecar !== false) {
    const probe = await probeSidecar(runner);
    if (probe.ok) {
      sidecar = { available: true, probe: probe.data };
      summaryLines.push(probe.summary);
    } else {
      sidecar = { available: false, reason: probe.message, hint: probe.hint };
      summaryLines.push(
        `PSD generation unavailable: ${probe.message} ${probe.hint}`,
      );
    }
  }

  return ok({ spine: spine.data, sidecar }, summaryLines.join('\n'));
}

/** Register environment tools on an MCP server. */
export function registerEnvTools(
  server: McpServer,
  host: SpineHost,
  runner: SidecarRunner = createUvSidecarRunner(host),
): void {
  server.registerTool(
    'spine_env_probe',
    {
      title: 'Probe the local Spine installation',
      description: [
        'Locate the Spine command-line executable and report its version, edition and capability matrix.',
        'Call this before any write operation: the Spine trial cannot save projects, pack texture atlases, or export data/images/video, so export-style tools are gated on the result.',
        'Also reports the matching spine-runtimes branch, since editor and runtime versions must match, and whether the Python sidecar for PSD generation is ready.',
      ].join(' '),
      inputSchema: {
        executable: z
          .string()
          .optional()
          .describe(
            'Explicit path to the Spine CLI executable. On Windows this must be the .com console build, which returns an exit code.',
          ),
        userDataDir: z
          .string()
          .optional()
          .describe(
            'Explicit Spine user data directory holding spine.log and version.txt (e.g. %USERPROFILE%\\SpineTrial).',
          ),
        includeSidecar: z
          .boolean()
          .optional()
          .describe(
            'Also probe the Python sidecar used for PSD generation. Defaults to true; it costs a process start.',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guardTool(() =>
        probeAll(host, runner, {
          executable: args.executable ?? null,
          userDataDir: args.userDataDir ?? null,
          ...(args.includeSidecar === undefined
            ? {}
            : { includeSidecar: args.includeSidecar }),
        }),
      ),
  );
}
