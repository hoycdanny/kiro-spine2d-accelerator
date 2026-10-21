// ============================================================
// Texture packer settings (`pack.json`).
//
// Unlike export settings, this schema is fully documented, so it can be
// typed and validated field by field instead of templated blindly.
//
// Two things worth remembering about how Spine uses these files:
//  - A `pack.json` in an image folder configures packing for that folder,
//    and subfolders inherit it unless they have their own.
//  - When packing happens during data export with the "Attachments" source
//    mode (which is what `-e json+pack` / `binary+pack` use), `pack.json`
//    files are ignored entirely. Only the "Image folders" mode reads them.
// ============================================================

import { SpineErrorCode, SpineResult, err, ok } from './types';

/** Texture minification/magnification filters. */
export const TEXTURE_FILTERS = [
  'Nearest',
  'Linear',
  'MipMap',
  'MipMapNearestNearest',
  'MipMapLinearNearest',
  'MipMapNearestLinear',
  'MipMapLinearLinear',
] as const;

/** Texture wrap modes. */
export const TEXTURE_WRAPS = ['ClampToEdge', 'Repeat', 'MirroredRepeat'] as const;

/** In-memory pixel formats. */
export const TEXTURE_FORMATS = [
  'Alpha',
  'Intensity',
  'LuminanceAlpha',
  'RGB565',
  'RGBA4444',
  'RGB888',
  'RGBA8888',
] as const;

/** How images are arranged on a page. */
export const PACKING_MODES = ['grid', 'rectangles', 'polygons'] as const;

/** Output image formats. */
export const OUTPUT_FORMATS = ['png', 'jpg'] as const;

/** Scaling algorithms for multi-scale output. */
export const SCALE_RESAMPLING = ['nearest', 'bilinear', 'bicubic'] as const;

export type TextureFilter = (typeof TEXTURE_FILTERS)[number];
export type TextureWrap = (typeof TEXTURE_WRAPS)[number];
export type TextureFormat = (typeof TEXTURE_FORMATS)[number];
export type PackingMode = (typeof PACKING_MODES)[number];
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type ScaleResampling = (typeof SCALE_RESAMPLING)[number];

/** Every documented texture packer setting. */
export interface PackSettings {
  // Regions
  stripWhitespaceX: boolean;
  stripWhitespaceY: boolean;
  rotation: boolean;
  alias: boolean;
  ignoreBlankImages: boolean;
  alphaThreshold: number;
  // Region padding
  paddingX: number;
  paddingY: number;
  edgePadding: boolean;
  duplicatePadding: boolean;
  // Pages
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  pot: boolean;
  multipleOfFour: boolean;
  square: boolean;
  // Runtime hints
  filterMin: TextureFilter;
  filterMag: TextureFilter;
  wrapX: TextureWrap;
  wrapY: TextureWrap;
  format: TextureFormat;
  // Output
  outputFormat: OutputFormat;
  jpegQuality: number;
  packing: PackingMode;
  premultiplyAlpha: boolean;
  bleed: boolean;
  bleedIterations: number;
  scale: number[];
  scaleSuffix: string[];
  scaleResampling: ScaleResampling[];
  // Options
  atlasExtension: string;
  combineSubdirectories: boolean;
  flattenPaths: boolean;
  useIndexes: boolean;
  debug: boolean;
  fast: boolean;
  limitMemory: boolean;
  currentProject: boolean;
  silent: boolean;
  ignore: boolean;
  separator: string;
}

/** Spine's documented defaults for every setting. */
export const DEFAULT_PACK_SETTINGS: PackSettings = {
  stripWhitespaceX: true,
  stripWhitespaceY: true,
  rotation: true,
  alias: true,
  ignoreBlankImages: false,
  alphaThreshold: 3,
  paddingX: 2,
  paddingY: 2,
  edgePadding: true,
  duplicatePadding: false,
  minWidth: 16,
  minHeight: 16,
  maxWidth: 2048,
  maxHeight: 2048,
  pot: false,
  multipleOfFour: false,
  square: false,
  filterMin: 'Linear',
  filterMag: 'Linear',
  wrapX: 'ClampToEdge',
  wrapY: 'ClampToEdge',
  format: 'RGBA8888',
  outputFormat: 'png',
  jpegQuality: 0.9,
  packing: 'rectangles',
  premultiplyAlpha: true,
  bleed: false,
  bleedIterations: 2,
  scale: [1],
  scaleSuffix: [],
  scaleResampling: ['bicubic'],
  atlasExtension: '.atlas',
  combineSubdirectories: false,
  flattenPaths: false,
  useIndexes: false,
  debug: false,
  fast: false,
  limitMemory: true,
  currentProject: true,
  silent: false,
  ignore: false,
  separator: '_',
};

