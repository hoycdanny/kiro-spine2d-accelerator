import {
  crossCheckRegions,
  inspectAtlas,
  inspectAtlasText,
  parseAtlas,
  summarizeAtlas,
} from '../../src/atlas-data';
import { SpineErrorCode } from '../../src/types';
import { LEGACY_ATLAS, MODERN_ATLAS } from '../helpers/fixtures';

describe('parseAtlas (4.0+ format)', () => {
  const parsed = parseAtlas(MODERN_ATLAS);

  it('parses both pages', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.pages.map((page) => page.name)).toEqual(['hero.png', 'hero2.png']);
  });

  it('reads page properties', () => {
    if (!parsed.ok) return;
    const page = parsed.data.pages[0]!;
    expect(page.width).toBe(512);
    expect(page.height).toBe(256);
    expect(page.format).toBe('RGBA8888');
    expect(page.filterMin).toBe('Linear');
    expect(page.filterMag).toBe('Linear');
    expect(page.repeat).toBe('none');
    expect(page.pma).toBe(true);
  });

  it('applies documented defaults to the second page', () => {
    if (!parsed.ok) return;
    const page = parsed.data.pages[1]!;
    expect(page.pma).toBe(false);
    expect(page.repeat).toBe('x');
    expect(page.format).toBe('RGB565');
  });

  it('reads bounds and offsets', () => {
    if (!parsed.ok) return;
    const head = parsed.data.pages[0]!.regions[0]!;
    expect(head.name).toBe('head');
    expect([head.x, head.y, head.width, head.height]).toEqual([2, 2, 100, 80]);
    expect([head.offsetX, head.offsetY]).toEqual([1, 1]);
    expect([head.originalWidth, head.originalHeight]).toEqual([102, 82]);
    expect(head.rotate).toBe(90);
  });

  it('defaults index to -1 and rotate to 0', () => {
    if (!parsed.ok) return;
    const torso = parsed.data.pages[0]!.regions[1]!;
    expect(torso.index).toBe(-1);
    expect(torso.rotate).toBe(0);
    expect(torso.originalWidth).toBe(0);
  });

  it('reads an explicit index', () => {
    if (!parsed.ok) return;
    expect(parsed.data.pages[0]!.regions[2]!.index).toBe(0);
  });

  it('reads ninepatch split and pad', () => {
    if (!parsed.ok) return;
    const glow = parsed.data.pages[1]!.regions[0]!;
    expect(glow.split).toEqual([10, 10, 29, 10]);
    expect(glow.pad).toEqual([-1, -1, 28, 10]);
  });

  it('keeps unknown region keys as name/value pairs', () => {
    if (!parsed.ok) return;
    expect(parsed.data.pages[1]!.regions[0]!.extra['extrakey']).toBe('extraValue');
  });

  it('assigns regions to the right page', () => {
    if (!parsed.ok) return;
    expect(parsed.data.pages[0]!.regions).toHaveLength(3);
    expect(parsed.data.pages[1]!.regions).toHaveLength(1);
  });
});

describe('parseAtlas (legacy format)', () => {
  const parsed = parseAtlas(LEGACY_ATLAS);

  it('reads xy/size/orig/offset', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const head = parsed.data.pages[0]!.regions[0]!;
    expect([head.x, head.y]).toEqual([2, 2]);
    expect([head.width, head.height]).toEqual([100, 80]);
    expect([head.originalWidth, head.originalHeight]).toEqual([102, 82]);
    expect([head.offsetX, head.offsetY]).toEqual([1, 1]);
  });

  it('maps rotate: true to 90 degrees and false to 0', () => {
    if (!parsed.ok) return;
    expect(parsed.data.pages[0]!.regions[0]!.rotate).toBe(0);
    expect(parsed.data.pages[0]!.regions[1]!.rotate).toBe(90);
  });

  it('does not confuse the region `size` key with the page `size` key', () => {
    if (!parsed.ok) return;
    expect(parsed.data.pages[0]!.width).toBe(256);
    expect(parsed.data.pages[0]!.regions[0]!.width).toBe(100);
  });
});

