// ============================================================
// Visual regression comparison.
//
// Pure image maths: no file IO, no browser. The tool layer supplies decoded
// baselines and freshly rendered frames.
//
// Two ideas drive the design:
//  - A per-channel tolerance absorbs the small differences a software
//    rasteriser produces between runs, while a separate "fraction of
//    differing pixels" budget catches real changes. One threshold alone
//    cannot do both.
//  - Baselines are bound to the skeleton hash. When the data changes, the
//    honest answer is "this baseline no longer describes this skeleton",
//    not a pile of pixel diffs.
// ============================================================

import { RgbaImage } from './png';

/** Thresholds for one comparison. */
export interface RegressionThresholds {
  /**
   * Maximum per-channel difference (0..255) still considered equal.
   * Antialiasing on a software rasteriser moves edge pixels by a few units.
   */
  channelTolerance: number;
  /**
   * Maximum fraction of pixels (0..1) allowed to differ beyond the channel
   * tolerance before the comparison fails.
   */
  maxDifferentFraction: number;
}

/** Defaults chosen to pass on re-renders but fail on a one-pixel-wide shift. */
export const DEFAULT_THRESHOLDS: RegressionThresholds = {
  channelTolerance: 4,
  maxDifferentFraction: 0.002,
};

/** Result of comparing one frame. */
export interface FrameComparison {
  /** Frame label, normally the file name. */
  label: string;
  passed: boolean;
  /** Set when the images have different dimensions, which is never a pass. */
  sizeMismatch: boolean;
  baselineSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  differentPixels: number;
  totalPixels: number;
  differentFraction: number
  /** Largest per-channel difference seen. */
  maxChannelDelta: number;
  /** Diff image: dimmed baseline with differing pixels marked. */
  diff: RgbaImage | null;
}

/** Compare two images and build a diff image. */
export function compareImages(
  label: string,
  baseline: RgbaImage,
  actual: RgbaImage,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): FrameComparison {
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      label,
      passed: false,
      sizeMismatch: true,
      baselineSize: { width: baseline.width, height: baseline.height },
      actualSize: { width: actual.width, height: actual.height },
      differentPixels: actual.width * actual.height,
      totalPixels: actual.width * actual.height,
      differentFraction: 1,
      maxChannelDelta: 255,
      diff: null,
    };
  }

  const totalPixels = baseline.width * baseline.height;
  const diff: RgbaImage = {
    width: baseline.width,
    height: baseline.height,
    data: Buffer.alloc(baseline.data.length),
  };

  let differentPixels = 0;
  let maxChannelDelta = 0;

  for (let i = 0; i < baseline.data.length; i += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(
        (baseline.data[i + channel] ?? 0) - (actual.data[i + channel] ?? 0),
      );
      if (delta > pixelDelta) pixelDelta = delta;
    }
    if (pixelDelta > maxChannelDelta) maxChannelDelta = pixelDelta;

    if (pixelDelta > thresholds.channelTolerance) {
      differentPixels += 1;
      // Magenta marks a difference; it does not occur in dimmed greyscale.
      diff.data[i] = 255;
      diff.data[i + 1] = 0;
      diff.data[i + 2] = 255;
      diff.data[i + 3] = 255;
    } else {
      // Dimmed greyscale baseline for context.
      const grey = Math.round(
        ((baseline.data[i] ?? 0) + (baseline.data[i + 1] ?? 0) + (baseline.data[i + 2] ?? 0)) /
          3 /
          3,
      );
      diff.data[i] = grey;
      diff.data[i + 1] = grey;
      diff.data[i + 2] = grey;
      diff.data[i + 3] = baseline.data[i + 3] === 0 ? 40 : 255;
    }
  }

  const differentFraction = totalPixels === 0 ? 0 : differentPixels / totalPixels;

  return {
    label,
    passed: differentFraction <= thresholds.maxDifferentFraction,
    sizeMismatch: false,
    baselineSize: { width: baseline.width, height: baseline.height },
    actualSize: { width: actual.width, height: actual.height },
    differentPixels,
    totalPixels,
    differentFraction,
    maxChannelDelta,
    diff,
  };
}

