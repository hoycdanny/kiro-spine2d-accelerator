// ============================================================
// Spine environment probe.
//
// Locates the Spine command-line executable, determines the installed
// edition and version, and derives the capability matrix that gates every
// write operation in the execution layer.
//
// All functions here are pure: file existence checks and file reads are
// injected so the module can be tested without touching the real install.
// ============================================================

import {
  SpineCapabilities,
  SpineEdition,
  SpineEnvironment,
  SpineEnvironmentInputs,
  SpineLogInfo,
  SpineVersion,
} from './types';

/** Predicate used to test whether a path exists. Injected for testability. */
export type PathExists = (path: string) => boolean;

/** Reads a UTF-8 text file, returning null when it cannot be read. */
export type ReadTextFile = (path: string) => string | null;

/**
 * Candidate installation directory, paired with the executable base name.
 *
 * Windows ships two executables: `Spine.exe` (GUI, returns immediately) and
 * `Spine.com` (console, waits for exit and returns an exit code). The CLI
 * must use the `.com` variant. The trial renames both to `SpineTrial.*`.
 */
export interface SpineInstallCandidate {
  dir: string;
  /** Base name without extension, e.g. `Spine` or `SpineTrial`. */
  baseName: string;
  /** User data directory that pairs with this install. */
  userDataDir: string;
  edition: SpineEdition;
}

const VERSION_PATTERN = /(\d+)\.(\d+)(?:\.(\d+))?/;

/**
 * Parse a Spine version string such as `4.3.26` or `4.2`.
 *
 * Returns null for non-numeric channels (`latest`, `stable`, `latestbeta`),
 * which are valid CLI values but carry no concrete version number.
 */
export function parseVersion(raw: string | null | undefined): SpineVersion | null {
  if (!raw) return null;
  const match = VERSION_PATTERN.exec(raw);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = match[3] === undefined ? 0 : Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  return { major, minor, patch, raw: raw.trim() };
}