/** Every known setting name, used to detect typos in overrides. */
export const PACK_SETTING_KEYS = Object.keys(DEFAULT_PACK_SETTINGS) as Array<
  keyof PackSettings
>;

/** A validation problem in a pack settings object. */
export interface PackSettingIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
  fix: string;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const BOOLEAN_KEYS: Array<keyof PackSettings> = [
  'stripWhitespaceX',
  'stripWhitespaceY',
  'rotation',
  'alias',
  'ignoreBlankImages',
  'edgePadding',
  'duplicatePadding',
  'pot',
  'multipleOfFour',
  'square',
  'premultiplyAlpha',
  'bleed',
  'combineSubdirectories',
  'flattenPaths',
  'useIndexes',
  'debug',
  'fast',
  'limitMemory',
  'currentProject',
  'silent',
  'ignore',
];

const NON_NEGATIVE_INTEGER_KEYS: Array<keyof PackSettings> = [
  'paddingX',
  'paddingY',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'bleedIterations',
];

const ENUM_KEYS: Array<{ key: keyof PackSettings; values: readonly string[] }> = [
  { key: 'filterMin', values: TEXTURE_FILTERS },
  { key: 'filterMag', values: TEXTURE_FILTERS },
  { key: 'wrapX', values: TEXTURE_WRAPS },
  { key: 'wrapY', values: TEXTURE_WRAPS },
  { key: 'format', values: TEXTURE_FORMATS },
  { key: 'outputFormat', values: OUTPUT_FORMATS },
  { key: 'packing', values: PACKING_MODES },
];

/**
 * Validate a (possibly partial) pack settings object.
 *
 * Unknown keys are errors because Spine silently ignores them: a typo like
 * `premultiplyAlpa` would otherwise produce an atlas that blends wrong with
 * no indication of why.
 */
