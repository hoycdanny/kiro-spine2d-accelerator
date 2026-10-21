// ============================================================
// Group A — CLI orchestration tools.
//
// `spine_project_info` is the only read-only CLI command, so it is also the
// only one that works on the trial.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SpineHost } from '../host';
import { SpawnFn, createNodeSpawn, runCli } from '../cli-runner';
import { EditorFlags, SpineCommand, buildArgs, formatCommandLine } from '../cli-command';
import { ProjectInfoReport, parseProjectInfo, summarizeProjectInfo } from '../cli-output';
import { requireCapabilitiesFor } from '../capability-gate';
import { resolveReadTarget } from '../path-safety';
import { guardTool } from '../tool-result';
import { probeWithHost } from './env-tools';
import { SpineErrorCode, SpineResult, err, ok } from '../types';

/** Shared editor-flag inputs, reused by every CLI-backed tool. */
export const editorFlagSchema = {
  update: z
    .string()
    .optional()
    .describe(
      'Spine editor version to load (--update): a concrete version like 4.2.37, a wildcard patch like 4.2.xx, or a channel (latest, stable, latestbeta). Pin this in CI.',
    ),
  ignoreUnknown: z
    .boolean()
    .optional()
    .describe(
      'Let the launcher forward parameters it does not recognise (--ignore-unknown). Use when the launcher is older than the editor build.',
    ),
  timeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(3600)
    .optional()
    .describe(
      'Hard timeout for the CLI run. Defaults to 180s. A timeout usually means a Spine editor window is already open, which makes the CLI wait forever.',
    ),
};

/** Translate the shared schema into editor flags. */
export function toEditorFlags(args: {
  update?: string | undefined;
  ignoreUnknown?: boolean | undefined;
  cleanAll?: boolean | undefined;
}): EditorFlags {
  return {
    update: args.update ?? null,
    ignoreUnknown: args.ignoreUnknown ?? false,
    ...(args.cleanAll === undefined ? {} : { cleanAll: args.cleanAll }),
  };
}

/** Result payload of a CLI-backed tool run. */
export interface CliToolData<T> {
  /** Parsed, tool-specific payload. */
  result: T;
  /** The command line that ran, so the developer can reproduce it. */
  commandLine: string;
  exitCode: number | null;
  durationMs: number;
}

/**
 * Shared pipeline for every CLI-backed tool: probe, gate, build, run, parse.
 */
export async function runCliPipeline<T>(
  host: SpineHost,
  spawn: SpawnFn,
  options: {
    commands: SpineCommand[];
    flags?: EditorFlags;
    timeoutMs?: number;
    parse: (stdout: string, stderr: string) => T;
    summarize: (parsed: T) => string;
  },
): Promise<SpineResult<CliToolData<T>>> {
  const env = probeWithHost(host);
  if (!env.ok) return env;

  const built = buildArgs(options.commands, options.flags ?? {});
  if (!built.ok) return built;

  const commandLine = formatCommandLine(env.data.executable!, built.data);

  const refusal = requireCapabilitiesFor(env.data, options.commands, { commandLine });
  if (refusal) return refusal;

  const run = await runCli(spawn, {
    executable: env.data.executable!,
    args: built.data,
    commands: options.commands,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    cwd: host.workspaceRoot,
  });
  if (!run.ok) return run;

  const parsed = options.parse(run.data.stdout, run.data.stderr);

  return ok(
    {
      result: parsed,
      commandLine,
      exitCode: run.data.exitCode,
      durationMs: run.data.durationMs,
    },
    [options.summarize(parsed), `Command: ${commandLine}`].join('\n'),
  );
}

/** Read-only project information via `Spine -i <path>`. */
export async function projectInfo(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    input: string;
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<ProjectInfoReport>>> {
  const input = resolveReadTarget(args.input, host.workspaceRoot, host.exists);
  if (!input.ok) return input;

  const result = await runCliPipeline(host, spawn, {
    commands: [{ kind: 'info', input: input.data }],
    flags: toEditorFlags(args),
    ...(args.timeoutSeconds === undefined
      ? {}
      : { timeoutMs: args.timeoutSeconds * 1000 }),
    parse: (stdout) => parseProjectInfo(stdout),
    summarize: (report) => summarizeProjectInfo(report),
  });

  if (!result.ok) return result;

  // A GUI session instead of info output means the command never ran.
  if (result.data.result.banner.openedEditor) {
    return err(
      SpineErrorCode.CliFailed,
      'Spine opened an editor window instead of reporting project info.',
      'Close any running Spine editor instance and retry: the launcher forwards CLI requests to an already-running editor, which never reports back.',
      { commandLine: result.data.commandLine, raw: result.data.result.raw },
    );
  }

  return result;
}

/** Register the CLI orchestration tools. */
export function registerCliTools(
  server: McpServer,
  host: SpineHost,
  spawn: SpawnFn = createNodeSpawn(),
): void {
  server.registerTool(
    'spine_project_info',
    {
      title: 'Read Spine project information',
      description: [
        'Run the Spine CLI info command (`-i`) against a .spine project, an exported JSON/binary file, or a folder of them.',
        'Reports the Spine version a project was saved with plus skeleton and animation counts.',
        'This is the only read-only CLI command, so it is the only one that works on the Spine trial.',
        'Requires that no Spine editor window is open: the launcher forwards the request to a running editor and then waits indefinitely.',
      ].join(' '),
      inputSchema: {
        input: z
          .string()
          .describe(
            'Path to a .spine project, a .json/.skel data file, or a folder containing them. Relative paths resolve against the workspace root.',
          ),
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guardTool(() => projectInfo(host, spawn, args)),
  );
}
