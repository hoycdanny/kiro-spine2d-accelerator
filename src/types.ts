// ============================================================
// Shared types for the Spine 2D Power execution layer.
//
// Design note: every module in `src/` is a pure-function module.
// Side effects (file IO, subprocess spawning, browser control) are
// injected as collaborators so each module stays testable.
// ============================================================

// ------------------------------------------------------------
// Environment / capability model
// ------------------------------------------------------------

/**
 * Which Spine edition is installed. The trial has hard feature locks that
 * change what the CLI can do, so this drives the capability matrix.
 */
export enum SpineEdition {
  Trial = 'trial',
  Licensed = 'licensed',
  Unknown = 'unknown',
}

/** A parsed Spine version number, e.g. `4.3.26`. */
export interface SpineVersion {
  major: number;
  minor: number;
  patch: number;
  /** The original string as found in the log or settings file. */
  raw: string;
}

/**
 * What the installed Spine edition is actually allowed to do.
 *
 * The trial forbids saving projects, texture packing, and exporting
 * animation data / images / video. Everything that writes is therefore
 * unavailable, which leaves `-i` (info) and `--version` as the only
 * usable CLI commands.
 */
export interface SpineCapabilities {
  /** Save a `.spine` project file. */
  canSave: boolean;
  /** Export skeleton data (JSON / binary). */
  canExport: boolean;
  /** Pack a texture atlas. */
  canPack: boolean;
  /** Unpack a texture atlas into individual images. */
  canUnpack: boolean;
  /** Import JSON / binary / project data into a project (writes a project file). */
  canImport: boolean;
  /** Animation clean up (`-i` + `-m`), which saves the project file. */
  canCleanup: boolean;
  /** Export images / video (also requires an OS windowing system and OpenGL). */
  canRenderImages: boolean;
  /** Project info (`-i`), read-only. Available on every edition. */
  canInfo: boolean;
}

/** A single CLI capability key, used by the capability gate. */
export type SpineCapabilityKey = keyof SpineCapabilities;

/** The result of probing the local Spine installation. */
export interface SpineEnvironment {
  /** True when a usable Spine executable was located. */
  found: boolean;
  /** Preferred command-line executable (`.com` on Windows). */
  executable: string | null;
  /** GUI executable (`.exe` on Windows), kept for reference only. */
  guiExecutable: string | null;
  /** Installation directory the executables were found in. */
  installDir: string | null;
  /** User data directory holding `version.txt`, `spine.log`, `examples/`. */
  userDataDir: string | null;
  edition: SpineEdition;
  /** Version of the Spine editor that last started, from `spine.log`. */
  editorVersion: SpineVersion | null;
  /** Version of the Spine launcher, from `spine.log`. */
  launcherVersion: SpineVersion | null;
  /**
   * Version channel requested in `version.txt`, e.g. `latestbeta` or `4.2.xx`.
   * Non-numeric channels are preserved verbatim because the CLI accepts them.
   */
  requestedVersion: string | null;
  capabilities: SpineCapabilities;
  /**
   * The matching `spine-runtimes` branch for the installed editor
   * (e.g. `4.3`). Runtime and editor versions must match.
   */
  runtimeBranch: string | null;
  /** Human-readable findings and warnings, safe to surface to the developer. */
  notes: string[];
}

/** Parsed fields from a `spine.log` file. */
export interface SpineLogInfo {
  launcherVersion: SpineVersion | null;
  editorVersion: SpineVersion | null;
  edition: SpineEdition;
  /** OS line, e.g. `Windows 10 Pro amd64 10.0`. */
  os: string | null;
  /** Graphics line, useful when diagnosing image/video export failures. */
  graphics: string | null;
}

/** Inputs for {@link buildEnvironment}; all file reads happen outside. */
export interface SpineEnvironmentInputs {
  executable: string | null;
  guiExecutable: string | null;
  installDir: string | null;
  userDataDir: string | null;
  /** Raw contents of `spine.log`, or null when missing. */
  logContent: string | null;
  /** Raw contents of `version.txt`, or null when missing. */
  versionFileContent: string | null;
}

// ------------------------------------------------------------
// Generic tool result envelope
// ------------------------------------------------------------

/** Stable error codes returned by the execution layer. */
export enum SpineErrorCode {
  /** No Spine installation could be located. */
  SpineNotFound = 'SPINE_NOT_FOUND',
  /** The installed edition is not allowed to perform this operation. */
  CapabilityDenied = 'CAPABILITY_DENIED',
  /** A path argument escaped the allowed workspace root. */
  PathNotAllowed = 'PATH_NOT_ALLOWED',
  /** A required input file does not exist. */
  InputMissing = 'INPUT_MISSING',
  /** The Spine CLI exited with a non-zero status. */
  CliFailed = 'CLI_FAILED',
  /** The Spine CLI did not finish within the timeout. */
  CliTimeout = 'CLI_TIMEOUT',
  /** Input data could not be parsed (skeleton JSON, atlas, settings file). */
  ParseFailed = 'PARSE_FAILED',
  /** Input was parsed but violates a structural invariant. */
  ValidationFailed = 'VALIDATION_FAILED',
  /** A lint or regression gate reported failures. */
  GateFailed = 'GATE_FAILED',
  /** An optional dependency (Python sidecar, Playwright) is unavailable. */
  DependencyMissing = 'DEPENDENCY_MISSING',
  /** Caller supplied arguments that cannot be reconciled. */
  InvalidArgument = 'INVALID_ARGUMENT',
}

/** Successful tool result: structured data plus a human-readable summary. */
export interface SpineOk<T> {
  ok: true;
  /** Machine-readable payload. */
  data: T;
  /** Short human-readable summary, suitable for chat output. */
  summary: string;
}

/** Failed tool result. `hint` always tells the developer what to do next. */
export interface SpineErr {
  ok: false;
  code: SpineErrorCode;
  /** What went wrong. */
  message: string;
  /** What the developer should do about it. */
  hint: string;
  /** Optional structured context (command line, offending path, etc.). */
  details?: Record<string, unknown>;
}

export type SpineResult<T> = SpineOk<T> | SpineErr;

/** Build a successful result. */
export function ok<T>(data: T, summary: string): SpineOk<T> {
  return { ok: true, data, summary };
}

/** Build a failed result. */
export function err(
  code: SpineErrorCode,
  message: string,
  hint: string,
  details?: Record<string, unknown>,
): SpineErr {
  return details === undefined
    ? { ok: false, code, message, hint }
    : { ok: false, code, message, hint, details };
}
