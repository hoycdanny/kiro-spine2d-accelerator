// ============================================================
// Texture atlas (`.atlas`) parsing and inspection.
//
// The atlas format is line based: one or more page entries, each with any
// number of region entries, separated by blank lines. Two generations
// exist and both are handled here:
//
//   4.0+       bounds: x, y, w, h   offsets: left, bottom, origW, origH
//   pre-4.0    xy: x, y   size: w, h   orig: w, h   offset: left, bottom
//
// `rotate` is `true`/`false` in the legacy format, and may be a degree
// value (0, 90, 180, 270) in the current one.
// ============================================================

import { SpineErrorCode, SpineResult, err, ok } from './types';

/** A single packed region. */
export interface AtlasRegion {
  name: string;
  /** Frame index for sequence regions; -1 when absent. */
  index: number;
  /** Position within the page image. */
  x: number;
  y: number;
  /** Packed size within the page image. */
  width: number;
  height: number;
  /** Size before packing; equals the packed size when nothing was stripped. */
  originalWidth: number;
  originalHeight: number;
  /** Whitespace stripped from the left and bottom edges. */
  offsetX: number;
  offsetY: number;
  /** Rotation in degrees; 90 covers the legacy `rotate: true`. */
  rotate: number;
  /** Ninepatch splits, when present. */
  split: number[] | null;
  /** Ninepatch padding, when present. */
  pad: number[] | null;
  /** Any other name/value pairs, which the format allows. */
  extra: Record<string, string>;
}

/** A page image and its regions. */
export interface AtlasPage {
  name: string;
  width: number;
  height: number;
  /** In-memory format hint; RGBA8888 when omitted. */
  format: string;
  /** Minification filter; Nearest when omitted. */
  filterMin: string;
  /** Magnification filter; Nearest when omitted. */
  filterMag: string;
  /** Wrap mode; `none` when omitted. */
  repeat: string;
  /** True when premultiplied alpha was applied to this page. */
  pma: boolean;
  /** Scale suffix recorded by multi-scale exports, when present. */
  scale: number | null;
  regions: AtlasRegion[];
}

export interface AtlasReport {
  pages: AtlasPage[];
  totals: {
    pageCount: number;
    regionCount: number;
    /** Regions stored rotated, which runtimes must compensate for. */
    rotatedCount: number;
    /** Regions that had whitespace stripped. */
    strippedCount: number;
    /** Sum of packed region areas. */
    usedPixels: number;
    /** Sum of page areas. */
    pagePixels: number;
    /** usedPixels / pagePixels, 0..1. Low values mean wasted texture memory. */
    packingEfficiency: number;
    /** Pages with premultiplied alpha. Mixing modes across pages is a bug. */
    pmaPages: number;
    /** Region names that appear more than once with the same index. */
    duplicateNames: string[];
    /** True when some pages use PMA and others do not. */
    mixedPremultiply: boolean;
    /** Pages whose dimensions are not powers of two. */
    nonPowerOfTwoPages: string[];
  };
  /** Lines that could not be interpreted, kept for diagnosis. */
  unparsedLines: string[];
}

const IMAGE_EXTENSION = /\.(png|jpg|jpeg|webp|ktx|basis)$/i;

function parseNumberList(value: string): number[] {
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
}