export function validatePackSettings(settings: Record<string, unknown>): PackSettingIssue[] {
  const issues: PackSettingIssue[] = [];
  const known = new Set<string>(PACK_SETTING_KEYS);

  for (const key of Object.keys(settings)) {
    if (!known.has(key)) {
      issues.push({
        field: key,
        severity: 'error',
        message: `"${key}" is not a texture packer setting.`,
        fix: `Remove it or correct the spelling. Spine ignores unknown keys, so a typo here silently has no effect. Known keys: ${PACK_SETTING_KEYS.join(', ')}.`,
      });
    }
  }

  for (const key of BOOLEAN_KEYS) {
    const value = settings[key];
    if (value !== undefined && !isBoolean(value)) {
      issues.push({
        field: key,
        severity: 'error',
        message: `"${key}" must be a boolean, got ${JSON.stringify(value)}.`,
        fix: 'Use true or false.',
      });
    }
  }

  for (const key of NON_NEGATIVE_INTEGER_KEYS) {
    const value = settings[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0 || !Number.isInteger(value)) {
      issues.push({
        field: key,
        severity: 'error',
        message: `"${key}" must be a non-negative integer, got ${JSON.stringify(value)}.`,
        fix: 'Use a whole number of pixels.',
      });
    }
  }

  for (const { key, values } of ENUM_KEYS) {
    const value = settings[key];
    if (value !== undefined && (typeof value !== 'string' || !values.includes(value))) {
      issues.push({
        field: key,
        severity: 'error',
        message: `"${key}" must be one of ${values.join(', ')}, got ${JSON.stringify(value)}.`,
        fix: `Use one of the documented values: ${values.join(', ')}.`,
      });
    }
  }

  const alphaThreshold = settings['alphaThreshold'];
  if (
    alphaThreshold !== undefined &&
    (!isFiniteNumber(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255)
  ) {
    issues.push({
      field: 'alphaThreshold',
      severity: 'error',
      message: `"alphaThreshold" must be between 0 and 255, got ${JSON.stringify(alphaThreshold)}.`,
      fix: 'Alpha is an 8-bit channel; the threshold is compared against it directly.',
    });
  }

  const jpegQuality = settings['jpegQuality'];
  if (
    jpegQuality !== undefined &&
    (!isFiniteNumber(jpegQuality) || jpegQuality < 0 || jpegQuality > 1)
  ) {
    issues.push({
      field: 'jpegQuality',
      severity: 'error',
      message: `"jpegQuality" must be between 0 and 1, got ${JSON.stringify(jpegQuality)}.`,
      fix: 'Use a fraction, e.g. 0.9 for 90% quality.',
    });
  }

  const scale = settings['scale'];
  if (scale !== undefined) {
    if (!Array.isArray(scale) || scale.length === 0 || !scale.every(isFiniteNumber)) {
      issues.push({
        field: 'scale',
        severity: 'error',
        message: '"scale" must be a non-empty array of numbers, e.g. [1] or [1, 0.5].',
        fix: 'One atlas is written per scale entry.',
      });
    } else if (scale.some((value) => value <= 0)) {
      issues.push({
        field: 'scale',
        severity: 'error',
        message: '"scale" entries must be greater than zero.',
        fix: 'Use values like 1, 0.5 or 2.',
      });
    }
  }

  const scaleSuffix = settings['scaleSuffix'];
  if (
    scaleSuffix !== undefined &&
    (!Array.isArray(scaleSuffix) || !scaleSuffix.every((value) => typeof value === 'string'))
  ) {
    issues.push({
      field: 'scaleSuffix',
      severity: 'error',
      message: '"scaleSuffix" must be an array of strings.',
      fix: 'Provide one suffix per scale, or an empty array to write each scale into its own subfolder.',
    });
  }

  const scaleResampling = settings['scaleResampling'];
  if (scaleResampling !== undefined) {
    if (
      !Array.isArray(scaleResampling) ||
      !scaleResampling.every(
        (value) => typeof value === 'string' && SCALE_RESAMPLING.includes(value as never),
      )
    ) {
      issues.push({
        field: 'scaleResampling',
        severity: 'error',
        message: `"scaleResampling" entries must be one of ${SCALE_RESAMPLING.join(', ')}.`,
        fix: 'Use bicubic for artwork and nearest for pixel art.',
      });
    }
  }

  for (const key of ['atlasExtension', 'separator'] as const) {
    const value = settings[key];
    if (value !== undefined && typeof value !== 'string') {
      issues.push({
        field: key,
        severity: 'error',
        message: `"${key}" must be a string.`,
        fix: key === 'atlasExtension' ? 'For example ".atlas".' : 'For example "_".',
      });
    }
  }

  return [...issues, ...crossFieldIssues(settings)];
}

/** Checks that involve more than one field. */
function crossFieldIssues(settings: Record<string, unknown>): PackSettingIssue[] {
  const issues: PackSettingIssue[] = [];
  const merged = { ...DEFAULT_PACK_SETTINGS, ...settings } as PackSettings;

  if (isFiniteNumber(merged.maxWidth) && isFiniteNumber(merged.minWidth)) {
    if (merged.maxWidth < merged.minWidth) {
      issues.push({
        field: 'maxWidth',
        severity: 'error',
        message: `maxWidth (${merged.maxWidth}) is smaller than minWidth (${merged.minWidth}).`,
        fix: 'Raise maxWidth or lower minWidth.',
      });
    }
  }

  if (isFiniteNumber(merged.maxHeight) && isFiniteNumber(merged.minHeight)) {
    if (merged.maxHeight < merged.minHeight) {
      issues.push({
        field: 'maxHeight',
        severity: 'error',
        message: `maxHeight (${merged.maxHeight}) is smaller than minHeight (${merged.minHeight}).`,
        fix: 'Raise maxHeight or lower minHeight.',
      });
    }
  }

  if (
    Array.isArray(merged.scale) &&
    Array.isArray(merged.scaleSuffix) &&
    merged.scaleSuffix.length > 0 &&
    merged.scaleSuffix.length !== merged.scale.length
  ) {
    issues.push({
      field: 'scaleSuffix',
      severity: 'error',
      message: `scaleSuffix has ${merged.scaleSuffix.length} entries but scale has ${merged.scale.length}.`,
      fix: 'Provide one suffix per scale, or leave scaleSuffix empty so each scale is written to its own subfolder.',
    });
  }

  if (
    Array.isArray(merged.scale) &&
    Array.isArray(merged.scaleResampling) &&
    merged.scaleResampling.length > 1 &&
    merged.scaleResampling.length !== merged.scale.length
  ) {
    issues.push({
      field: 'scaleResampling',
      severity: 'warning',
      message: `scaleResampling has ${merged.scaleResampling.length} entries but scale has ${merged.scale.length}.`,
      fix: 'Provide one resampling mode per scale, or a single mode for all of them.',
    });
  }

  if (merged.packing === 'polygons' && merged.currentProject === false) {
    issues.push({
      field: 'packing',
      severity: 'warning',
      message:
        'Polygon packing needs project context to know the mesh hulls, but currentProject is false.',
      fix: 'Set currentProject true, or pass the project with --project when packing from the CLI.',
    });
  }

  if (merged.outputFormat === 'jpg' && merged.premultiplyAlpha) {
    issues.push({
      field: 'outputFormat',
      severity: 'warning',
      message: 'JPG output has no alpha channel, so premultiplyAlpha has nothing to act on.',
      fix: 'Use png for anything with transparency.',
    });
  }

  if (merged.pot && merged.multipleOfFour) {
    issues.push({
      field: 'multipleOfFour',
      severity: 'warning',
      message: 'multipleOfFour is redundant when pot is enabled; powers of two above 2 are already divisible by 4.',
      fix: 'Keep only pot unless a tool specifically requires both.',
    });
  }

  if (merged.paddingX === 0 && merged.paddingY === 0 && merged.filterMin !== 'Nearest') {
    issues.push({
      field: 'paddingX',
      severity: 'warning',
      message:
        'Zero padding with a filter other than Nearest lets neighbouring regions bleed into each other.',
      fix: 'Use padding 2 with linear filtering, or switch the filter to Nearest for pixel art.',
    });
  }

  return issues;
}

/** Result of building a pack settings file. */
export interface BuiltPackSettings {
  settings: PackSettings;
  /** Keys whose value differs from Spine's default. */
  changedKeys: string[];
  issues: PackSettingIssue[];
}

/**
 * Build a complete pack settings object from a base plus overrides.
 *
 * Every field is written explicitly rather than relying on Spine's
 * defaults, so the file is self-documenting and a default change in a
 * future Spine release cannot silently alter a project's atlases.
 */
export function buildPackSettings(
  base: Partial<PackSettings>,
  overrides: Record<string, unknown> = {},
): SpineResult<BuiltPackSettings> {
  const baseIssues = validatePackSettings(base as Record<string, unknown>);
  const overrideIssues = validatePackSettings(overrides);
  const issues = [...baseIssues, ...overrideIssues];

  const blocking = issues.filter((issue) => issue.severity === 'error');
  if (blocking.length > 0) {
    return err(
      SpineErrorCode.ValidationFailed,
      `Invalid pack settings: ${blocking.map((issue) => issue.message).join(' ')}`,
      blocking.map((issue) => issue.fix).join(' '),
      { issues },
    );
  }

  const settings: PackSettings = {
    ...DEFAULT_PACK_SETTINGS,
    ...base,
    ...(overrides as Partial<PackSettings>),
  };

  const changedKeys = PACK_SETTING_KEYS.filter(
    (key) =>
      JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_PACK_SETTINGS[key]),
  );

  return ok(
    { settings, changedKeys, issues },
    `Pack settings built with ${changedKeys.length} non-default value(s).`,
  );
}

