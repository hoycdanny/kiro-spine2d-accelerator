// ============================================================
// Group A — write-type CLI tools.
//
// Every tool here needs a licensed Spine: the trial blocks saving,
// texture packing and all exports. The capability gate runs before the
// subprocess, so on a trial the caller gets a clear refusal plus the exact
// command line that would have run — which means the work can be prepared
// now and executed verbatim once a license is in place.
//
// Path rules: inputs may live anywhere (and must exist), outputs are
// confined to the workspace.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  SpineCommand,
  isExportShorthand,
} from '../cli-command';
import { SpawnFn, createNodeSpawn } from '../cli-runner';
import { ProjectInfoReport, parseLauncherBanner, parseProjectInfo } from '../cli-output';
import { SpineHost } from '../host';
import { resolveReadTarget, resolveWriteTarget } from '../path-safety';
import { guardTool } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import { CliToolData, editorFlagSchema, runCliPipeline, toEditorFlags } from './cli-tools';

/** A command as described by a tool caller, before path resolution. */
export type CommandDescriptor =
  | { kind: 'info'; input: string }
  | {
      kind: 'export';
      input?: string | undefined;
      output?: string | undefined;
      exportSpec: string;
      clean?: boolean | undefined;
    }
  | { kind: 'last-export-settings'; input: string; output?: string | undefined }
  | {
      kind: 'pack';
      input: string;
      output: string;
      packSpec: string;
      name?: string | undefined;
      projects?: string[] | undefined;
    }
  | {
      kind: 'unpack';
      input: string;
      output: string;
      atlas: string;
      projects?: string[] | undefined;
    }
  | {
      kind: 'import';
      input: string;
      output: string;
      scale?: number | undefined;
      skeletonName?: string | undefined;
    }
  | { kind: 'cleanup'; input: string; confirm?: boolean | undefined };

/** A resolved command plus anything the caller should know about it. */
export interface ResolvedCommand {
  command: SpineCommand;
  notes: string[];
}

/** True when a pack spec looks like a settings file rather than an atlas name. */
export function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.json$/i.test(value);
}

/**
 * Resolve the paths in a descriptor and collect caveats.
 *
 * Resolution order matters: a missing input is reported before anything is
 * spawned, and an output outside the workspace is refused outright.
 */
