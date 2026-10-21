// ============================================================
// Group D — `render_preview`.
//
// Loads an exported skeleton plus its atlas, renders chosen moments of an
// animation in headless Chromium, and writes PNGs.
//
// Division of labour worth keeping straight: Spine's own image/video export
// is the authoritative visual output but needs a windowing system and
// OpenGL, which makes it fragile in CI. This renderer is the automation
// path — reproducible, and the input to visual regression.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { AtlasReport, inspectAtlasText } from '../atlas-data';
import { SpineHost } from '../host';
import { resolveReadTarget, resolveWriteTarget } from '../path-safety';
import {
  BrowserLauncher,
  RenderResult,
  createPlaywrightLauncher,
  renderFrames,
} from '../preview-renderer';
import { SkeletonReport, inspectSkeletonJson } from '../skeleton-data';
import { guardTool } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import { readTextFile } from './data-tools';

/** Default number of evenly spaced samples when no times are given. */
export const DEFAULT_SAMPLE_COUNT = 4;

/** Even samples across an animation, including the start and the end. */
export function evenSampleTimes(duration: number, count: number): number[] {
  if (count <= 1 || duration <= 0) return [0];
  const step = duration / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    Number((index * step).toFixed(6)),
  );
}

/** Resolve the atlas page images, which sit next to the atlas file. */
export function loadAtlasImages(
  host: SpineHost,
  atlasPath: string,
  atlas: AtlasReport,
  imageDir?: string,
): SpineResult<Record<string, Buffer>> {
  const baseDir = imageDir ?? dirname(atlasPath);
  const images: Record<string, Buffer> = {};
  const missing: string[] = [];

  for (const page of atlas.pages) {
    const path = join(baseDir, page.name);
    const bytes = host.readBinary(path);
    if (bytes === null) {
      missing.push(path);
      continue;
    }
    images[page.name] = bytes;
  }

  if (missing.length > 0) {
    return err(
      SpineErrorCode.InputMissing,
      `Atlas page image(s) not found: ${missing.join(', ')}`,
      'Page images are looked up next to the .atlas file. Pass `imageDir` when they live elsewhere.',
      { missing, searchedIn: baseDir },
    );
  }

  return ok(images, `Loaded ${Object.keys(images).length} atlas page image(s).`);
}

/** Payload returned by `render_preview`. */
export interface RenderPreviewData {
  skeletonFile: string;
  atlasFile: string;
  animation: string | null;
  times: number[];
  outputDir: string | null;
  /** Written files, in the same order as `times`. */
  files: string[];
  render: Omit<RenderResult, 'frames'> & {
    frames: Array<{ time: number; coverage: number; bytes: number }>;
  };
}

/** File name for one frame; stable so regression baselines line up. */
export function frameFileName(
  animation: string | null,
  time: number,
  index: number,
): string {
  const label = (animation ?? 'setup').replace(/[^a-zA-Z0-9_-]+/g, '-');
  const stamp = time.toFixed(3).replace('.', '_');
  return `${label}-${String(index).padStart(2, '0')}-${stamp}s.png`;
}

/** Arguments shared by `render_preview` and `visual_regression`. */
export interface RenderRequest {
  skeleton: string;
  atlas: string;
  imageDir?: string | undefined;
  animation?: string | undefined;
  skin?: string | undefined;
  times?: number[] | undefined;
  sampleCount?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  scale?: number | undefined;
  premultipliedAlpha?: boolean | undefined;
  background?: [number, number, number, number] | undefined;
}

/** Everything a render produced, before anything is written to disk. */
export interface PreparedRender {
  skeletonFile: string;
  atlasFile: string;
  skeleton: SkeletonReport;
  animation: string | null;
  times: number[];
  premultipliedAlpha: boolean;
  render: RenderResult;
}

/**
 * Resolve inputs, pick the animation and sample times, and render.
 *
 * Shared by the preview and regression tools so both frame the camera and
 * sample time identically — otherwise a baseline rendered by one would not
 * be comparable with frames rendered by the other.
 */