/** Format a version back to `major.minor.patch`. */
export function formatVersion(version: SpineVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * The `spine-runtimes` branch that matches an editor version.
 *
 * Editor and runtime versions must match: data exported from a 4.2 editor
 * needs a 4.2 runtime. Branches are named `major.minor`.
 */
export function runtimeBranchFor(version: SpineVersion | null): string | null {
  if (!version) return null;
  return `${version.major}.${version.minor}`;
}

/**
 * Parse the contents of `spine.log`.
 *
 * A trial log looks like:
 * ```
 * Spine Launcher 4.3.08 Trial
 * Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com
 * Windows 10 Pro amd64 10.0
 * Intel, Intel(R) UHD Graphics 730, 4.6.0 - Build 32.0.101.7088
 * Starting: Spine 4.3.26 Trial
 * ```
 * A licensed log carries the same shape without the `Trial` suffix.
 */
export function parseSpineLog(content: string | null): SpineLogInfo {
  const empty: SpineLogInfo = {
    launcherVersion: null,
    editorVersion: null,
    edition: SpineEdition.Unknown,
    os: null,
    graphics: null,
  };
  if (!content) return empty;

  const lines = content.split(/\r?\n/).map((line) => line.trim());
  let launcherVersion: SpineVersion | null = null;
  let editorVersion: SpineVersion | null = null;
  let sawTrialMarker = false;
  let sawVersionLine = false;
  let os: string | null = null;
  let graphics: string | null = null;

  for (const line of lines) {
    if (line.length === 0) continue;

    const launcherMatch = /^Spine Launcher\s+(\S+)(.*)$/i.exec(line);
    if (launcherMatch) {
      launcherVersion = parseVersion(launcherMatch[1]);
      sawVersionLine = true;
      if (/trial/i.test(launcherMatch[2] ?? '')) sawTrialMarker = true;
      continue;
    }

    // `Starting: Spine 4.3.26 Trial` is the authoritative editor version:
    // it is the build the launcher actually loaded.
    const startingMatch = /^Starting:\s*Spine\s+(\S+)(.*)$/i.exec(line);
    if (startingMatch) {
      editorVersion = parseVersion(startingMatch[1]);
      sawVersionLine = true;
      if (/trial/i.test(startingMatch[2] ?? '')) sawTrialMarker = true;
      continue;
    }

    // Bare `Spine 4.3.26 Trial` line; only used when no `Starting:` line exists.
    const bareMatch = /^Spine\s+(\d+\.\d+(?:\.\d+)?)(.*)$/i.exec(line);
    if (bareMatch) {
      if (!editorVersion) editorVersion = parseVersion(bareMatch[1]);
      sawVersionLine = true;
      if (/trial/i.test(bareMatch[2] ?? '')) sawTrialMarker = true;
      continue;
    }

    if (/^Windows|^Mac|^Linux|amd64|aarch64/i.test(line) && os === null) {
      os = line;
      continue;
    }

    if (/graphics|opengl|nvidia|radeon|intel\(r\)/i.test(line) && graphics === null) {
      graphics = line;
    }
  }

  let edition = SpineEdition.Unknown;
  if (sawTrialMarker) {
    edition = SpineEdition.Trial;
  } else if (sawVersionLine) {
    // A version line without a trial marker means a licensed build.
    edition = SpineEdition.Licensed;
  }

  return { launcherVersion, editorVersion, edition, os, graphics };
}

/**
 * Parse `version.txt`, which records the version channel the launcher is
 * pinned to. Values may be concrete (`4.2.37`), wildcard (`4.2.xx`) or a
 * channel name (`latest`, `stable`, `latestbeta`, `beta`).
 */
export function parseVersionFile(content: string | null): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Derive the capability matrix from the installed edition.
 *
 * The trial permits everything except saving projects, texture packing and
 * exporting animation data / images / video. Every CLI command that writes
 * is therefore unavailable, leaving project info as the only usable one.
 */
export function capabilitiesFor(edition: SpineEdition): SpineCapabilities {
  const licensed = edition === SpineEdition.Licensed;
  return {
    canSave: licensed,
    canExport: licensed,
    canPack: licensed,
    canUnpack: licensed,
    canImport: licensed,
    canCleanup: licensed,
    canRenderImages: licensed,
    canInfo: true,
  };
}

/** Human-readable label for a capability key, used in gate messages. */
export const CAPABILITY_LABELS: Record<keyof SpineCapabilities, string> = {
  canSave: 'saving a project file',
  canExport: 'exporting skeleton data',
  canPack: 'packing a texture atlas',
  canUnpack: 'unpacking a texture atlas',
  canImport: 'importing data into a project',
  canCleanup: 'animation clean up (saves the project)',
  canRenderImages: 'exporting images or video',
  canInfo: 'reading project info',
};

/**
 * Default installation candidates, in priority order.
 *
 * Licensed installs come first so that a machine with both a licensed and a
 * trial install prefers the one that can actually export.
 */
export function defaultInstallCandidates(
  platform: NodeJS.Platform,
  homeDir: string,
  programFiles?: string,
): SpineInstallCandidate[] {
  if (platform === 'win32') {
    const pf = programFiles ?? 'C:\\Program Files';
    return [
      {
        dir: `${pf}\\Spine`,
        baseName: 'Spine',
        userDataDir: `${homeDir}\\Spine`,
        edition: SpineEdition.Licensed,
      },
      {
        dir: `${pf}\\Spine Trial`,
        baseName: 'SpineTrial',
        userDataDir: `${homeDir}\\SpineTrial`,
        edition: SpineEdition.Trial,
      },
    ];
  }

  if (platform === 'darwin') {
    return [
      {
        dir: '/Applications/Spine.app/Contents/MacOS',
        baseName: 'Spine',
        userDataDir: `${homeDir}/Spine`,
        edition: SpineEdition.Licensed,
      },
      {
        dir: '/Applications/Spine Trial.app/Contents/MacOS',
        baseName: 'SpineTrial',
        userDataDir: `${homeDir}/SpineTrial`,
        edition: SpineEdition.Trial,
      },
    ];
  }

  return [
    {
      dir: `${homeDir}/Spine`,
      baseName: 'Spine.sh',
      userDataDir: `${homeDir}/Spine`,
      edition: SpineEdition.Licensed,
    },
    {
      dir: `${homeDir}/SpineTrial`,
      baseName: 'SpineTrial.sh',
      userDataDir: `${homeDir}/SpineTrial`,
      edition: SpineEdition.Trial,
    },
  ];
}

/** Resolved executable pair for one installation. */
export interface ResolvedExecutables {
  /** Command-line executable. On Windows this is the `.com` variant. */
  cli: string | null;
  /** GUI executable, when the platform has a separate one. */
  gui: string | null;
}

/**
 * Resolve the executables inside a candidate directory.
 *
 * On Windows the `.com` console executable is required for CLI use: the
 * `.exe` returns immediately without an exit code.
 */
export function resolveExecutables(
  candidate: SpineInstallCandidate,
  platform: NodeJS.Platform,
  exists: PathExists,
): ResolvedExecutables {
  if (platform === 'win32') {
    const cli = `${candidate.dir}\\${candidate.baseName}.com`;
    const gui = `${candidate.dir}\\${candidate.baseName}.exe`;
    return {
      cli: exists(cli) ? cli : null,
      gui: exists(gui) ? gui : null,
    };
  }

  const sep = candidate.dir.endsWith('/') ? '' : '/';
  const direct = `${candidate.dir}${sep}${candidate.baseName}`;
  return {
    cli: exists(direct) ? direct : null,
    gui: null,
  };
}

/**
 * Compose a {@link SpineEnvironment} from already-read inputs.
 *
 * `spine.log` is the authoritative source for edition and version because it
 * records what the launcher actually started. The install directory name is
 * only a fallback hint.
 */
export function buildEnvironment(inputs: SpineEnvironmentInputs): SpineEnvironment {
  const log = parseSpineLog(inputs.logContent);
  const requestedVersion = parseVersionFile(inputs.versionFileContent);
  const notes: string[] = [];

  let edition = log.edition;
  if (edition === SpineEdition.Unknown && inputs.executable) {
    // Fall back to the executable name, which the trial installer suffixes.
    edition = /trial/i.test(inputs.executable)
      ? SpineEdition.Trial
      : SpineEdition.Licensed;
    notes.push(
      'Edition was inferred from the executable name because spine.log carried no version line.',
    );
  }

  const capabilities = capabilitiesFor(edition);
  const editorVersion = log.editorVersion ?? log.launcherVersion;

  if (!inputs.executable) {
    notes.push(
      'No Spine command-line executable was found. Install Spine, or pass an explicit executable path.',
    );
  }

  if (edition === SpineEdition.Trial) {
    notes.push(
      'Trial edition detected: saving, texture packing, and exporting data/images/video are disabled. Read-only project info still works.',
    );
  }

  if (edition === SpineEdition.Unknown) {
    notes.push(
      'Edition could not be determined. Write operations are blocked until it is confirmed; pass an explicit edition to override.',
    );
  }

  if (requestedVersion && !parseVersion(requestedVersion)) {
    notes.push(
      `The launcher is pinned to the "${requestedVersion}" channel, so the editor build can change between runs. Pin a concrete version with --update for reproducible CI exports.`,
    );
  }

  if (editorVersion && editorVersion.minor !== 2) {
    notes.push(
      `Installed editor is ${formatVersion(editorVersion)}; this Power targets the 4.2 baseline. Use --update 4.2.xx for exports consumed by 4.2 runtimes.`,
    );
  }

  return {
    found: inputs.executable !== null,
    executable: inputs.executable,
    guiExecutable: inputs.guiExecutable,
    installDir: inputs.installDir,
    userDataDir: inputs.userDataDir,
    edition,
    editorVersion,
    launcherVersion: log.launcherVersion,
    requestedVersion,
    capabilities,
    runtimeBranch: runtimeBranchFor(editorVersion),
    notes,
  };
}

/** Options for {@link probeEnvironment}. */
export interface ProbeOptions {
  platform: NodeJS.Platform;
  homeDir: string;
  programFiles?: string;
  /** Explicit executable path, e.g. from a `SPINE_EXECUTABLE` env var. */
  explicitExecutable?: string | null;
  /** Explicit user data directory override. */
  explicitUserDataDir?: string | null;
  candidates?: SpineInstallCandidate[];
  exists: PathExists;
  readText: ReadTextFile;
}

/**
 * Probe the local environment end to end: locate the executable, read
 * `spine.log` and `version.txt`, then derive edition and capabilities.
 */
export function probeEnvironment(options: ProbeOptions): SpineEnvironment {
  const sep = options.platform === 'win32' ? '\\' : '/';
  const candidates =
    options.candidates ??
    defaultInstallCandidates(options.platform, options.homeDir, options.programFiles);

  let executable: string | null = null;
  let guiExecutable: string | null = null;
  let installDir: string | null = null;
  let userDataDir: string | null = options.explicitUserDataDir ?? null;

  if (options.explicitExecutable && options.exists(options.explicitExecutable)) {
    executable = options.explicitExecutable;
    const lastSep = Math.max(
      options.explicitExecutable.lastIndexOf('\\'),
      options.explicitExecutable.lastIndexOf('/'),
    );
    installDir = lastSep > 0 ? options.explicitExecutable.slice(0, lastSep) : null;
  }

  if (!executable) {
    for (const candidate of candidates) {
      const resolved = resolveExecutables(candidate, options.platform, options.exists);
      if (resolved.cli) {
        executable = resolved.cli;
        guiExecutable = resolved.gui;
        installDir = candidate.dir;
        if (!userDataDir) userDataDir = candidate.userDataDir;
        break;
      }
    }
  }

  if (!userDataDir) {
    // Pick the first candidate whose user data directory exists, so edition
    // detection still works when the executable was passed explicitly.
    for (const candidate of candidates) {
      if (options.exists(candidate.userDataDir)) {
        userDataDir = candidate.userDataDir;
        break;
      }
    }
  }

  const logContent = userDataDir
    ? options.readText(`${userDataDir}${sep}spine.log`)
    : null;
  const versionFileContent = userDataDir
    ? options.readText(`${userDataDir}${sep}version.txt`)
    : null;

  return buildEnvironment({
    executable,
    guiExecutable,
    installDir,
    userDataDir,
    logContent,
    versionFileContent,
  });
}

/** One-line summary of an environment probe, for chat output. */
export function summarizeEnvironment(env: SpineEnvironment): string {
  if (!env.found) {
    return 'No Spine installation found.';
  }
  const version = env.editorVersion ? formatVersion(env.editorVersion) : 'unknown version';
  const writes = env.capabilities.canExport ? 'export enabled' : 'export blocked (trial)';
  return `Spine ${version} (${env.edition}), ${writes}, runtime branch ${env.runtimeBranch ?? 'unknown'}.`;
}
