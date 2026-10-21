// ============================================================
// Spine CLI output parsing.
//
// Two layers:
//   1. The launcher banner, whose exact lines are verified against a real
//      run of `SpineTrial.com --version` on Windows.
//   2. Project info bodies (`-i <path>`), whose field layout is NOT
//      documented by Esoteric Software. The parser below is deliberately
//      tolerant: it recognises `Key: value` pairs, maps the keys it knows,
//      keeps everything else in `fields`, and always returns the raw text.
//      Treat `fields`/`raw` as authoritative over the typed shortcuts.
// ============================================================

import { SpineEdition, SpineVersion } from './types';
import { parseVersion } from './spine-env';

/** Fields recognised in the launcher banner. */
export interface LauncherBanner {
  launcherVersion: SpineVersion | null;
  editorVersion: SpineVersion | null;
  edition: SpineEdition;
  /**
   * True when the run printed `Complete.`, which is how a CLI command
   * signals that it finished its work.
   */
  completed: boolean;
  /**
   * True when the run printed `Started.` without `Complete.` — the editor
   * came up as a GUI session instead of performing the command. This is
   * what happens when an editor instance is already running.
   */
  openedEditor: boolean;
}

const BANNER_PATTERNS: RegExp[] = [
  /^Spine Launcher\s+\S+/i,
  /^Esoteric Software LLC/i,
  /^Starting:\s*Spine\s+/i,
  /^Spine\s+\d+\.\d+/i,
  /^Started\.$/i,
  /^Complete\.$/i,
  /^OpenAL\b/i,
  /^Windows\b.*amd64/i,
  /^Mac\b/i,
  /^Linux\b/i,
  /^(Intel|NVIDIA|AMD|ATI|Apple|Microsoft)\b.*,.*/i,
  /^https?:\/\//i,
];

/** Parse the banner that every Spine CLI invocation prints first. */
export function parseLauncherBanner(stdout: string): LauncherBanner {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  let launcherVersion: SpineVersion | null = null;
  let editorVersion: SpineVersion | null = null;
  let trial = false;
  let sawVersion = false;
  let completed = false;
  let started = false;

  for (const line of lines) {
    const launcher = /^Spine Launcher\s+(\S+)(.*)$/i.exec(line);
    if (launcher) {
      launcherVersion = parseVersion(launcher[1]);
      sawVersion = true;
      if (/trial/i.test(launcher[2] ?? '')) trial = true;
      continue;
    }

    const starting = /^Starting:\s*Spine\s+(\S+)(.*)$/i.exec(line);
    if (starting) {
      editorVersion = parseVersion(starting[1]);
      sawVersion = true;
      if (/trial/i.test(starting[2] ?? '')) trial = true;
      continue;
    }

    const bare = /^Spine\s+(\d+\.\d+(?:\.\d+)?)(.*)$/i.exec(line);
    if (bare) {
      if (!editorVersion) editorVersion = parseVersion(bare[1]);
      sawVersion = true;
      if (/trial/i.test(bare[2] ?? '')) trial = true;
      continue;
    }

    if (/^Complete\.$/i.test(line)) completed = true;
    if (/^Started\.$/i.test(line)) started = true;
  }

  let edition = SpineEdition.Unknown;
  if (trial) edition = SpineEdition.Trial;
  else if (sawVersion) edition = SpineEdition.Licensed;

  return {
    launcherVersion,
    editorVersion,
    edition,
    completed,
    openedEditor: started && !completed,
  };
}

/** Drop banner lines, leaving the command's own output. */
export function stripBanner(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !BANNER_PATTERNS.some((pattern) => pattern.test(line.trim())));
}

/** One project (or data file) described by a `-i` info run. */
export interface ProjectInfoEntry {
  /** Path of the project or data file, when the output names one. */
  path: string | null;
  /** Spine version the project was saved with, when reported. */
  spineVersion: string | null;
  skeletons: number | null;
  animations: number | null;
  bones: number | null;
  slots: number | null;
  skins: number | null;
  events: number | null;
  /** Every `Key: value` pair found for this entry, keys lower-cased. */
  fields: Record<string, string>;
}

/** Result of parsing a `-i` info run. */
export interface ProjectInfoReport {
  banner: LauncherBanner;
  entries: ProjectInfoEntry[];
  /** Output lines that were not recognised as banner or `Key: value`. */
  unparsedLines: string[];
  /** Full stdout, always preserved. */
  raw: string;
}