/** Serialize pack settings as the JSON Spine's packer reads. */
export function serializePackSettings(settings: PackSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** Explain the notable choices in a settings object. */
export function explainPackSettings(built: BuiltPackSettings): string {
  const { settings } = built;
  const lines: string[] = [];

  lines.push(
    `Pages up to ${settings.maxWidth}x${settings.maxHeight}` +
      `${settings.pot ? ', power-of-two' : ''}${settings.square ? ', square' : ''}, ` +
      `${settings.packing} packing, ${settings.outputFormat.toUpperCase()} output.`,
  );
  lines.push(
    `Filtering ${settings.filterMin}/${settings.filterMag} with padding ${settings.paddingX}/${settings.paddingY}` +
      `${settings.edgePadding ? ' including edges' : ''}${settings.duplicatePadding ? ', duplicated to hide seams' : ''}.`,
  );
  lines.push(
    `Premultiplied alpha ${settings.premultiplyAlpha ? 'on' : 'off'} — the runtime's blend mode must match this.`,
  );
  if (settings.stripWhitespaceX || settings.stripWhitespaceY) {
    lines.push(
      `Whitespace stripping on (threshold ${settings.alphaThreshold}); the atlas records the offsets so rendering stays correct.`,
    );
  }
  if (settings.scale.length > 1) {
    lines.push(
      `Multi-scale output: ${settings.scale.join(', ')} with suffixes ${
        settings.scaleSuffix.length > 0 ? settings.scaleSuffix.join(', ') : '(none — one subfolder per scale)'
      }.`,
    );
  }
  if (settings.packing === 'polygons') {
    lines.push(
      'Polygon packing is tighter but slower, and needs the project for mesh hulls.',
    );
  }

  const warnings = built.issues.filter((issue) => issue.severity === 'warning');
  for (const warning of warnings) {
    lines.push(`Warning (${warning.field}): ${warning.message} ${warning.fix}`);
  }

  return lines.join('\n');
}
