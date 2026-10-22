import {
  BaselineManifest,
  DEFAULT_THRESHOLDS,
  changedPixelMask,
  checkManifest,
  compareImages,
  explainMismatch,
  summarizeRegression,
} from '../../src/visual-regression';
import { decodePng, encodePng, solidImage, type RgbaImage } from '../../src/png';

function withPixel(
  base: RgbaImage,
  index: number,
  rgba: [number, number, number, number],
): RgbaImage {
  const copy: RgbaImage = {
    width: base.width,
    height: base.height,
    data: Buffer.from(base.data),
  };
  copy.data[index * 4] = rgba[0];
  copy.data[index * 4 + 1] = rgba[1];
  copy.data[index * 4 + 2] = rgba[2];
  copy.data[index * 4 + 3] = rgba[3];
  return copy;
}

const baseline = solidImage(10, 10, [10, 20, 30, 255]);

describe('PNG round trip', () => {
  it('encodes and decodes unchanged', () => {
    const decoded = decodePng(encodePng(baseline));
    expect(decoded.width).toBe(10);
    expect(decoded.height).toBe(10);
    expect(decoded.data.equals(baseline.data)).toBe(true);
  });

  it('rejects non-PNG input', () => {
    expect(() => decodePng(Buffer.from('nope'))).toThrow('Not a PNG');
  });
});

describe('compareImages', () => {
  it('passes identical images', () => {
    const comparison = compareImages('frame', baseline, baseline);
    expect(comparison.passed).toBe(true);
    expect(comparison.differentPixels).toBe(0);
    expect(comparison.maxChannelDelta).toBe(0);
    expect(comparison.totalPixels).toBe(100);
  });

  it('absorbs differences within the channel tolerance', () => {
    const nudged = withPixel(baseline, 5, [13, 20, 30, 255]);
    const comparison = compareImages('frame', baseline, nudged, {
      channelTolerance: 4,
      maxDifferentFraction: 0,
    });
    expect(comparison.passed).toBe(true);
    expect(comparison.differentPixels).toBe(0);
    expect(comparison.maxChannelDelta).toBe(3);
  });

  it('counts a pixel beyond the tolerance', () => {
    const changed = withPixel(baseline, 5, [255, 20, 30, 255]);
    const comparison = compareImages('frame', baseline, changed, {
      channelTolerance: 4,
      maxDifferentFraction: 0,
    });
    expect(comparison.passed).toBe(false);
    expect(comparison.differentPixels).toBe(1);
    expect(comparison.differentFraction).toBeCloseTo(0.01);
    expect(comparison.maxChannelDelta).toBe(245);
  });

  it('passes when the differing fraction is within budget', () => {
    const changed = withPixel(baseline, 5, [255, 20, 30, 255]);
    const comparison = compareImages('frame', baseline, changed, {
      channelTolerance: 4,
      maxDifferentFraction: 0.02,
    });
    expect(comparison.passed).toBe(true);
    expect(comparison.differentPixels).toBe(1);
  });

  it('marks differing pixels magenta and dims the rest', () => {
    const changed = withPixel(baseline, 0, [255, 255, 255, 255]);
    const comparison = compareImages('frame', baseline, changed, {
      channelTolerance: 4,
      maxDifferentFraction: 0,
    });
    const diff = comparison.diff!;
    expect([diff.data[0], diff.data[1], diff.data[2], diff.data[3]]).toEqual([
      255, 0, 255, 255,
    ]);
    // A matching pixel becomes dim grey.
    expect(diff.data[4]).toBe(diff.data[5]);
    expect(diff.data[4]).toBeLessThan(20);
  });

  it('fails outright on a size change', () => {
    const comparison = compareImages('frame', baseline, solidImage(12, 10, [10, 20, 30, 255]));
    expect(comparison.passed).toBe(false);
    expect(comparison.sizeMismatch).toBe(true);
    expect(comparison.differentFraction).toBe(1);
    expect(comparison.diff).toBeNull();
  });

  it('detects an alpha-only change', () => {
    const changed = withPixel(baseline, 7, [10, 20, 30, 0]);
    const comparison = compareImages('frame', baseline, changed, {
      channelTolerance: 4,
      maxDifferentFraction: 0,
    });
    expect(comparison.differentPixels).toBe(1);
  });
});