export function resolveCommand(
  host: SpineHost,
  descriptor: CommandDescriptor,
): SpineResult<ResolvedCommand> {
  const notes: string[] = [];

  const readPath = (path: string) =>
    resolveReadTarget(path, host.workspaceRoot, host.exists);
  const writePath = (path: string) => resolveWriteTarget(path, host.workspaceRoot);

  switch (descriptor.kind) {
    case 'info': {
      const input = readPath(descriptor.input);
      if (!input.ok) return input;
      return ok({ command: { kind: 'info', input: input.data }, notes }, '');
    }

    case 'export': {
      const command: SpineCommand = {
        kind: 'export',
        exportSpec: descriptor.exportSpec,
        ...(descriptor.clean === undefined ? {} : { clean: descriptor.clean }),
      };

      if (descriptor.input) {
        const input = readPath(descriptor.input);
        if (!input.ok) return input;
        command.input = input.data;
      }

      if (descriptor.output) {
        const output = writePath(descriptor.output);
        if (!output.ok) return output;
        command.output = output.data;
      }

      if (isExportShorthand(descriptor.exportSpec)) {
        notes.push(
          `"${descriptor.exportSpec}" uses Spine's default export settings. The +pack variants pack with the "Attachments" source mode, which ignores pack.json files — run the texture packer separately when per-folder pack settings matter.`,
        );
        if (!descriptor.input) {
          return err(
            SpineErrorCode.InvalidArgument,
            'An export shorthand needs an input path.',
            'Pass `input` pointing at a .spine project or a folder of them, since the shorthand carries no paths of its own.',
          );
        }
      } else {
        const settings = readPath(descriptor.exportSpec);
        if (!settings.ok) {
          return err(
            settings.code,
            settings.message,
            `${settings.hint} Alternatively use a shorthand: json, binary, json+pack or binary+pack. Build a settings file with export_settings_build.`,
            settings.details,
          );
        }
        command.exportSpec = settings.data;
        if (!descriptor.output) {
          notes.push(
            'No output path was given, so the output path inside the settings file is used.',
          );
        }
      }

      return ok({ command, notes }, '');
    }

    case 'last-export-settings': {
      const input = readPath(descriptor.input);
      if (!input.ok) return input;
      const command: SpineCommand = { kind: 'last-export-settings', input: input.data };
      if (descriptor.output) {
        const output = writePath(descriptor.output);
        if (!output.ok) return output;
        command.output = output.data;
      } else {
        notes.push(
          'No output path was given, so Spine writes the settings file next to the project.',
        );
      }
      return ok({ command, notes }, '');
    }

    case 'pack': {
      const input = readPath(descriptor.input);
      if (!input.ok) return input;
      const output = writePath(descriptor.output);
      if (!output.ok) return output;

      let packSpec = descriptor.packSpec;
      if (looksLikePath(packSpec)) {
        const settings = readPath(packSpec);
        if (!settings.ok) return settings;
        packSpec = settings.data;
      } else {
        notes.push(
          `"${packSpec}" is treated as the atlas name, so default pack settings apply unless a pack.json exists in the image folders. Build one with pack_settings_build.`,
        );
      }

      const projects: string[] = [];
      for (const project of descriptor.projects ?? []) {
        const resolved = readPath(project);
        if (!resolved.ok) return resolved;
        projects.push(resolved.data);
      }

      if (projects.length === 0) {
        notes.push(
          'No project was passed with `projects`. Polygon packing and mesh-aware whitespace stripping need project context; without it, parts of meshes can be stripped.',
        );
      }

      return ok(
        {
          command: {
            kind: 'pack',
            input: input.data,
            output: output.data,
            packSpec,
            ...(descriptor.name === undefined ? {} : { name: descriptor.name }),
            ...(projects.length > 0 ? { projects } : {}),
          },
          notes,
        },
        '',
      );
    }

    case 'unpack': {
      const input = readPath(descriptor.input);
      if (!input.ok) return input;
      const output = writePath(descriptor.output);
      if (!output.ok) return output;
      const atlas = readPath(descriptor.atlas);
      if (!atlas.ok) return atlas;

      const projects: string[] = [];
      for (const project of descriptor.projects ?? []) {
        const resolved = readPath(project);
        if (!resolved.ok) return resolved;
        projects.push(resolved.data);
      }

      if (projects.length === 0) {
        notes.push(
          'Without a project, images packed as polygons cannot be fully restored and unpacked images may include slivers of their neighbours.',
        );
      }

      return ok(
        {
          command: {
            kind: 'unpack',
            input: input.data,
            output: output.data,
            atlas: atlas.data,
            ...(projects.length > 0 ? { projects } : {}),
          },
          notes,
        },
        '',
      );
    }

    case 'import': {
      const input = readPath(descriptor.input);
      if (!input.ok) return input;
      // The output is a project file, created when it does not exist.
      const output = writePath(descriptor.output);
      if (!output.ok) return output;

      if (host.exists(output.data)) {
        notes.push(
          `${output.data} already exists; the imported skeletons are added to that project.`,
        );
      }

      return ok(
        {
          command: {
            kind: 'import',
            input: input.data,
            output: output.data,
            ...(descriptor.scale === undefined ? {} : { scale: descriptor.scale }),
            ...(descriptor.skeletonName === undefined
              ? {}
              : { skeletonName: descriptor.skeletonName }),
          },
          notes,
        },
        '',
      );
    }

    case 'cleanup': {
      if (descriptor.confirm !== true) {
        return err(
          SpineErrorCode.InvalidArgument,
          'Animation clean up rewrites the project file, so it needs explicit confirmation.',
          'Pass confirm: true once the project is committed or backed up. Clean up removes redundant keys from every animation and saves the project in place.',
          { input: descriptor.input },
        );
      }
      const input = readPath(descriptor.input);
      if (!input.ok) return input;
      notes.push(
        'Animation clean up modifies and saves the project file in place. There is no undo outside version control.',
      );
      return ok({ command: { kind: 'cleanup', input: input.data }, notes }, '');
    }

    default: {
      const exhaustive: never = descriptor;
      return err(
        SpineErrorCode.InvalidArgument,
        `Unsupported command: ${JSON.stringify(exhaustive)}`,
        'Use info, export, last-export-settings, pack, unpack, import or cleanup.',
      );
    }
  }
}

/** What a write-type CLI run reports. */
export interface CliWriteData {
  /** Whether Spine printed `Complete.`, its success marker. */
  completed: boolean;
  /** True when Spine opened a GUI session instead of running the command. */
  openedEditor: boolean;
  /** Caveats collected while resolving the commands. */
  notes: string[];
  stdout: string;
}