export async function prepareRender(
  host: SpineHost,
  launcher: BrowserLauncher,
  args: RenderRequest,
): Promise<SpineResult<PreparedRender>> {
  const skeletonFile = readTextFile(host, args.skeleton, 'skeleton data');
  if (!skeletonFile.ok) return skeletonFile;

  const skeleton = inspectSkeletonJson(skeletonFile.data.text);
  if (!skeleton.ok) return skeleton;

  const atlasFile = readTextFile(host, args.atlas, 'texture atlas');
  if (!atlasFile.ok) return atlasFile;

  const atlas = inspectAtlasText(atlasFile.data.text);
  if (!atlas.ok) return atlas;

  let imageDir: string | undefined;
  if (args.imageDir) {
    const resolved = resolveReadTarget(args.imageDir, host.workspaceRoot, host.exists);
    if (!resolved.ok) return resolved;
    imageDir = resolved.data;
  }

  const images = loadAtlasImages(host, atlasFile.data.absolute, atlas.data, imageDir);
  if (!images.ok) return images;

  const animationName = pickAnimation(args.animation, skeleton.data);
  if (!animationName.ok) return animationName;

  const times =
    args.times && args.times.length > 0
      ? args.times
      : evenSampleTimes(
          durationOf(skeleton.data, animationName.data),
          args.sampleCount ?? DEFAULT_SAMPLE_COUNT,
        );

  // Default premultiplied alpha to what the atlas actually says, since a
  // mismatch there is the most common cause of dark or haloed edges.
  const premultipliedAlpha =
    args.premultipliedAlpha ?? atlas.data.pages.some((page) => page.pma);

  const rendered = await renderFrames(host, launcher, {
    skeletonJson: skeletonFile.data.text,
    atlasText: atlasFile.data.text,
    images: images.data,
    animation: animationName.data,
    skin: args.skin ?? null,
    times,
    ...(args.width === undefined ? {} : { width: args.width }),
    ...(args.height === undefined ? {} : { height: args.height }),
    ...(args.scale === undefined ? {} : { scale: args.scale }),
    ...(args.background === undefined ? {} : { background: args.background }),
    premultipliedAlpha,
  });
  if (!rendered.ok) return rendered;

  return ok(
    {
      skeletonFile: skeletonFile.data.absolute,
      atlasFile: atlasFile.data.absolute,
      skeleton: skeleton.data,
      animation: animationName.data,
      times,
      premultipliedAlpha,
      render: rendered.data,
    },
    rendered.summary,
  );
}

/** Render frames of an animation and optionally write them to disk. */
export async function renderPreview(
  host: SpineHost,
  launcher: BrowserLauncher,
  args: RenderRequest & { outputDir?: string | undefined },
): Promise<SpineResult<RenderPreviewData>> {
  const prepared = await prepareRender(host, launcher, args);
  if (!prepared.ok) return prepared;

  const { skeletonFile, atlasFile, animation, times, premultipliedAlpha, render } =
    prepared.data;

  const files: string[] = [];
  let outputDir: string | null = null;

  if (args.outputDir) {
    const target = resolveWriteTarget(args.outputDir, host.workspaceRoot);
    if (!target.ok) return target;
    outputDir = target.data;

    for (const [index, frame] of render.frames.entries()) {
      const path = join(outputDir, frameFileName(animation, frame.time, index));
      host.writeBinary(path, frame.png);
      files.push(path);
    }
  }

  const summaryLines = [
    `Rendered ${render.frames.length} frame(s) of ${animation ?? 'the setup pose'} at ${render.width}x${render.height}.`,
    `Times: ${times.map((time) => `${time}s`).join(', ')}.`,
    `Bounds: ${render.bounds.width.toFixed(1)}x${render.bounds.height.toFixed(1)} at (${render.bounds.x.toFixed(1)}, ${render.bounds.y.toFixed(1)}).`,
    `Premultiplied alpha: ${premultipliedAlpha} (taken from the atlas unless overridden).`,
    outputDir === null
      ? 'Not written to disk: pass `outputDir` to save the PNGs.'
      : `Written to ${outputDir}.`,
    ...render.warnings,
  ];

  return ok(
    {
      skeletonFile,
      atlasFile,
      animation,
      times,
      outputDir,
      files,
      render: {
        bounds: render.bounds,
        animations: render.animations,
        skins: render.skins,
        warnings: render.warnings,
        width: render.width,
        height: render.height,
        frames: render.frames.map((frame) => ({
          time: frame.time,
          coverage: frame.coverage,
          bytes: frame.png.length,
        })),
      },
    },
    summaryLines.join('\n'),
  );
}