/** Which pixels moved between two frames, without a diff image. */
export interface ChangedPixelMask {
  width: number;
  height: number;
  /** One byte per pixel, row-major from the top-left: 1 where it differs. */
  mask: Uint8Array;
  differentPixels: number;
  /** Largest per-channel difference seen. */
  maxChannelDelta: number;
}

/**
 * Mark the pixels that differ between two frames of the same canvas.
 *
 * The rule is identical to {@link compareImages}' — the maximum of the four
 * absolute channel deltas, counted as changed when strictly greater than
 * `thresholds.channelTolerance` — so there is one definition of "different"
 * in the repo and a software rasteriser's edge jitter is not mistaken for a
 * real change.
 *
 * Unlike `compareImages` this **throws** on a size mismatch instead of
 * reporting one. Every frame it compares comes off one canvas that was
 * sized once, so differing sizes are a defect in the caller, not an input
 * condition worth a result field; `guardTool` turns the throw into a
 * `CLI_FAILED` envelope.
 */
export function changedPixelMask(
  baseline: RgbaImage,
  actual: RgbaImage,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): ChangedPixelMask {
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error(
      `Frame size changed mid-comparison: ${baseline.width}x${baseline.height} then ${actual.width}x${actual.height}. ` +
        'Both frames must come from the same canvas at the same size.',
    );
  }

  const mask = new Uint8Array(baseline.width * baseline.height);
  let differentPixels = 0;
  let maxChannelDelta = 0;

  for (let i = 0; i < baseline.data.length; i += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(
        (baseline.data[i + channel] ?? 0) - (actual.data[i + channel] ?? 0),
      );
      if (delta > pixelDelta) pixelDelta = delta;
    }
    if (pixelDelta > maxChannelDelta) maxChannelDelta = pixelDelta;

    if (pixelDelta > thresholds.channelTolerance) {
      mask[i / 4] = 1;
      differentPixels += 1;
    }
  }

  return {
    width: baseline.width,
    height: baseline.height,
    mask,
    differentPixels,
    maxChannelDelta,
  };
}

/** Manifest stored alongside a baseline set. */
export interface BaselineManifest {
  /** Schema version of this manifest. */
  version: 1;
  /**
   * Skeleton hash the baseline was rendered from. A change here means the
   * baseline describes different data.
   */
  skeletonHash: string | null;
  /** Spine version that exported the skeleton. */
  spineVersion: string | null;
  animation: string | null;
  skin: string | null;
  times: number[];
  width: number;
  height: number;
  premultipliedAlpha: boolean;
  /** Baseline file names, in frame order. */
  files: string[];
  createdAt: string;
}

/** Why a baseline cannot be compared against the current data. */
export type BaselineMismatch =
  | { kind: 'none' }
  | { kind: 'missing' }
  | { kind: 'hash'; expected: string | null; found: string | null }
  | { kind: 'frames'; expected: number; found: number }
  | { kind: 'times'; expected: number[]; found: number[] }
  | { kind: 'size'; expected: string; found: string }
  | { kind: 'animation'; expected: string | null; found: string | null };

/** Check whether a manifest still describes the current render request. */
export function checkManifest(
  manifest: BaselineManifest | null,
  current: {
    skeletonHash: string | null;
    animation: string | null;
    times: number[];
    width: number;
    height: number;
  },
): BaselineMismatch {
  if (manifest === null) return { kind: 'missing' };

  if (manifest.skeletonHash !== current.skeletonHash) {
    return {
      kind: 'hash',
      expected: manifest.skeletonHash,
      found: current.skeletonHash,
    };
  }

  if (manifest.animation !== current.animation) {
    return {
      kind: 'animation',
      expected: manifest.animation,
      found: current.animation,
    };
  }

  if (manifest.files.length !== current.times.length) {
    return { kind: 'frames', expected: manifest.files.length, found: current.times.length };
  }

  const sameTimes =
    manifest.times.length === current.times.length &&
    manifest.times.every(
      (time, index) => Math.abs(time - (current.times[index] ?? 0)) < 1e-6,
    );
  if (!sameTimes) {
    return { kind: 'times', expected: manifest.times, found: current.times };
  }

  if (manifest.width !== current.width || manifest.height !== current.height) {
    return {
      kind: 'size',
      expected: `${manifest.width}x${manifest.height}`,
      found: `${current.width}x${current.height}`,
    };
  }

  return { kind: 'none' };
}

