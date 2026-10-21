import { atlasInspect, readTextFile, skeletonInspect } from '../../src/tools/data-tools';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';
import { MODERN_ATLAS, RICH_SKELETON, toJsonText } from '../helpers/fixtures';

const SKELETON_PATH = 'C:\\work\\project\\export\\hero.json';
const ATLAS_PATH = 'C:\\work\\project\\export\\hero.atlas';

const host = createFakeHost({
  files: {
    [SKELETON_PATH]: toJsonText(RICH_SKELETON),
    [ATLAS_PATH]: MODERN_ATLAS,
    'C:\\work\\project\\export\\broken.json': '{ not json',
  },
});

describe('readTextFile', () => {
  it('resolves a relative path against the workspace root', () => {
    const result = readTextFile(host, 'export/hero.json', 'skeleton data');
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.absolute).toBe(SKELETON_PATH);
  });

  it('reports a missing file', () => {
    const result = readTextFile(host, 'export/nope.json', 'skeleton data');
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });
});

describe('skeletonInspect', () => {
  it('inspects a skeleton file', () => {
    const result = skeletonInspect(host, { input: 'export/hero.json' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.file).toBe(SKELETON_PATH);
    expect(result.data.report.bones.count).toBe(9);
    expect(result.data.report.totals.animationCount).toBe(3);
    expect(result.data.atlasCrossCheck).toBeUndefined();
  });

  it('reports parse failures with a usable hint', () => {
    const result = skeletonInspect(host, { input: 'export/broken.json' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ParseFailed);
  });

  it('cross-checks against an atlas and names missing regions', () => {
    const result = skeletonInspect(host, {
      input: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const check = result.data.atlasCrossCheck!;
    expect(check.atlasFile).toBe(ATLAS_PATH);
    // The rich skeleton references blue/head, blue/torso and others that the
    // fixture atlas does not contain.
    expect(check.missingRegions).toContain('blue/head');
    expect(check.missingRegions).toContain('blue/torso');
    expect(result.summary).toContain('render as nothing at runtime');
  });

  it('reports a missing atlas file rather than silently skipping the check', () => {
    const result = skeletonInspect(host, {
      input: 'export/hero.json',
      atlas: 'export/missing.atlas',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });
});

describe('atlasInspect', () => {
  it('inspects an atlas file', () => {
    const result = atlasInspect(host, { input: 'export/hero.atlas' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.file).toBe(ATLAS_PATH);
    expect(result.data.report.totals.pageCount).toBe(2);
    expect(result.summary).toContain('packing efficiency');
  });

  it('rejects a file that is not an atlas', () => {
    const result = atlasInspect(host, { input: 'export/hero.json' });
    expect(result.ok).toBe(false);
  });
});
