// ============================================================
// Export settings JSON (the file `-e` consumes).
//
// IMPORTANT, and the reason this module looks different from
// `pack-settings.ts`: Esoteric Software documents the export *dialog*, but
// not the field names of the JSON that dialog's Save button writes. So
// this module never authors an export file from first principles. It takes
// a known-good template and applies a narrow diff on top, refusing keys
// the template does not already contain.
//
// Consequences of that choice:
//  - A template with wrong field names can only ever produce a wrong file;
//    it cannot produce a *subtly* wrong one with half-applied overrides.
//  - Calibration is a first-class step: `spine_export_settings_capture`
//    (CLI `--last-export-settings`) writes a real settings file from a real
//    project, which then replaces the bundled template.
//
// The bundled templates are shaped from the documented dialog options.
// See `templates/export-settings/README.md` for their provenance and the
// calibration procedure.
// ============================================================

import { SpineErrorCode, SpineResult, err, ok } from './types';

/** Built-in template names, resolved under `templates/export-settings/`. */
export const BUILT_IN_EXPORT_TEMPLATES = [
  'unity-binary',
  'web-json',
  'ci-batch',
] as const;

export type BuiltInExportTemplate = (typeof BUILT_IN_EXPORT_TEMPLATES)[number];

/** True when the name matches a bundled template. */
export function isBuiltInTemplate(name: string): name is BuiltInExportTemplate {
  return (BUILT_IN_EXPORT_TEMPLATES as readonly string[]).includes(name);
}

/** Relative path of a bundled template inside the package. */
export function builtInTemplateRelativePath(name: BuiltInExportTemplate): string {
  return `templates/export-settings/${name}.export.json`;
}

/** A validation note about an export settings object. */
export interface ExportSettingIssue {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix: string;
}

/**
 * Keys this project understands well enough to type-check. Anything else
 * in a template is passed through untouched — the template is the source
 * of truth, not this list.
 *
 * `packAtlas` is deliberately absent: it can be null, a boolean, or an
 * embedded texture packer settings block, and guessing would reject valid
 * captured templates.
 */
const TYPED_KEYS: Record<string, 'string' | 'boolean' | 'number'> = {
  class: 'string',
  extension: 'string',
  format: 'string',
  prettyPrint: 'boolean',
  nonessential: 'boolean',
  cleanUp: 'boolean',
  warnings: 'boolean',
  input: 'string',
  output: 'string',
  project: 'string',
};

/** Export classes the Spine CLI is known to accept in a settings file. */
export const KNOWN_EXPORT_CLASSES = ['export-json', 'export-binary'] as const;

/** Validate an export settings object as far as is safely possible. */
export function validateExportSettings(
  settings: Record<string, unknown>,
): ExportSettingIssue[] {
  const issues: ExportSettingIssue[] = [];

  const exportClass = settings['class'];
  if (typeof exportClass !== 'string' || exportClass.length === 0) {
    issues.push({
      field: 'class',
      severity: 'error',
      message: 'Export settings must declare a "class", e.g. "export-json" or "export-binary".',
      fix: 'Start from a bundled template, or capture a real one with spine_export_settings_capture.',
    });
  } else if (!(KNOWN_EXPORT_CLASSES as readonly string[]).includes(exportClass)) {
    issues.push({
      field: 'class',
      severity: 'info',
      message: `Export class "${exportClass}" is outside the data-export classes this Power targets (${KNOWN_EXPORT_CLASSES.join(', ')}).`,
      fix: 'Image and video exports are valid Spine classes but need an OS windowing system and OpenGL, which makes them unreliable in CI.',
    });
  }

  for (const [key, expected] of Object.entries(TYPED_KEYS)) {
    const value = settings[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== expected) {
      issues.push({
        field: key,
        severity: 'error',
        message: `"${key}" should be a ${expected}, got ${typeof value}.`,
        fix: `Correct the value in the template or the override.`,
      });
    }
  }

  const output = settings['output'];
  if (typeof output !== 'string' || output.trim().length === 0) {
    issues.push({
      field: 'output',
      severity: 'warning',
      message: 'No output path is set in the settings file.',
      fix: 'Set it here, or pass -o/--output on the command line, which overrides the settings file.',
    });
  }

  const input = settings['input'];
  if (typeof input !== 'string' || input.trim().length === 0) {
    issues.push({
      field: 'input',
      severity: 'info',
      message: 'No input path is set in the settings file.',
      fix: 'That is fine for reusable templates: pass -i/--input per project on the command line.',
    });
  }

  if (settings['nonessential'] === false) {
    issues.push({
      field: 'nonessential',
      severity: 'info',
      message:
        'Nonessential data is off, so the exported file cannot be imported back into Spine without losing information.',
      fix: 'Keep it off for shipping builds to save size; turn it on when the data needs to round-trip.',
    });
  }

  return issues;
}

