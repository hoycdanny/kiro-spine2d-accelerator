// ============================================================
// Spine CLI command assembly.
//
// Pure functions that turn typed command descriptions into an argument
// array. Arguments are never concatenated into a shell string: the runner
// passes this array straight to the process, so paths with spaces and
// quotes need no escaping.
//
// Parameter names follow the Spine command line interface documentation.
// A single invocation may carry several commands, which is how batch
// exports avoid paying the editor startup cost repeatedly.
// ============================================================

import { SpineErrorCode, SpineResult, err, ok } from './types';

/** Editor-level flags that apply to the whole invocation. */
export interface EditorFlags {
  /**
   * Version of the Spine editor to load (`--update`). Accepts a concrete
   * version (`4.2.37`), a wildcard patch (`4.2.xx`), or a channel
   * (`latest`, `stable`, `latestbeta`, `beta`). Pin this in CI.
   */
  update?: string | null;
  /**
   * Let the launcher forward parameters it does not recognise
   * (`--ignore-unknown`), which happens when the launcher predates the
   * editor build.
   */
  ignoreUnknown?: boolean;
  /** Maximum heap in megabytes (`-Xmx<N>m`). Spine defaults to 2048. */
  maxMemoryMb?: number | null;
  /** Extra diagnostics (`--trace`). */
  trace?: boolean;
  /** Run animation clean up for every export in this invocation (`--clean-all`). */
  cleanAll?: boolean;
}

/** Read-only project information (`-i <path>`). Allowed on the trial. */
export interface InfoCommand {
  kind: 'info';
  /** Project file, data file, or a folder containing them. */
  input: string;
}

/**
 * Data export (`-e`). The export spec is either a path to an export
 * settings JSON file or one of the built-in shorthands.
 *
 * The shorthands (`json`, `binary`, `json+pack`, `binary+pack`) use default
 * settings and, importantly, ignore any `pack.json` files: packing during
 * data export with the shorthand uses the "Attachments" source mode.
 */
export interface ExportCommand {
  kind: 'export';
  input?: string | null;
  output?: string | null;
  /** Export settings JSON path, or `json`/`binary`/`json+pack`/`binary+pack`. */
  exportSpec: string;
  /** Run animation clean up before exporting (`-m`); does not modify the project. */
  clean?: boolean;
}

/** Write the project's last-used export settings to a JSON file. */
export interface LastExportSettingsCommand {
  kind: 'last-export-settings';
  input: string;
  /** Optional destination; defaults to next to the project file. */
  output?: string | null;
}

/** Texture atlas packing (`-p`). */
export interface PackCommand {
  kind: 'pack';
  /** Folder of images to pack. */
  input: string;
  /** Folder to write the atlas and page images to. */
  output: string;
  /** Atlas name, or a path to a pack settings JSON file. */
  packSpec: string;
  /** Atlas name prefix (`-n`), used when `packSpec` is a settings file. */
  name?: string | null;
  /**
   * Projects consulted for mesh hulls (`-j`). Required for polygon packing
   * and for whitespace stripping that respects mesh UVs.
   */
  projects?: string[];
}

/** Texture atlas unpacking (`-c`). */
export interface UnpackCommand {
  kind: 'unpack';
  /** Folder containing the atlas page images. */
  input: string;
  /** Folder to write the individual images to. */
  output: string;
  /** Path to the `.atlas` file. */
  atlas: string;
  /** Projects consulted to restore images packed as polygons (`-j`). */
  projects?: string[];
}

/** Import data into a project (`-r`). Creates the project when absent. */
export interface ImportCommand {
  kind: 'import';
  /** Project, JSON, or binary file to import — or a folder of them. */
  input: string;
  /** Destination project file. */
  output: string;
  /** Scale applied to the imported skeletons (`-s`). */
  scale?: number | null;
  /** Rename the imported skeleton; ignored when importing several. */
  skeletonName?: string | null;
}

/** Animation clean up (`-i` + `-m`). This one saves the project file. */
export interface CleanupCommand {
  kind: 'cleanup';
  /** Project file, or a folder of `.spine` files. */
  input: string;
}

export type SpineCommand =
  | InfoCommand
  | ExportCommand
  | LastExportSettingsCommand
  | PackCommand
  | UnpackCommand
  | ImportCommand
  | CleanupCommand;

/** Built-in export shorthands accepted by `-e`. */
export const EXPORT_SHORTHANDS = ['json', 'binary', 'json+pack', 'binary+pack'] as const;

/** True when the export spec is a built-in shorthand rather than a file path. */
export function isExportShorthand(spec: string): boolean {
  return (EXPORT_SHORTHANDS as readonly string[]).includes(spec.trim());
}

/** The capability each command needs. Used by the capability gate. */
export const COMMAND_CAPABILITY = {
  info: 'canInfo',
  export: 'canExport',
  'last-export-settings': 'canInfo',
  pack: 'canPack',
  unpack: 'canUnpack',
  import: 'canImport',
  cleanup: 'canCleanup',
} as const;

function requireNonEmpty(
  value: string | null | undefined,
  field: string,
  kind: string,
): SpineResult<string> {
  if (value === null || value === undefined || value.trim().length === 0) {
    return err(
      SpineErrorCode.InvalidArgument,
      `The "${field}" argument is required for a ${kind} command.`,
      `Supply ${field} and retry.`,
    );
  }
  return ok(value, '');
}

