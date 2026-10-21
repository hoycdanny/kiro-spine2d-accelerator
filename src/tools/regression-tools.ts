// ============================================================
// Group D — `visual_regression`.
//
// Renders the same frames as the baseline and compares them pixel by
// pixel. Baselines are bound to the skeleton hash, so "the data changed"
// is reported as its own outcome instead of being drowned in diffs.
//
// The gate: a failing comparison comes back as GATE_FAILED, which makes
// this usable as the last step of a CI pipeline.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { join } from 'node:path';
import { z } from 'zod';

import { SpineHost } from '../host';
import { resolveWriteTarget } from '../path-safety';
import { RgbaImage, decodePng, encodePng } from '../png';
import { BrowserLauncher, createPlaywrightLauncher } from '../preview-renderer';
import { guardTool } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import {
  BaselineManifest,
  DEFAULT_THRESHOLDS,
  FrameComparison,
  RegressionReport,
  RegressionThresholds,
  checkManifest,
  compareImages,
  summarizeRegression,
} from '../visual-regression';
import { RenderRequest, frameFileName, prepareRender } from './preview-tools';

/** File name of the manifest inside a baseline directory. */
export const MANIFEST_FILE = 'baseline.json';

/** Read and validate a baseline manifest. */
export function readManifest(
  host: SpineHost,
  baselineDir: string,
): SpineResult<BaselineManifest | null> {
  const path = join(baselineDir, MANIFEST_FILE);
  const text = host.readText(path);
  if (text === null) return ok(null, 'No baseline manifest found.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return err(
      SpineErrorCode.ParseFailed,
      `Baseline manifest is not valid JSON: ${path}`,
      `Delete it and re-create the baseline with mode "update". ${cause instanceof Error ? cause.message : ''}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(
      SpineErrorCode .ValidationFailed,
      `Baseline manifest must be a JSON object: ${path}`,
      'Delete it and re-create the baseline with mode "update".',
    );
  }

  const manifest = parsed as Partial<BaselineManifest>;
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.times)) {
    return err(
      SpineErrorCode.ValidationFailed,
      `Baseline manifest is missing its files or times: ${path}`,
      'Delete it and re-create the baseline with mode "update".',
    );
  }

  return ok(manifest as BaselineManifest, 'Baseline manifest loaded.');
}

/** Payload returned by `visual_regression`. */
export interface VisualRegressionData {
  skeletonFile: string;
  atlasFile: string;
  baselineDir: string;
  diffDir: string | null;
  animation: string | null;
  times: number[];
  report: RegressionReport;
  /** Baseline files written by this run, if any. */
  baselineFiles: string[];
  /** Diff images written by this run. */
  diffFiles: string[];
}

/** Compare a fresh render against a stored baseline. */
export async function visualRegression(
  host: SpineHost,
  launcher: BrowserLauncher,
  args: RenderRequest & {
    baselineDir: string;
    diffDir?: string | undefined;
    mode?: 'check' | 'update' | undefined;
    channelTolerance?: number | undefined;
    maxDifferentFraction?: number | undefined;
  },
): Promise<SpineResult<VisualRegressionData>> {
  const baselineTarget = resolveWriteTarget(args.baselineDir, host.workspaceRoot);
  if (!baselineTarget.ok) return baselineTarget;
  const baselineDir = baselineTarget.data;

  let diffDir: string | null = null;
  if (args.diffDir) {
    const target = resolveWriteTarget(args.diffDir, host.workspaceRoot);
    if (!target.ok) return target;
    diffDir = target.data;
  }

  const manifestResult = readManifest(host, baselineDir);
  if (!manifestResult.ok) return manifestResult;

  const prepared = await prepareRender(host, launcher, args);
  if (!prepared.ok) return prepared;

  const { skeletonFile, atlasFile, skeleton, animation, times, render } = prepared.data;
  const mode = args.mode ?? 'check';

  const thresholds: RegressionThresholds = {
    channelTolerance: args.channelTolerance ?? DEFAULT_THRESHOLDS.channelTolerance,
    maxDifferentFraction:
      args.maxDifferentFraction ?? DEFAULT_THRESHOLDS.maxDifferentFraction,
  };

  const mismatch = checkManifest(manifestResult.data, {
    skeletonHash: skeleton.meta.hash,
    animation,
    times,
    width: render.width,
    height: render.height,
  });

  const fileNames = render.frames.map((frame, index) =>
    frameFileName(animation, frame.time, index),
  );

  const baselineFiles: string[] = [];
  const diffFiles: string[] = [];
  let baselineWritten = false;
  let comparisons: FrameComparison[] = [];

  const writeBaseline = () => {
    for (const [index, frame] of render.frames.entries()) {
      const path = join(baselineDir, fileNames[index]!);
      host.writeBinary(path, frame.png);
      baselineFiles.push(path);
    }

    const manifest: BaselineManifest = {
      version: 1,
      skeletonHash: skeleton.meta.hash,
      spineVersion: skeleton.meta.spineVersion,
      animation,
      skin: args.skin ?? null,
      times,
      width: render.width,
      height: render.height,
      premultipliedAlpha: prepared.data.premultipliedAlpha,
      files: fileNames,
      createdAt: new Date().toISOString(),
    };
    host.writeText(join(baselineDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    baselineWritten = true;
  };

  if (mode === 'update') {
    writeBaseline();
  } else if (mismatch.kind !== 'none') {
    // Nothing comparable: report the mismatch rather than pixel noise.
    const report: RegressionReport = {
      mode,
      baselineWritten: false,
      mismatch,
      comparisons: [],
      thresholds,
      passed: false,
    };
    return err(
      SpineErrorCode.GateFailed,
      `Visual regression could not run: ${mismatch.kind}.`,
      summarizeRegression(report),
      {
        baselineDir,
        mismatch,
        currentHash: skeleton.meta.hash,
      },
    );
  } else {
    comparisons = [];
    for (const [index, frame] of render.frames.entries()) {
      const name = fileNames[index]!;
      const baselinePath = join(baselineDir, name);
      const baselineBytes = host.readBinary(baselinePath);

      if (baselineBytes === null) {
        return err(
          SpineErrorCode.InputMissing,
          `Baseline image is missing: ${baselinePath}`,
          'The manifest lists it but the file is absent. Re-create the baseline with mode "update".',
        );
      }

      let baselineImage: RgbaImage;
      let actualImage: RgbaImage;
      try {
        baselineImage = decodePng(baselineBytes);
        actualImage = decodePng(frame.png);
      } catch (cause) {
        return err(
          SpineErrorCode.ParseFailed,
          `Could not decode a PNG for comparison: ${cause instanceof Error ? cause.message : String(cause)}`,
          'Baselines must be RGBA PNGs as written by this tool. Re-create the baseline with mode "update".',
        );
      }

      const comparison = compareImages(name, baselineImage, actualImage, thresholds);
      comparisons.push(comparison);

      if (!comparison.passed && comparison.diff && diffDir !== null) {
        const diffPath = join(diffDir, name);
        host.writeBinary(diffPath, encodePng(comparison.diff));
        diffFiles.push(diffPath);
      }
    }
  }

  const report: RegressionReport = {
    mode,
    baselineWritten,
    mismatch,
    // Diff images are dropped from the reported comparisons: each one is a
    // full RGBA buffer, and serialising four of them into a tool result is
    // megabytes of pixel data that no caller can use. The images that
    // matter were already written to `diffDir`.
    comparisons: comparisons.map((comparison) => ({ ...comparison, diff: null })),
    thresholds,
    passed: comparisons.every((comparison) => comparison.passed),
  };

  const summaryLines = [summarizeRegression(report)];
  if (baselineWritten) {
    summaryLines.push(`Baseline directory: ${baselineDir}`);
  }
  if (diffFiles.length > 0) {
    summaryLines.push(`Diff images: ${diffFiles.join(', ')}`);
  } else if (!report.passed && diffDir === null) {
    summaryLines.push('Pass `diffDir` to write diff images for the failing frames.');
  }
  summaryLines.push(
    'Note: these renders come from the spine-ts runtime in headless Chromium. Spine\'s own image export is the authoritative visual output; this path exists to verify data automatically.',
  );

  const data: VisualRegressionData = {
    skeletonFile,
    atlasFile,
    baselineDir,
    diffDir,
    animation,
    times,
    report,
    baselineFiles,
    diffFiles,
  };

  if (!report.passed) {
    // Deliberately compact: a comparison carries a full diff image, and
    // putting that in the error payload would bury the actionable part.
    return err(
      SpineErrorCode.GateFailed,
      `Visual regression failed for ${report.comparisons.filter((comparison) => !comparison.passed).length} frame(s).`,
      summaryLines.join('\n'),
      {
        baselineDir,
        diffFiles,
        failedFrames: report.comparisons
          .filter((comparison) => !comparison.passed)
          .map((comparison) => ({
            frame: comparison.label,
            differentPixels: comparison.differentPixels,
            totalPixels: comparison.totalPixels,
            differentFraction: Number(comparison.differentFraction.toFixed(6)),
            maxChannelDelta: comparison.maxChannelDelta,
            sizeMismatch: comparison.sizeMismatch,
          })),
      },
    );
  }

  return ok(data, summaryLines.join('\n'));
}

/** Register the regression tool. */
export function registerRegressionTools(
  server: McpServer,
  host: SpineHost,
  launcher: BrowserLauncher = createPlaywrightLauncher(),
): void {
  server.registerTool(
    'visual_regression',
    {
      title: 'Compare rendered frames against a baseline',
      description: [
        'Render an animation headlessly and compare it against stored baseline PNGs, writing diff images for any frame that moved.',
        'Baselines are bound to the skeleton hash: when the data itself changed, that is reported as its own outcome rather than as pixel noise,',
        'with a pointer to skeleton_diff for the semantic change.',
        'Two thresholds work together — a per-channel tolerance absorbs software-rasteriser jitter, and a pixel-count budget catches real shifts.',
        'A failing comparison returns GATE_FAILED, which makes this usable as a CI gate. Use mode "update" to create or refresh a baseline.',
      ].join(' '),
      inputSchema: {
        skeleton: z.string().describe('Path to the exported skeleton JSON file.'),
        atlas: z.string().describe('Path to the matching .atlas file.'),
        baselineDir: z
          .string()
          .describe('Directory holding the baseline PNGs and baseline.json, inside the workspace.'),
        diffDir: z
          .string()
          .optional()
          .describe('Directory to write diff images for failing frames, inside the workspace.'),
        mode: z
          .enum(['check', 'update'])
          .optional()
          .describe('"check" compares against the baseline (default). "update" overwrites it.'),
        imageDir: z
          .string()
          .optional()
          .describe('Folder holding the atlas page images. Defaults to the atlas folder.'),
        animation: z
          .string()
          .optional()
          .describe('Animation to render. Defaults to the first one in the skeleton.'),
        skin: z.string().optional().describe('Skin to apply before rendering.'),
        times: z
          .array(z.number().min(0))
          .optional()
          .describe('Exact times in seconds to capture. Keep these stable across runs.'),
        sampleCount: z
          .number()
          .int()
          .min(1)
          .max(240)
          .optional()
          .describe('Number of evenly spaced samples when `times` is omitted.'),
        width: z.number().int().min(16).max(4096).optional().describe('Canvas width. Defaults to 512.'),
        height: z.number().int().min(16).max(4096).optional().describe('Canvas height. Defaults to 512.'),
        scale: z.number().positive().optional().describe('Skeleton scale applied at load time.'),
        premultipliedAlpha: z
          .boolean()
          .optional()
          .describe('Override the atlas pma flag.'),
        channelTolerance: z
          .number()
          .int()
          .min(0)
          .max(255)
          .optional()
          .describe(
            `Maximum per-channel difference treated as equal. Defaults to ${DEFAULT_THRESHOLDS.channelTolerance}.`,
          ),
        maxDifferentFraction: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            `Fraction of pixels allowed to differ before a frame fails. Defaults to ${DEFAULT_THRESHOLDS.maxDifferentFraction}.`,
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guardTool(() =>
        visualRegression(host, launcher, {
          ...args,
          premultipliedAlpha: args.premultipliedAlpha,
        }),
      ),
  );
}