function parseRotate(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true') return 90;
  if (trimmed === 'false') return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyPage(name: string): AtlasPage {
  return {
    name,
    width: 0,
    height: 0,
    format: 'RGBA8888',
    filterMin: 'Nearest',
    filterMag: 'Nearest',
    repeat: 'none',
    pma: false,
    scale: null,
    regions: [],
  };
}

function emptyRegion(name: string): AtlasRegion {
  return {
    name,
    index: -1,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    originalWidth: 0,
    originalHeight: 0,
    offsetX: 0,
    offsetY: 0,
    rotate: 0,
    split: null,
    pad: null,
    extra: {},
  };
}

function applyPageProperty(page: AtlasPage, key: string, value: string): boolean {
  switch (key) {
    case 'size': {
      const [width, height] = parseNumberList(value);
      page.width = width ?? 0;
      page.height = height ?? 0;
      return true;
    }
    case 'format':
      page.format = value.trim();
      return true;
    case 'filter': {
      const parts = value.split(',').map((part) => part.trim());
      page.filterMin = parts[0] ?? 'Nearest';
      page.filterMag = parts[1] ?? page.filterMin;
      return true;
    }
    case 'repeat':
      page.repeat = value.trim();
      return true;
    case 'pma':
      page.pma = value.trim().toLowerCase() === 'true';
      return true;
    case 'scale': {
      const scale = Number(value.trim());
      page.scale = Number.isFinite(scale) ? scale : null;
      return true;
    }
    default:
      return false;
  }
}

function applyRegionProperty(region: AtlasRegion, key: string, value: string): void {
  switch (key) {
    case 'index': {
      const index = Number(value.trim());
      region.index = Number.isFinite(index) ? index : -1;
      return;
    }
    case 'bounds': {
      const [x, y, width, height] = parseNumberList(value);
      region.x = x ?? 0;
      region.y = y ?? 0;
      region.width = width ?? 0;
      region.height = height ?? 0;
      return;
    }
    case 'offsets': {
      const [offsetX, offsetY, originalWidth, originalHeight] = parseNumberList(value);
      region.offsetX = offsetX ?? 0;
      region.offsetY = offsetY ?? 0;
      region.originalWidth = originalWidth ?? 0;
      region.originalHeight = originalHeight ?? 0;
      return;
    }
    // Legacy (pre-4.0) region keys.
    case 'xy': {
      const [x, y] = parseNumberList(value);
      region.x = x ?? 0;
      region.y = y ?? 0;
      return;
    }
    case 'size': {
      const [width, height] = parseNumberList(value);
      region.width = width ?? 0;
      region.height = height ?? 0;
      return;
    }
    case 'orig': {
      const [width, height] = parseNumberList(value);
      region.originalWidth = width ?? 0;
      region.originalHeight = height ?? 0;
      return;
    }
    case 'offset': {
      const [offsetX, offsetY] = parseNumberList(value);
      region.offsetX = offsetX ?? 0;
      region.offsetY = offsetY ?? 0;
      return;
    }
    case 'rotate':
      region.rotate = parseRotate(value);
      return;
    case 'split':
      region.split = parseNumberList(value);
      return;
    case 'pad':
      region.pad = parseNumberList(value);
      return;
    default:
      region.extra[key] = value.trim();
  }
}

/** Pages plus any lines the parser could not interpret. */
export interface ParsedAtlas {
  pages: AtlasPage[];
  unparsedLines: string[];
}

/** Parse atlas text into pages and regions. */
export function parseAtlas(text: string): SpineResult<ParsedAtlas> {
  const lines = text.split(/\r?\n/);
  const pages: AtlasPage[] = [];
  const unparsedLines: string[] = [];
  let page: AtlasPage | null = null;
  let region: AtlasRegion | null = null;
  let expectPage = true;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      // A blank line ends the current page's regions.
      expectPage = true;
      region = null;
      continue;
    }

    const separator = line.indexOf(':');
    const isProperty = separator > 0;

    if (!isProperty || (expectPage && IMAGE_EXTENSION.test(line))) {
      if (expectPage || page === null) {
        // A page always starts with its image file name. Requiring the
        // extension is what keeps this parser from "successfully" reading
        // a JSON file or some other text as if it were an atlas.
        if (!IMAGE_EXTENSION.test(line)) {
          unparsedLines.push(line);
          continue;
        }
        page = emptyPage(line);
        pages.push(page);
        region = null;
        expectPage = false;
      } else {
        region = emptyRegion(line);
        page.regions.push(region);
      }
      continue;
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1);

    if (page === null) {
      // A property before any page name: malformed file.
      unparsedLines.push(line);
      continue;
    }

    if (region !== null) {
      applyRegionProperty(region, key, value);
      continue;
    }

    if (!applyPageProperty(page, key, value)) {
      // Unknown page-level key; surface it instead of dropping it silently.
      unparsedLines.push(line);
    }
  }

  if (pages.length === 0) {
    return err(
      SpineErrorCode.ParseFailed,
      'No atlas pages were found in this file.',
      'An atlas starts with a page image name such as "hero.png". Check that this is a .atlas file and not an image or skeleton data.',
    );
  }

  return ok({ pages, unparsedLines }, `Parsed ${pages.length} atlas page(s).`);
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/** Build the inspection report for parsed atlas pages. */
export function inspectAtlas(pages: AtlasPage[], unparsedLines: string[] = []): AtlasReport {
  let regionCount = 0;
  let rotatedCount = 0;
  let strippedCount = 0;
  let usedPixels = 0;
  let pagePixels = 0;
  let pmaPages = 0;
  const nonPowerOfTwoPages: string[] = [];
  const seen = new Map<string, number>();
  const duplicateNames: string[] = [];

  for (const page of pages) {
    pagePixels += page.width * page.height;
    if (page.pma) pmaPages += 1;
    if (!isPowerOfTwo(page.width) || !isPowerOfTwo(page.height)) {
      nonPowerOfTwoPages.push(page.name);
    }

    for (const region of page.regions) {
      regionCount += 1;
      if (region.rotate !== 0) rotatedCount += 1;

      const originalWidth = region.originalWidth || region.width;
      const originalHeight = region.originalHeight || region.height;
      if (originalWidth > region.width || originalHeight > region.height) {
        strippedCount += 1;
      }

      usedPixels += region.width * region.height;

      const key = `${region.name}#${region.index}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count === 2) duplicateNames.push(region.name);
    }
  }

  return {
    pages,
    totals: {
      pageCount: pages.length,
      regionCount,
      rotatedCount,
      strippedCount,
      usedPixels,
      pagePixels,
      packingEfficiency: pagePixels > 0 ? usedPixels / pagePixels : 0,
      pmaPages,
      duplicateNames,
      mixedPremultiply: pmaPages > 0 && pmaPages < pages.length,
      nonPowerOfTwoPages,
    },
    unparsedLines,
  };
}

/** Parse and inspect in one step. */
export function inspectAtlasText(text: string): SpineResult<AtlasReport> {
  const parsed = parseAtlas(text);
  if (!parsed.ok) return parsed;
  const report = inspectAtlas(parsed.data.pages, parsed.data.unparsedLines);
  return ok(report, summarizeAtlas(report));
}

/** Human-readable summary of an atlas report. */
export function summarizeAtlas(report: AtlasReport): string {
  const lines: string[] = [];
  const { totals } = report;

  lines.push(
    `${totals.pageCount} page(s), ${totals.regionCount} region(s), ` +
      `packing efficiency ${(totals.packingEfficiency * 100).toFixed(1)}%.`,
  );

  for (const page of report.pages) {
    lines.push(
      `  ${page.name}: ${page.width}x${page.height} ${page.format}, ` +
        `filter ${page.filterMin}/${page.filterMag}, pma ${page.pma}, ${page.regions.length} region(s).`,
    );
  }

  if (totals.rotatedCount > 0) {
    lines.push(`${totals.rotatedCount} region(s) stored rotated.`);
  }
  if (totals.strippedCount > 0) {
    lines.push(`${totals.strippedCount} region(s) had whitespace stripped.`);
  }
  if (totals.mixedPremultiply) {
    lines.push(
      'Pages disagree on premultiplied alpha. Runtimes pick blending per page, so mixed PMA usually renders incorrectly.',
    );
  }
  if (totals.nonPowerOfTwoPages.length > 0) {
    lines.push(
      `Non power-of-two pages: ${totals.nonPowerOfTwoPages.join(', ')}. Some toolkits require POT textures.`,
    );
  }
  if (totals.duplicateNames.length > 0) {
    lines.push(
      `Duplicate region names with the same index: ${totals.duplicateNames.join(', ')}.`,
    );
  }

  return lines.join('\n');
}

/**
 * Cross-check the region keys an exported skeleton needs against what the
 * atlas provides. A missing region renders as nothing at runtime, which is
 * the single most common "my character is invisible" cause.
 */
export function crossCheckRegions(
  requiredRegionKeys: string[],
  report: AtlasReport,
): { missing: string[]; unused: string[] } {
  const available = new Set<string>();
  for (const page of report.pages) {
    for (const region of page.regions) available.add(region.name);
  }

  const required = new Set(requiredRegionKeys);
  return {
    missing: [...required].filter((key) => !available.has(key)).sort(),
    unused: [...available].filter((name) => !required.has(name)).sort(),
  };
}