/** Editor-level flags, emitted before any command arguments. */
export function buildEditorArgs(flags: EditorFlags = {}): string[] {
  const args: string[] = [];
  if (flags.maxMemoryMb !== null && flags.maxMemoryMb !== undefined) {
    args.push(`-Xmx${Math.trunc(flags.maxMemoryMb)}m`);
  }
  if (flags.update !== null && flags.update !== undefined && flags.update.trim() !== '') {
    args.push('--update', flags.update.trim());
  }
  if (flags.ignoreUnknown) args.push('--ignore-unknown');
  if (flags.trace) args.push('--trace');
  if (flags.cleanAll) args.push('--clean-all');
  return args;
}

/** Arguments for a single command, in the order the CLI documents them. */
export function buildCommandArgs(command: SpineCommand): SpineResult<string[]> {
  switch (command.kind) {
    case 'info': {
      const input = requireNonEmpty(command.input, 'input', 'info');
      if (!input.ok) return input;
      return ok(['-i', input.data], '');
    }

    case 'export': {
      const spec = requireNonEmpty(command.exportSpec, 'exportSpec', 'export');
      if (!spec.ok) return spec;
      const args: string[] = [];
      if (command.input) args.push('-i', command.input);
      if (command.clean) args.push('-m');
      if (command.output) args.push('-o', command.output);
      args.push('-e', spec.data.trim());
      return ok(args, '');
    }

    case 'last-export-settings': {
      const input = requireNonEmpty(command.input, 'input', 'last-export-settings');
      if (!input.ok) return input;
      const args = ['-i', input.data];
      if (command.output) args.push('-o', command.output);
      args.push('--last-export-settings');
      return ok(args, '');
    }

    case 'pack': {
      const input = requireNonEmpty(command.input, 'input', 'pack');
      if (!input.ok) return input;
      const output = requireNonEmpty(command.output, 'output', 'pack');
      if (!output.ok) return output;
      const spec = requireNonEmpty(command.packSpec, 'packSpec', 'pack');
      if (!spec.ok) return spec;

      const args = ['-i', input.data];
      for (const project of command.projects ?? []) {
        args.push('-j', project);
      }
      args.push('-o', output.data);
      if (command.name) args.push('-n', command.name);
      args.push('-p', spec.data);
      return ok(args, '');
    }

    case 'unpack': {
      const input = requireNonEmpty(command.input, 'input', 'unpack');
      if (!input.ok) return input;
      const output = requireNonEmpty(command.output, 'output', 'unpack');
      if (!output.ok) return output;
      const atlas = requireNonEmpty(command.atlas, 'atlas', 'unpack');
      if (!atlas.ok) return atlas;

      const args = ['-i', input.data];
      for (const project of command.projects ?? []) {
        args.push('-j', project);
      }
      args.push('-o', output.data, '-c', atlas.data);
      return ok(args, '');
    }

    case 'import': {
      const input = requireNonEmpty(command.input, 'input', 'import');
      if (!input.ok) return input;
      const output = requireNonEmpty(command.output, 'output', 'import');
      if (!output.ok) return output;

      const args = ['-i', input.data];
      if (command.scale !== null && command.scale !== undefined) {
        if (!Number.isFinite(command.scale) || command.scale <= 0) {
          return err(
            SpineErrorCode.InvalidArgument,
            `Invalid import scale: ${command.scale}`,
            'Scale must be a positive number, e.g. 0.5 or 2.',
          );
        }
        args.push('-s', String(command.scale));
      }
      args.push('-o', output.data, '-r');
      // The skeleton name is optional: `-r` alone imports without renaming.
      if (command.skeletonName && command.skeletonName.trim() !== '') {
        args.push(command.skeletonName.trim());
      }
      return ok(args, '');
    }

    case 'cleanup': {
      const input = requireNonEmpty(command.input, 'input', 'cleanup');
      if (!input.ok) return input;
      return ok(['-i', input.data, '-m'], '');
    }

    default: {
      const exhaustive: never = command;
      return err(
        SpineErrorCode.InvalidArgument,
        `Unsupported command: ${JSON.stringify(exhaustive)}`,
        'Use one of: info, export, last-export-settings, pack, unpack, import, cleanup.',
      );
    }
  }
}

/**
 * Assemble a full argument array for one Spine invocation.
 *
 * Several commands may be chained; Spine applies them in order, which keeps
 * batch work to a single editor startup.
 */
export function buildArgs(
  commands: SpineCommand[],
  flags: EditorFlags = {},
): SpineResult<string[]> {
  if (commands.length === 0) {
    return err(
      SpineErrorCode.InvalidArgument,
      'No commands were supplied.',
      'Pass at least one command, e.g. { kind: "info", input: "project.spine" }.',
    );
  }

  const args = buildEditorArgs(flags);
  for (const command of commands) {
    const built = buildCommandArgs(command);
    if (!built.ok) return built;
    args.push(...built.data);
  }
  return ok(args, `Built ${commands.length} command(s) into ${args.length} argument(s).`);
}

/**
 * Render a command line for display and logging only.
 *
 * Quoting here is cosmetic: the runner never passes this string to a shell.
 */
export function formatCommandLine(executable: string, args: string[]): string {
  const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value);
  return [quote(executable), ...args.map(quote)].join(' ');
}