const PATH_LINE = /(^|\s)(?<path>(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])?[^:*?"<>|\r\n]*\.(?:spine|json|skel))\s*:?\s*$/i;
const KEY_VALUE = /^(?<key>[A-Za-z][A-Za-z0-9 _/-]*?)\s*[:=]\s*(?<value>.*)$/;

function emptyEntry(path: string | null): ProjectInfoEntry {
  return {
    path,
    spineVersion: null,
    skeletons: null,
    animations: null,
    bones: null,
    slots: null,
    skins: null,
    events: null,
    fields: {},
  };
}

function toCount(value: string): number | null {
  const match = /-?\d+/.exec(value);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Apply a recognised key to the typed fields of an entry. */
function assignKnownField(entry: ProjectInfoEntry, key: string, value: string): void {
  const normalized = key.toLowerCase().replace(/\s+/g, ' ').trim();
  switch (normalized) {
    case 'spine':
    case 'version':
    case 'spine version':
    case 'saved with':
      entry.spineVersion = value.trim() || null;
      break;
    case 'skeleton':
    case 'skeletons':
      entry.skeletons = toCount(value);
      break;
    case 'animation':
    case 'animations':
      entry.animations = toCount(value);
      break;
    case 'bone':
    case 'bones':
      entry.bones = toCount(value);
      break;
    case 'slot':
    case 'slots':
      entry.slots = toCount(value);
      break;
    case 'skin':
    case 'skins':
      entry.skins = toCount(value);
      break;
    case 'event':
    case 'events':
      entry.events = toCount(value);
      break;
    case 'project':
    case 'file':
    case 'path':
      if (!entry.path) entry.path = value.trim() || null;
      break;
    default:
      break;
  }
}

/**
 * Parse the output of `Spine -i <path>`.
 *
 * The exact field layout is undocumented, so this parser recognises shapes
 * rather than a fixed schema: a line naming a `.spine`/`.json`/`.skel` file
 * starts a new entry, and `Key: value` lines populate it.
 */
export function parseProjectInfo(stdout: string): ProjectInfoReport {
  const banner = parseLauncherBanner(stdout);
  const body = stripBanner(stdout);
  const entries: ProjectInfoEntry[] = [];
  const unparsedLines: string[] = [];
  let current: ProjectInfoEntry | null = null;

  const ensureCurrent = (): ProjectInfoEntry => {
    if (!current) {
      current = emptyEntry(null);
      entries.push(current);
    }
    return current;
  };

  for (const rawLine of body) {
    const line = rawLine.trim();

    const keyValue = KEY_VALUE.exec(line);
    const pathMatch = PATH_LINE.exec(line);

    // A Windows drive letter (`C:\...`) also matches the key/value shape,
    // so a single-letter "key" means this is really a path line.
    const keyText = keyValue?.groups?.['key']?.trim() ?? '';
    const looksLikeDriveLetter = /^[A-Za-z]$/.test(keyText);

    // A bare path line (optionally ending in a colon) starts a new entry.
    // `Project: path` is handled as a key/value pair instead.
    if (pathMatch?.groups?.['path'] && (!keyValue || looksLikeDriveLetter)) {
      current = emptyEntry(pathMatch.groups['path'].trim());
      entries.push(current);
      continue;
    }

    if (keyValue?.groups) {
      const key = keyValue.groups['key'] ?? '';
      const value = keyValue.groups['value'] ?? '';
      const normalizedKey = key.toLowerCase().replace(/\s+/g, ' ').trim();

      // `Project:`/`File:` always begins a new entry.
      if (['project', 'file', 'path'].includes(normalizedKey)) {
        current = emptyEntry(value.trim() || null);
        entries.push(current);
        continue;
      }

      const entry = ensureCurrent();
      entry.fields[normalizedKey] = value.trim();
      assignKnownField(entry, key, value);
      continue;
    }

    unparsedLines.push(line);
  }

  return { banner, entries, unparsedLines, raw: stdout };
}

/** One-line summary of an info report, for chat output. */
export function summarizeProjectInfo(report: ProjectInfoReport): string {
  if (report.entries.length === 0) {
    return report.banner.openedEditor
      ? 'Spine opened an editor window instead of reporting project info.'
      : 'Spine returned no project information.';
  }

  const parts = report.entries.map((entry) => {
    const name = entry.path ?? 'project';
    const bits: string[] = [];
    if (entry.spineVersion) bits.push(`saved with ${entry.spineVersion}`);
    if (entry.skeletons !== null) bits.push(`${entry.skeletons} skeleton(s)`);
    if (entry.animations !== null) bits.push(`${entry.animations} animation(s)`);
    if (entry.bones !== null) bits.push(`${entry.bones} bone(s)`);
    const detail = bits.length > 0 ? `: ${bits.join(', ')}` : '';
    return `${name}${detail}`;
  });

  return parts.join('\n');
}