describe('parseAtlas failures', () => {
  it('rejects a file with no page', () => {
    const result = parseAtlas('size: 10, 10\nformat: RGBA8888\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ParseFailed);
    expect(result.hint).toContain('hero.png');
  });

  it('rejects empty input', () => {
    expect(parseAtlas('').ok).toBe(false);
  });
});

describe('inspectAtlas', () => {
  const parsedModern = parseAtlas(MODERN_ATLAS);
  if (!parsedModern.ok) throw new Error('fixture atlas failed to parse');
  const report = inspectAtlas(parsedModern.data.pages, parsedModern.data.unparsedLines);

  it('counts pages, regions, rotation and stripping', () => {
    expect(report.totals.pageCount).toBe(2);
    expect(report.totals.regionCount).toBe(4);
    expect(report.totals.rotatedCount).toBe(1);
    expect(report.totals.strippedCount).toBe(1);
  });

  it('computes packing efficiency from packed region area', () => {
    // 100*80 + 50*90 + 64*128 + 32*32 = 21716 used
    // 512*256 + 128*128 = 147456 page pixels
    expect(report.totals.usedPixels).toBe(21716);
    expect(report.totals.pagePixels).toBe(147456);
    expect(report.totals.packingEfficiency).toBeCloseTo(21716 / 147456, 5);
  });

  it('flags disagreement about premultiplied alpha', () => {
    expect(report.totals.pmaPages).toBe(1);
    expect(report.totals.mixedPremultiply).toBe(true);
  });

  it('flags non power-of-two pages', () => {
    expect(report.totals.nonPowerOfTwoPages).toEqual([]);
  });

  it('detects non power-of-two sizes', () => {
    const odd = inspectAtlas([
      {
        name: 'odd.png',
        width: 300,
        height: 200,
        format: 'RGBA8888',
        filterMin: 'Linear',
        filterMag: 'Linear',
        repeat: 'none',
        pma: true,
        scale: null,
        regions: [],
      },
    ]);
    expect(odd.totals.nonPowerOfTwoPages).toEqual(['odd.png']);
  });

  it('detects duplicate region names sharing an index', () => {
    const duplicated = inspectAtlas([
      {
        name: 'p.png',
        width: 64,
        height: 64,
        format: 'RGBA8888',
        filterMin: 'Linear',
        filterMag: 'Linear',
        repeat: 'none',
        pma: true,
        scale: null,
        regions: [
          {
            name: 'head',
            index: -1,
            x: 0,
            y: 0,
            width: 8,
            height: 8,
            originalWidth: 8,
            originalHeight: 8,
            offsetX: 0,
            offsetY: 0,
            rotate: 0,
            split: null,
            pad: null,
            extra: {},
          },
          {
            name: 'head',
            index: -1,
            x: 8,
            y: 0,
            width: 8,
            height: 8,
            originalWidth: 8,
            originalHeight: 8,
            offsetX: 0,
            offsetY: 0,
            rotate: 0,
            split: null,
            pad: null,
            extra: {},
          },
        ],
      },
    ]);
    expect(duplicated.totals.duplicateNames).toEqual(['head']);
  });

  it('reports zero efficiency rather than dividing by zero', () => {
    expect(inspectAtlas([]).totals.packingEfficiency).toBe(0);
  });
});

describe('inspectAtlasText', () => {
  it('parses and inspects in one step', () => {
    const result = inspectAtlasText(MODERN_ATLAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totals.regionCount).toBe(4);
    expect(result.summary).toContain('2 page(s), 4 region(s)');
  });

  it('propagates parse failures', () => {
    expect(inspectAtlasText('').ok).toBe(false);
  });
});

describe('summarizeAtlas', () => {
  it('lists each page and warns about mixed PMA', () => {
    const result = inspectAtlasText(MODERN_ATLAS);
    if (!result.ok) return;
    const summary = summarizeAtlas(result.data);
    expect(summary).toContain('hero.png: 512x256 RGBA8888');
    expect(summary).toContain('1 region(s) stored rotated');
    expect(summary).toContain('1 region(s) had whitespace stripped');
    expect(summary).toContain('disagree on premultiplied alpha');
  });
});

describe('crossCheckRegions', () => {
  const report = inspectAtlasText(MODERN_ATLAS);

  it('reports regions the skeleton needs but the atlas lacks', () => {
    if (!report.ok) return;
    const check = crossCheckRegions(['head', 'torso', 'missing-arm'], report.data);
    expect(check.missing).toEqual(['missing-arm']);
  });

  it('reports atlas regions nothing references', () => {
    if (!report.ok) return;
    const check = crossCheckRegions(['head'], report.data);
    expect(check.unused).toEqual(['fx/glow', 'leg-left', 'torso']);
  });

  it('passes when every region is present', () => {
    if (!report.ok) return;
    const check = crossCheckRegions(['head', 'torso', 'leg-left', 'fx/glow'], report.data);
    expect(check.missing).toEqual([]);
    expect(check.unused).toEqual([]);
  });
});