/** Outcome of applying overrides to a template. */
export interface BuiltExportSettings {
  settings: Record<string, unknown>;
  /** Keys that were changed, with their before and after values. */
  changed: Array<{ key: string; from: unknown; to: unknown }>;
  /** Overrides whose key does not exist in the template. */
  unknownKeys: string[];
  /** Overrides that matched the template value, so nothing changed. */
  noopKeys: string[];
  issues: ExportSettingIssue[];
}

/** Options for {@link applyExportOverrides}. */
export interface ApplyOverridesOptions {
  /**
   * Allow keys the template does not contain. Off by default: an unknown
   * key is far more likely a typo than a field Spine will honour, and
   * Spine ignores keys it does not recognise without complaining.
   */
  allowNewKeys?: boolean;
}

/**
 * Apply a shallow diff to a template.
 *
 * Nested objects (e.g. an embedded `packAtlas` settings block) are replaced
 * wholesale rather than merged, because a partial merge into an
 * undocumented structure is exactly the kind of silent corruption this
 * module exists to avoid. Use dotted keys for one level of nesting.
 */
export function applyExportOverrides(
  template: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  options: ApplyOverridesOptions = {},
): SpineResult<BuiltExportSettings> {
  const settings: Record<string, unknown> = JSON.parse(JSON.stringify(template));
  const changed: BuiltExportSettings['changed'] = [];
  const unknownKeys: string[] = [];
  const noopKeys: string[] = [];

  for (const [key, value] of Object.entries(overrides)) {
    const [head, ...rest] = key.split('.');
    const isNested = rest.length > 0;

    if (isNested) {
      const container = settings[head!];
      if (typeof container !== 'object' || container === null || Array.isArray(container)) {
        unknownKeys.push(key);
        continue;
      }
      const nested = container as Record<string, unknown>;
      const leaf = rest.join('.');
      if (!(leaf in nested) && !options.allowNewKeys) {
        unknownKeys.push(key);
        continue;
      }
      if (JSON.stringify(nested[leaf]) === JSON.stringify(value)) {
        noopKeys.push(key);
        continue;
      }
      changed.push({ key, from: nested[leaf], to: value });
      nested[leaf] = value;
      continue;
    }

    if (!(key in settings) && !options.allowNewKeys) {
      unknownKeys.push(key);
      continue;
    }
    if (JSON.stringify(settings[key]) === JSON.stringify(value)) {
      noopKeys.push(key);
      continue;
    }
    changed.push({ key, from: settings[key], to: value });
    settings[key] = value;
  }

  if (unknownKeys.length > 0) {
    return err(
      SpineErrorCode.ValidationFailed,
      `These override keys do not exist in the template: ${unknownKeys.join(', ')}.`,
      'Spine silently ignores unknown keys, so this would produce a file that looks right and exports wrong. Check the spelling against the template, or pass allowNewKeys when you are certain the key is real.',
      { unknownKeys, templateKeys: Object.keys(template).sort() },
    );
  }

  const issues = validateExportSettings(settings);
  const blocking = issues.filter((issue) => issue.severity === 'error');
  if (blocking.length > 0) {
    return err(
      SpineErrorCode.ValidationFailed,
      `Invalid export settings: ${blocking.map((issue) => issue.message).join(' ')}`,
      blocking.map((issue) => issue.fix).join(' '),
      { issues },
    );
  }

  return ok(
    { settings, changed, unknownKeys, noopKeys, issues },
    `Export settings built from the template with ${changed.length} change(s).`,
  );
}

/** Serialize export settings for writing to disk. */
export function serializeExportSettings(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** Explain what a built export settings file will do. */
export function explainExportSettings(built: BuiltExportSettings): string {
  const { settings } = built;
  const lines: string[] = [];

  const exportClass = String(settings['class'] ?? 'unknown');
  const isBinary = exportClass === 'export-binary';
  lines.push(
    `${isBinary ? 'Binary' : 'JSON'} data export (${exportClass}) writing "${String(
      settings['extension'] ?? '',
    )}" files to "${String(settings['output'] ?? '(set on the command line)')}".`,
  );

  lines.push(
    isBinary
      ? 'Binary is smaller and much faster to load at runtime; use it for shipping builds.'
      : 'JSON is larger and slower to load, but human readable and easy for tools to process.',
  );

  if (settings['nonessential'] === true) {
    lines.push('Nonessential data is on, so the file can be imported back into Spine.');
  }
  if (settings['packAtlas'] !== undefined && settings['packAtlas'] !== null) {
    lines.push(
      'Packing happens during this export. Note that packing during data export with the Attachments source mode ignores pack.json files — run the texture packer separately when per-folder pack.json control is needed.',
    );
  }

  for (const change of built.changed) {
    lines.push(
      `  changed ${change.key}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`,
    );
  }
  for (const issue of built.issues.filter((entry) => entry.severity !== 'error')) {
    lines.push(`  ${issue.severity} (${issue.field}): ${issue.message} ${issue.fix}`);
  }

  return lines.join('\n');
}