describe('changedPixelMask', () => {
  it('marks exactly the pixels beyond the channel tolerance', () => {
    const changed = withPixel(baseline, 5, [255, 20, 30, 255]);
    const result = changedPixelMask(baseline, changed, {
      channelTolerance: 4,
      maxDifferentFraction: 0,
    });

    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.mask).toHaveLength(100);
    expect(result.differentPixels).toBe(1);
    expect(result.maxChannelDelta).toBe(245);
    expect(result.mask[5]).toBe(1);
    expect([...result.mask].filter((flag) => flag === 1)).toHaveLength(1);
  });

  it('absorbs rasteriser jitter within the tolerance', () => {
    // Same rule compareImages applies, so a software rasteriser's edge
    // wobble is not reported as a real change by either of them.
    const nudged = withPixel(baseline, 5, [13, 20, 30, 255]);
    const result = changedPixelMask(baseline, nudged, {
      channelTolerance: 4,
      maxDifferentFraction: 0,
    });
    expect(result.differentPixels).toBe(0);
    expect(result.maxChannelDelta).toBe(3);
    expect([...result.mask].some((flag) => flag === 1)).toBe(false);
  });

  it('counts an alpha-only change', () => {
    const changed = withPixel(baseline, 7, [10, 20, 30, 0]);
    const result = changedPixelMask(baseline, changed, {
      channelTolerance: 4,
      maxDifferentFraction: 0,
    });
    expect(result.differentPixels).toBe(1);
    expect(result.mask[7]).toBe(1);
  });

  it('agrees with compareImages on the same pair', () => {
    let changed = withPixel(baseline, 5, [255, 20, 30, 255]);
    changed = withPixel(changed, 11, [10, 20, 30, 0]);
    changed = withPixel(changed, 42, [12, 22, 32, 255]); // within tolerance
    changed = withPixel(changed, 99, [10, 200, 30, 255]);

    const thresholds = { channelTolerance: 4, maxDifferentFraction: 0 };
    const mask = changedPixelMask(baseline, changed, thresholds);
    const comparison = compareImages('frame', baseline, changed, thresholds);

    expect(mask.differentPixels).toBe(comparison.differentPixels);
    expect(mask.maxChannelDelta).toBe(comparison.maxChannelDelta);
    expect(mask.differentPixels).toBe(3);
  });

  it('uses the default thresholds when none are given', () => {
    // Delta 5 against the baseline's 10, so just past the default tolerance.
    const changed = withPixel(baseline, 5, [15, 20, 30, 255]);
    expect(DEFAULT_THRESHOLDS.channelTolerance).toBe(4);
    expect(changedPixelMask(baseline, changed).differentPixels).toBe(1);
    expect(changedPixelMask(baseline, baseline).differentPixels).toBe(0);
  });

  it('throws on a size mismatch instead of reporting one', () => {
    // Both frames come off one canvas sized once, so differing sizes are a
    // defect in the probe path rather than an input condition.
    expect(() =>
      changedPixelMask(baseline, solidImage(12, 10, [10, 20, 30, 255])),
    ).toThrow('Frame size changed mid-comparison');
  });
});

describe('checkManifest', () => {
  const manifest: BaselineManifest = {
    version: 1,
    skeletonHash: 'hash-a',
    spineVersion: '4.2.37',
    animation: 'walk',
    skin: null,
    times: [0, 0.5],
    width: 256,
    height: 256,
    premultipliedAlpha: true,
    files: ['walk-00-0_000s.png', 'walk-01-0_500s.png'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const current = {
    skeletonHash: 'hash-a',
    animation: 'walk',
    times: [0, 0.5],
    width: 256,
    height: 256,
  };

  it('accepts a matching manifest', () => {
    expect(checkManifest(manifest, current).kind).toBe('none');
  });

  it('reports a missing manifest', () => {
    expect(checkManifest(null, current).kind).toBe('missing');
    expect(explainMismatch({ kind: 'missing' })).toContain('mode "update"');
  });

  it('reports a changed skeleton hash and points at skeleton_diff', () => {
    const mismatch = checkManifest(manifest, { ...current, skeletonHash: 'hash-b' });
    expect(mismatch.kind).toBe('hash');
    expect(explainMismatch(mismatch)).toContain('skeleton_diff');
  });

  it('reports a different animation', () => {
    const mismatch = checkManifest(manifest, { ...current, animation: 'idle' });
    expect(mismatch.kind).toBe('animation');
    expect(explainMismatch(mismatch)).toContain('separate baseline directory');
  });

  it('reports a different frame count', () => {
    const mismatch = checkManifest(manifest, { ...current, times: [0] });
    expect(mismatch.kind).toBe('frames');
  });

  it('reports different sample times', () => {
    const mismatch = checkManifest(manifest, { ...current, times: [0, 0.6] });
    expect(mismatch.kind).toBe('times');
    expect(explainMismatch(mismatch)).toContain('meaningless');
  });

  it('tolerates floating point noise in the times', () => {
    expect(
      checkManifest(manifest, { ...current, times: [0, 0.5000000001] }).kind,
    ).toBe('none');
  });

  it('reports a different canvas size', () => {
    const mismatch = checkManifest(manifest, { ...current, width: 512 });
    expect(mismatch.kind).toBe('size');
    expect(explainMismatch(mismatch)).toContain('256x256');
  });
});

describe('summarizeRegression', () => {
  it('summarizes a pass with per-frame numbers', () => {
    const summary = summarizeRegression({
      mode: 'check',
      baselineWritten: false,
      mismatch: { kind: 'none' },
      comparisons: [compareImages('frame-00.png', baseline, baseline)],
      thresholds: DEFAULT_THRESHOLDS,
      passed: true,
    });
    expect(summary).toContain('1/1 frame(s) within tolerance');
    expect(summary).toContain('frame-00.png: ok');
    expect(summary).toContain('Visual regression passed.');
  });

  it('summarizes a failure', () => {
    const changed = withPixel(baseline, 5, [255, 0, 0, 255]);
    const summary = summarizeRegression({
      mode: 'check',
      baselineWritten: false,
      mismatch: { kind: 'none' },
      comparisons: [
        compareImages('frame-00.png', baseline, changed, {
          channelTolerance: 4,
          maxDifferentFraction: 0,
        }),
      ],
      thresholds: { channelTolerance: 4, maxDifferentFraction: 0 },
      passed: false,
    });
    expect(summary).toContain('frame-00.png: FAIL');
    expect(summary).toContain('Visual regression failed.');
  });

  it('mentions a written baseline', () => {
    const summary = summarizeRegression({
      mode: 'update',
      baselineWritten: true,
      mismatch: { kind: 'missing' },
      comparisons: [],
      thresholds: DEFAULT_THRESHOLDS,
      passed: true,
    });
    expect(summary).toContain('Baseline written');
  });
});