/** Explain a mismatch, including what to do about it. */
export function explainMismatch(mismatch: BaselineMismatch): string {
  switch (mismatch.kind) {
    case 'none':
      return 'The baseline matches the current render request.';
    case 'missing':
      return 'No baseline exists yet. Run with mode "update" to create one.';
    case 'hash':
      return `The baseline was rendered from skeleton hash ${mismatch.expected ?? 'unknown'}, but the data now hashes to ${mismatch.found ?? 'unknown'}. The skeleton changed, so pixel differences are expected rather than informative — review the change with skeleton_diff, then re-run with mode "update".`;
    case 'animation':
      return `The baseline covers animation ${mismatch.expected ?? '(setup pose)'}, not ${mismatch.found ?? '(setup pose)'}. Use a separate baseline directory per animation.`;
    case 'frames':
      return `The baseline has ${mismatch.expected} frame(s) but ${mismatch.found} were requested. Keep the sample times stable, or re-create the baseline.`;
    case 'times':
      return `The baseline sampled ${mismatch.expected.join(', ')}s but this run sampled ${mismatch.found.join(', ')}s. Comparing different moments is meaningless; re-create the baseline.`;
    case 'size':
      return `The baseline is ${mismatch.expected} but this run rendered ${mismatch.found}. Re-create the baseline at the new size.`;
    default:
      return 'Unknown mismatch.';
  }
}

/** Overall regression outcome. */
export interface RegressionReport {
  mode: 'check' | 'update';
  /** True when a baseline was written by this run. */
  baselineWritten: boolean;
  mismatch: BaselineMismatch;
  comparisons: FrameComparison[];
  thresholds: RegressionThresholds;
  passed: boolean;
}

/** Human-readable regression summary. */
export function summarizeRegression(report: RegressionReport): string {
  const lines: string[] = [];

  if (report.baselineWritten) {
    lines.push(
      `Baseline written (${report.comparisons.length === 0 ? 'no comparison performed' : 'and compared'}).`,
    );
  }

  if (report.mismatch.kind !== 'none') {
    lines.push(explainMismatch(report.mismatch));
  }

  if (report.comparisons.length > 0) {
    const failed = report.comparisons.filter((comparison) => !comparison.passed);
    lines.push(
      `${report.comparisons.length - failed.length}/${report.comparisons.length} frame(s) within tolerance ` +
        `(channel tolerance ${report.thresholds.channelTolerance}, budget ${(report.thresholds.maxDifferentFraction * 100).toFixed(3)}% of pixels).`,
    );

    for (const comparison of report.comparisons) {
      if (comparison.sizeMismatch) {
        lines.push(
          `  ${comparison.label}: size changed ${comparison.baselineSize.width}x${comparison.baselineSize.height} -> ${comparison.actualSize.width}x${comparison.actualSize.height}.`,
        );
        continue;
      }
      const status = comparison.passed ? 'ok' : 'FAIL';
      lines.push(
        `  ${comparison.label}: ${status} — ${comparison.differentPixels}/${comparison.totalPixels} px ` +
          `(${(comparison.differentFraction * 100).toFixed(3)}%), max channel delta ${comparison.maxChannelDelta}.`,
      );
    }
  }

  lines.push(report.passed ? 'Visual regression passed.' : 'Visual regression failed.');
  return lines.join('\n');
}