function parseWriteOutcome(stdout: string, notes: string[]): CliWriteData {
  const banner = parseLauncherBanner(stdout);
  return {
    completed: banner.completed,
    openedEditor: banner.openedEditor,
    notes,
    stdout,
  };
}

function summarizeWrite(label: string, data: CliWriteData): string {
  const lines = [
    data.completed
      ? `${label} completed (Spine reported "Complete.").`
      : `${label} finished with exit code 0 but Spine did not print "Complete."; check the output below.`,
  ];
  lines.push(...data.notes);
  return lines.join('\n');
}

/** Run a batch of already-resolved commands through the CLI. */
export async function runCommands(
  host: SpineHost,
  spawn: SpawnFn,
  resolved: ResolvedCommand[],
  args: {
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    cleanAll?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
  label: string,
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  const notes = resolved.flatMap((entry) => entry.notes);

  const result = await runCliPipeline(host, spawn, {
    commands: resolved.map((entry) => entry.command),
    flags: toEditorFlags(args),
    ...(args.timeoutSeconds === undefined
      ? {}
      : { timeoutMs: args.timeoutSeconds * 1000 }),
    parse: (stdout) => parseWriteOutcome(stdout, notes),
    summarize: (data) => summarizeWrite(label, data),
  });

  if (!result.ok) return result;

  if (result.data.result.openedEditor) {
    return err(
      SpineErrorCode.CliFailed,
      'Spine opened an editor window instead of running the command.',
      'Close any running Spine editor instance and retry: the launcher forwards CLI requests to an already-running editor, which then never performs them.',
      { commandLine: result.data.commandLine, stdout: result.data.result.stdout },
    );
  }

  return result;
}

/** Resolve one descriptor and run it. */
async function runSingle(
  host: SpineHost,
  spawn: SpawnFn,
  descriptor: CommandDescriptor,
  args: {
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
  label: string,
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  const resolved = resolveCommand(host, descriptor);
  if (!resolved.ok) return resolved;
  return runCommands(host, spawn, [resolved.data], args, label);
}

// ------------------------------------------------------------
// Tool entry points
// ------------------------------------------------------------

export function spineExport(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    input?: string | undefined;
    output?: string | undefined;
    exportSpec: string;
    clean?: boolean | undefined;
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  return runSingle(
    host,
    spawn,
    {
      kind: 'export',
      input: args.input,
      output: args.output,
      exportSpec: args.exportSpec,
      clean: args.clean,
    },
    args,
    'Export',
  );
}

export function spinePack(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    input: string;
    output: string;
    packSpec: string;
    name?: string | undefined;
    projects?: string[] | undefined;
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  return runSingle(
    host,
    spawn,
    {
      kind: 'pack',
      input: args.input,
      output: args.output,
      packSpec: args.packSpec,
      name: args.name,
      projects: args.projects,
    },
    args,
    'Texture packing',
  );
}

export function spineUnpack(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    input: string;
    output: string;
    atlas: string;
    projects?: string[] | undefined;
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  return runSingle(
    host,
    spawn,
    {
      kind: 'unpack',
      input: args.input,
      output: args.output,
      atlas: args.atlas,
      projects: args.projects,
    },
    args,
    'Texture unpacking',
  );
}

export function spineImport(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    input: string;
    output: string;
    scale?: number | undefined;
    skeletonName?: string | undefined;
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  return runSingle(
    host,
    spawn,
    {
      kind: 'import',
      input: args.input,
      output: args.output,
      scale: args.scale,
      skeletonName: args.skeletonName,
    },
    args,
    'Import',
  );
}

export function spineCleanup(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    input: string;
    confirm?: boolean | undefined;
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  return runSingle(
    host,
    spawn,
    { kind: 'cleanup', input: args.input, confirm: args.confirm },
    args,
    'Animation clean up',
  );
}

/** Capture the export settings a project last used. */
export async function spineExportSettingsCapture(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    input: string;
    output?: string | undefined;
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  const result = await runSingle(
    host,
    spawn,
    { kind: 'last-export-settings', input: args.input, output: args.output },
    args,
    'Export settings capture',
  );
  if (!result.ok) return result;

  return ok(result.data, [
    result.summary,
    'Use this file to calibrate the bundled templates in templates/export-settings/: the real field names come from here, not from the documentation.',
  ].join('\n'));
}

/** Run several commands in one Spine invocation. */
export async function spineBatch(
  host: SpineHost,
  spawn: SpawnFn,
  args: {
    commands: CommandDescriptor[];
    update?: string | undefined;
    ignoreUnknown?: boolean | undefined;
    cleanAll?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<CliToolData<CliWriteData>>> {
  if (args.commands.length === 0) {
    return err(
      SpineErrorCode.InvalidArgument,
      'No commands were supplied.',
      'Pass at least one command descriptor.',
    );
  }

  const resolved: ResolvedCommand[] = [];
  for (const [index, descriptor] of args.commands.entries()) {
    const entry = resolveCommand(host, descriptor);
    if (!entry.ok) {
      return err(
        entry.code,
        `Command ${index + 1} (${descriptor.kind}): ${entry.message}`,
        entry.hint,
        entry.details,
      );
    }
    resolved.push(entry.data);
  }

  return runCommands(
    host,
    spawn,
    resolved,
    args,
    `Batch of ${resolved.length} command(s)`,
  );
}

/** Info is read-only but belongs in a batch too; re-exported for reuse. */
export function parseInfo(stdout: string): ProjectInfoReport {
  return parseProjectInfo(stdout);
}

// ------------------------------------------------------------
// Registration
// ------------------------------------------------------------

const packProjectsSchema = z
  .array(z.string())
  .optional()
  .describe(
    'Project files consulted for mesh hulls (-j/--project). Required for polygon packing and for whitespace stripping that respects mesh UVs.',
  );

export function registerExportTools(
  server: McpServer,
  host: SpineHost,
  spawn: SpawnFn = createNodeSpawn(),
): void {
  server.registerTool(
    'spine_export',
    {
      title: 'Export skeleton data with the Spine CLI',
      description: [
        'Export a Spine project to skeleton data (-e). Pass either a path to an export settings JSON file or one of the shorthands: json, binary, json+pack, binary+pack.',
        'The shorthands use Spine default settings and ignore pack.json files. Command-line input/output paths override whatever the settings file says.',
        'Requires a licensed Spine: the trial cannot export. On a trial this returns CAPABILITY_DENIED along with the exact command line it would have run.',
        'Requires that no Spine editor window is open.',
      ].join(' '),
      inputSchema: {
        exportSpec: z
          .string()
          .describe(
            'Path to an export settings JSON file, or one of: json, binary, json+pack, binary+pack.',
          ),
        input: z
          .string()
          .optional()
          .describe(
            'Project, data file, or folder to export. Required when using a shorthand. Overrides the settings file.',
          ),
        output: z
          .string()
          .optional()
          .describe(
            'Output file or folder, inside the workspace. Overrides the settings file.',
          ),
        clean: z
          .boolean()
          .optional()
          .describe(
            'Run animation clean up before exporting (-m). This affects the exported data only, not the project file.',
          ),
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => spineExport(host, spawn, args)),
  );

  server.registerTool(
    'spine_pack',
    {
      title: 'Pack a texture atlas with the Spine CLI',
      description: [
        'Pack a folder of images into a texture atlas (-p). The pack spec is either an atlas name (default settings, plus any pack.json found in the image folders)',
        'or a path to a pack settings JSON file, which pack_settings_build can generate.',
        'Pass `projects` so the packer can see mesh hulls: polygon packing requires it, and whitespace stripping without it can cut into meshes.',
        'Requires a licensed Spine: the trial cannot pack textures.',
      ].join(' '),
      inputSchema: {
        input: z.string().describe('Folder of images to pack.'),
        output: z
          .string()
          .describe('Folder to write the atlas and page images to, inside the workspace.'),
        packSpec: z
          .string()
          .describe('Atlas name, or a path to a pack settings JSON file.'),
        name: z
          .string()
          .optional()
          .describe('Atlas name prefix (-n), used when packSpec is a settings file path.'),
        projects: packProjectsSchema,
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => spinePack(host, spawn, args)),
  );

  server.registerTool(
    'spine_unpack',
    {
      title: 'Unpack a texture atlas with the Spine CLI',
      description: [
        'Write the individual images back out of a texture atlas (-c). Rotation is undone and stripped whitespace is restored.',
        'Pass `projects` to restore images that were packed as polygons; without it, unpacked images can include parts of their neighbours.',
        'Requires a licensed Spine.',
      ].join(' '),
      inputSchema: {
        input: z.string().describe('Folder containing the atlas page images.'),
        output: z
          .string()
          .describe('Folder to write the unpacked images to, inside the workspace.'),
        atlas: z.string().describe('Path to the .atlas file.'),
        projects: packProjectsSchema,
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => spineUnpack(host, spawn, args)),
  );

  server.registerTool(
    'spine_import',
    {
      title: 'Import data into a Spine project',
      description: [
        'Import skeleton JSON, binary data, or another project into a .spine project (-r). The project is created when it does not exist.',
        'This is the closing step of the generation pipeline: it turns generated skeleton data into a project an artist can open.',
        'Importing data that was exported without nonessential data loses information.',
        'Requires a licensed Spine: the trial cannot save projects.',
      ].join(' '),
      inputSchema: {
        input: z
          .string()
          .describe(
            'Project, JSON, or binary file to import — or a folder containing .spine/.json/.skel files.',
          ),
        output: z
          .string()
          .describe('Destination .spine project file, inside the workspace.'),
        scale: z
          .number()
          .positive()
          .optional()
          .describe('Scale applied to the imported skeletons (-s), e.g. 0.5.'),
        skeletonName: z
          .string()
          .optional()
          .describe(
            'Rename the imported skeleton. Ignored when more than one skeleton is imported.',
          ),
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => spineImport(host, spawn, args)),
  );

  server.registerTool(
    'spine_cleanup',
    {
      title: 'Run animation clean up on a project',
      description: [
        'Run animation clean up across every animation in a project and save the project in place (-i + -m).',
        'This rewrites the project file and cannot be undone outside version control, so it requires confirm: true.',
        'To clean exported data without touching the project, use spine_export with clean: true instead.',
        'Requires a licensed Spine: the trial cannot save projects.',
      ].join(' '),
      inputSchema: {
        input: z
          .string()
          .describe('Project file, or a folder of .spine files.'),
        confirm: z
          .boolean()
          .optional()
          .describe('Must be true: this modifies and saves the project file in place.'),
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => guardTool(() => spineCleanup(host, spawn, args)),
  );

  server.registerTool(
    'spine_export_settings_capture',
    {
      title: 'Capture a project\'s last export settings',
      description: [
        'Write out the export settings a project last used (--last-export-settings).',
        'This is how the bundled export templates get calibrated: the real field names of the export settings JSON are not documented, so they have to come from a real file.',
        'Needs a project that has been exported at least once from the editor.',
      ].join(' '),
      inputSchema: {
        input: z.string().describe('Path to the .spine project file.'),
        output: z
          .string()
          .optional()
          .describe(
            'Where to write the settings JSON, inside the workspace. Omit to write next to the project.',
          ),
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => spineExportSettingsCapture(host, spawn, args)),
  );

  server.registerTool(
    'spine_batch',
    {
      title: 'Run several Spine CLI commands in one invocation',
      description: [
        'Chain multiple commands into a single Spine run. Spine starts once and applies them in order, which avoids paying the editor startup cost per project —',
        'the difference that matters when exporting a whole asset folder in CI.',
        'All capabilities are checked up front, so a batch containing one blocked operation is refused as a whole rather than half-executed.',
      ].join(' '),
      inputSchema: {
        commands: z
          .array(
            z.union([
              z.object({
                kind: z.literal('info'),
                input: z.string(),
              }),
              z.object({
                kind: z.literal('export'),
                input: z.string().optional(),
                output: z.string().optional(),
                exportSpec: z.string(),
                clean: z.boolean().optional(),
              }),
              z.object({
                kind: z.literal('pack'),
                input: z.string(),
                output: z.string(),
                packSpec: z.string(),
                name: z.string().optional(),
                projects: z.array(z.string()).optional(),
              }),
              z.object({
                kind: z.literal('unpack'),
                input: z.string(),
                output: z.string(),
                atlas: z.string(),
                projects: z.array(z.string()).optional(),
              }),
              z.object({
                kind: z.literal('import'),
                input: z.string(),
                output: z.string(),
                scale: z.number().positive().optional(),
                skeletonName: z.string().optional(),
              }),
              z.object({
                kind: z.literal('cleanup'),
                input: z.string(),
                confirm: z.boolean().optional(),
              }),
              z.object({
                kind: z.literal('last-export-settings'),
                input: z.string(),
                output: z.string().optional(),
              }),
            ]),
          )
          .min(1)
          .describe('Commands to run, in order.'),
        cleanAll: z
          .boolean()
          .optional()
          .describe(
            'Run animation clean up for every export in this invocation (--clean-all), instead of setting clean per command.',
          ),
        ...editorFlagSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guardTool(() =>
        spineBatch(host, spawn, {
          commands: args.commands as CommandDescriptor[],
          update: args.update,
          ignoreUnknown: args.ignoreUnknown,
          cleanAll: args.cleanAll,
          timeoutSeconds: args.timeoutSeconds,
        }),
      ),
  );
}