/** Choose and validate the animation to render. */
function pickAnimation(
  requested: string | undefined,
  report: SkeletonReport,
): SpineResult<string | null> {
  const names = report.animations.map((animation) => animation.name);

  if (requested === undefined) {
    return ok(names[0] ?? null, '');
  }

  if (!names.includes(requested)) {
    return err(
      SpineErrorCode.InvalidArgument,
      `Animation "${requested}" is not in this skeleton.`,
      names.length > 0
        ? `Available animations: ${names.join(', ')}.`
        : 'This skeleton has no animations; omit `animation` to render the setup pose.',
    );
  }

  return ok(requested, '');
}

function durationOf(report: SkeletonReport, animation: string | null): number {
  if (animation === null) return 0;
  return (
    report.animations.find((entry) => entry.name === animation)?.duration ?? 0
  );
}

/** Register the preview tool. */
export function registerPreviewTools(
  server: McpServer,
  host: SpineHost,
  launcher: BrowserLauncher = createPlaywrightLauncher(),
): void {
  server.registerTool(
    'render_preview',
    {
      title: 'Render animation frames headlessly',
      description: [
        'Render chosen moments of an animation with the spine-ts WebGL runtime in headless Chromium, and write them as PNGs.',
        'Animation time is advanced in fixed steps so physics constraints land where a real runtime would, and the camera is framed once',
        'from the union of all sampled poses so frames in a run share one coordinate system — both of which make the output usable as a regression baseline.',
        'Premultiplied alpha defaults to whatever the atlas declares. Reports per-frame pixel coverage, which catches the "renders nothing" case.',
        'Needs the optional playwright-core and spine-webgl dependencies; everything else in this Power works without them.',
      ].join(' '),
      inputSchema: {
        skeleton: z.string().describe('Path to the exported skeleton JSON file.'),
        atlas: z.string().describe('Path to the matching .atlas file.'),
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
          .describe('Exact times in seconds to capture, e.g. [0, 0.25, 0.5, 0.75].'),
        sampleCount: z
          .number()
          .int()
          .min(1)
          .max(240)
          .optional()
          .describe(
            `Number of evenly spaced samples across the animation when \`times\` is omitted. Defaults to ${DEFAULT_SAMPLE_COUNT}.`,
          ),
        outputDir: z
          .string()
          .optional()
          .describe('Folder to write the PNGs to, inside the workspace. Omit to render without saving.'),
        width: z.number().int().min(16).max(4096).optional().describe('Canvas width in pixels. Defaults to 512.'),
        height: z
          .number()
          .int()
          .min(16)
          .max(4096)
          .optional()
          .describe('Canvas height in pixels. Defaults to 512.'),
        scale: z
          .number()
          .positive()
          .optional()
          .describe('Skeleton scale applied at load time. Defaults to 1.'),
        premultipliedAlpha: z
          .boolean()
          .optional()
          .describe('Override the atlas pma flag. Only do this when the runtime deliberately disagrees with the atlas.'),
        background: z
          .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
          .optional()
          .describe('Background colour as [r, g, b, a], each 0..1. Defaults to transparent.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guardTool(() =>
        renderPreview(host, launcher, {
          ...args,
          background: args.background as
            | [number, number, number, number]
            | undefined,
        }),
      ),
  );
}
