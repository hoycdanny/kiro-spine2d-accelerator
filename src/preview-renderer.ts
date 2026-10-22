// ============================================================
// Node side of the headless preview: locate the runtime, drive Chromium,
// collect PNGs.
//
// Playwright and the spine-ts runtime are optional dependencies. Both are
// resolved lazily and a missing one produces DEPENDENCY_MISSING with the
// command to fix it, rather than a stack trace.
//
// Role split, which the steering files repeat: the Spine CLI's own image
// export is the authoritative output (and needs a windowing system plus
// OpenGL); this renderer exists to verify data automatically in CI.
// ============================================================

import { join } from 'node:path';

import { SpineHost } from './host';
import {
  PreviewPageInput,
  PreviewPageResult,
  ProbePageFrame,
  ProbePageInitResult,
  ProbePageInput,
  buildPreviewHtml,
  buildProbeHtml,
} from './preview-page';
import { ProbeAxis, SlotBox } from './skeleton-probe';
import { SpineErrorCode, SpineResult, err, ok } from './types';

/** Relative location of the spine-ts WebGL runtime inside the package. */
export const RUNTIME_RELATIVE_PATH = join(
  'node_modules',
  '@esotericsoftware',
  'spine-webgl',
  'dist',
  'iife',
  'spine-webgl.min.js',
);

/** Load the spine-ts runtime source that gets inlined into the page. */
export function loadRuntimeSource(host: SpineHost): SpineResult<string> {
  const path = join(host.packageRoot, RUNTIME_RELATIVE_PATH);
  const source = host.readText(path);
  if (source === null) {
    return err(
      SpineErrorCode.DependencyMissing,
      `The spine-ts WebGL runtime was not found at ${path}.`,
      'Install the optional dependencies: npm install @esotericsoftware/spine-webgl@4.2.120. The runtime major.minor must match the editor that exported the data.',
    );
  }
  return ok(source, 'Runtime loaded.');
}

/** Minimal shape of the Playwright API this module uses. */
interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
  /**
   * The function is serialized and run in the page, so its body may only
   * use page globals and the single argument.
   */
  evaluate<T, A>(fn: (arg: A) => Promise<T> | T, arg: A): Promise<T>;
  on(event: 'console' | 'pageerror', handler: (payload: unknown) => void): void;
}

interface ChromiumLike {
  launch(options: { headless: boolean; args?: string[] }): Promise<BrowserLike>;
}

/** How a browser is obtained. Injected so tests can run without Chromium. */
export type BrowserLauncher = () => Promise<BrowserLike>;

/**
 * The only Chromium arguments this package launches with.
 *
 * Deliberately no `--use-gl` override: headless Chromium already renders
 * WebGL through its software path, which is what keeps screenshots
 * comparable across machines. Forcing `--use-gl=swiftshader` instead makes
 * the spine-ts two-colour tint shader fail to compile — verified on
 * Chromium 151.
 *
 * Exported because `skeleton_document` records the launch arguments in
 * every document it writes as the environment the influence measurement
 * was made in. That claim is only true while there is one copy of this
 * array, so read it from here rather than restating it.
 */
export const CHROMIUM_LAUNCH_ARGS: readonly string[] = ['--hide-scrollbars', '--mute-audio'];

/** Launch Chromium through playwright-core, with actionable failures. */
export function createPlaywrightLauncher(): BrowserLauncher {
  return async () => {
    let chromium: ChromiumLike;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const playwright = require('playwright-core') as { chromium: ChromiumLike };
      chromium = playwright.chromium;
    } catch {
      throw new Error(
        'DEPENDENCY_MISSING: playwright-core is not installed. Run: npm install playwright-core@1.62.0',
      );
    }

    try {
      return await chromium.launch({
        headless: true,
        // See CHROMIUM_LAUNCH_ARGS for why there is no --use-gl override.
        args: [...CHROMIUM_LAUNCH_ARGS],
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `DEPENDENCY_MISSING: Chromium failed to launch (${message}). Install the browser with: npx playwright install chromium`,
      );
    }
  };
}

/** Options for a render run. */
export interface RenderOptions {
  skeletonJson: string;
  atlasText: string;
  /** Atlas page image name to PNG bytes. */
  images: Record<string, Buffer>;
  animation?: string | null;
  skin?: string | null;
  times: number[];
  width?: number;
  height?: number;
  background?: [number, number, number, number];
  premultipliedAlpha?: boolean;
  scale?: number;
  stepSeconds?: number;
  padding?: number;
}

/** One rendered frame, as PNG bytes. */
export interface RenderedFrame {
  time: number;
  png: Buffer;
  /** Fraction of non-transparent pixels. */
  coverage: number;
}

/** Result of a render run. */
export interface RenderResult {
  frames: RenderedFrame[];
  bounds: { x: number; y: number; width: number; height: number };
  animations: string[];
  skins: string[];
  warnings: string[];
  width: number;
  height: number;
}

/** Exported because the interactive HTML export inlines pages the same way. */
export function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

function fromDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

/** Render frames in a headless browser. */
export async function renderFrames(
  host: SpineHost,
  launcher: BrowserLauncher,
  options: RenderOptions,
): Promise<SpineResult<RenderResult>> {
  if (options.times.length === 0) {
    return err(
      SpineErrorCode.InvalidArgument,
      'No sample times were given.',
      'Pass at least one time in seconds, e.g. [0, 0.25, 0.5].',
    );
  }

  const runtime = loadRuntimeSource(host);
  if (!runtime.ok) return runtime;

  const width = options.width ?? 512;
  const height = options.height ?? 512;

  const input: PreviewPageInput = {
    skeletonJson: options.skeletonJson,
    atlasText: options.atlasText,
    images: Object.fromEntries(
      Object.entries(options.images).map(([name, png]) => [name, toDataUrl(png)]),
    ),
    animation: options.animation ?? null,
    skin: options.skin ?? null,
    times: options.times,
    width,
    height,
    background: options.background ?? [0, 0, 0, 0],
    premultipliedAlpha: options.premultipliedAlpha ?? true,
    scale: options.scale ?? 1,
    stepSeconds: options.stepSeconds ?? 1 / 60,
    padding: options.padding ?? 0.1,
  };

  let browser: BrowserLike | null = null;
  const consoleErrors: string[] = [];

  try {
    browser = await launcher();
    const page = await browser.newPage();

    page.on('pageerror', (payload) => {
      consoleErrors.push(String(payload));
    });

    await page.setContent(buildPreviewHtml(runtime.data), { waitUntil: 'load' });

    const result = await page.evaluate<PreviewPageResult, PreviewPageInput>(
      // `globalThis` is `window` in the page; using it keeps this file
      // compiling without the DOM lib.
      (pageInput) =>
        (
          globalThis as unknown as {
            __spinePreviewRender: (
              value: PreviewPageInput,
            ) => Promise<PreviewPageResult>;
          }
        ).__spinePreviewRender(pageInput),
      input,
    );

    const frames: RenderedFrame[] = result.frames.map((frame) => ({
      time: frame.time,
      png: fromDataUrl(frame.dataUrl),
      coverage: frame.coverage,
    }));

    const warnings = [...result.warnings];
    if (frames.every((frame) => frame.coverage === 0)) {
      warnings.push(
        'Every frame is empty. The usual cause is an atlas whose regions do not match the attachment names — run skeleton_inspect with the atlas to confirm.',
      );
    }

    return ok(
      {
        frames,
        bounds: result.bounds,
        animations: result.animations,
        skins: result.skins,
        warnings,
        width,
        height,
      },
      `Rendered ${frames.length} frame(s) at ${width}x${height}.`,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    if (message.startsWith('DEPENDENCY_MISSING:')) {
      return err(
        SpineErrorCode.DependencyMissing,
        message.replace('DEPENDENCY_MISSING: ', ''),
        'Headless preview needs playwright-core plus a Chromium build. Everything else in this Power works without them.',
      );
    }

    return err(
      SpineErrorCode.CliFailed,
      `Headless render failed: ${message}`,
      'Check that the atlas page image names match the files on disk and that the skeleton data is a 4.2-compatible export. The runtime major.minor must match the exporting editor.',
      consoleErrors.length > 0 ? { pageErrors: consoleErrors } : undefined,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // A browser that already exited is not an error worth surfacing.
      }
    }
  }
}

// ============================================================
// Influence probes.
//
// Structurally the same control flow as `renderFrames` above — one
// launcher, one page, one `setContent`, one `pageerror` handler,
// `browser.close()` in a `finally` — so the two share a rasteriser and the
// documents this produces are comparable with the visual-regression
// baselines. Same launcher means the same Chromium args and, in
// particular, still no `--use-gl` override.
//
// The one structural difference is batching: the plan's frames are pulled
// out of the page a batch at a time, so the decoded bytes in flight are
// bounded by a constant rather than by the probe count.
// ============================================================

/** Options for a probe run. */
export interface ProbeOptions {
  skeletonJson: string;
  atlasText: string;
  /** Atlas page image name to PNG bytes. */
  images: Record<string, Buffer>;
  skin?: string | null;
  /** The plan, flattened in bone-major order. */
  probes: Array<{ bone: string; axis: ProbeAxis }>;
  rotationDegrees: number;
  translateFraction: number;
  width: number;
  height: number;
  /**
   * Taken from the atlas's `pma` flag by the caller, which is the rule
   * `prepareRender` already applies. Not caller-visible: a probe is a
   * before/after comparison on one canvas with one set of textures, so it
   * cannot change which pixels differ.
   */
  premultipliedAlpha: boolean;
  /** Fixed at 1 by the caller; same reasoning as `premultipliedAlpha`. */
  scale: number;
  /**
   * Called once per rendered probe frame, in plan order, inside the batch
   * loop. The frame's Buffer is released as soon as this returns, so the
   * callback extracts what it needs and keeps nothing. Throwing from here
   * aborts the run and is wrapped by `guardTool` as `CLI_FAILED`.
   */
  onProbeFrame: (
    frame: ProbeFrame,
    neutral: { png: Buffer; slotBoxes: SlotBox[] },
  ) => void;
}

/** One rendered probe frame. Its Buffer lives only until the reducer returns. */
export interface ProbeFrame {
  bone: string;
  axis: ProbeAxis;
  png: Buffer;
  slotBoxes: SlotBox[];
}

/** What a probe run produced, with no probe PNGs in it. */
export interface ProbeRenderResult {
  neutral: { png: Buffer; slotBoxes: SlotBox[]; coverage: number };
  /** What `translateFraction` resolved to, rounded to 3dp in the page. */
  translateUnits: number;
  canvas: { width: number; height: number };
  /** The camera rectangle every fraction in this result is relative to. */
  framing: {
    x: number;
    y: number;
    width: number;
    height: number;
    padding: number;
    fromPoses: number;
  };
  /** Skipped attachment kinds and other probe caveats. */
  warnings: string[];
  /** Slot names in draw order, as the page saw them. */
  slots: string[];
  /** How many `__spineProbeRender` calls were made. Asserted, not inferred. */
  batches: number;
}

/**
 * Decoded RGBA bytes allowed in flight at once.
 *
 * Not a render-count bound — that is `maxProbes`. This bounds the separate
 * axis `maxProbes` does not catch: 512 probes at 1024x1024 is half a
 * gigabyte of base64 PNG if every frame comes back in one `evaluate`.
 */
export const PROBE_BATCH_PIXEL_BUDGET = 64 * 1024 * 1024;

/** Padding the probe camera frames its union of poses with. */
export const PROBE_PADDING = 0.15;

/** Perturb one bone at a time and read back which pixels moved. */
export async function renderProbes(
  host: SpineHost,
  launcher: BrowserLauncher,
  options: ProbeOptions,
): Promise<SpineResult<ProbeRenderResult>> {
  const runtime = loadRuntimeSource(host);
  if (!runtime.ok) return runtime;

  const input: ProbePageInput = {
    skeletonJson: options.skeletonJson,
    atlasText: options.atlasText,
    images: Object.fromEntries(
      Object.entries(options.images).map(([name, png]) => [name, toDataUrl(png)]),
    ),
    skin: options.skin ?? null,
    probes: options.probes,
    rotationDegrees: options.rotationDegrees,
    translateFraction: options.translateFraction,
    width: options.width,
    height: options.height,
    premultipliedAlpha: options.premultipliedAlpha,
    scale: options.scale,
    padding: PROBE_PADDING,
  };

  const perFrame = options.width * options.height * 4;
  const batchSize = Math.max(1, Math.floor(PROBE_BATCH_PIXEL_BUDGET / perFrame));
  const totalBatches = Math.ceil(options.probes.length / batchSize);

  let browser: BrowserLike | null = null;
  const pageErrors: string[] = [];
  let batchLabel = '';
  /** Set when the caller's reducer threw, so the throw is not re-labelled. */
  let reducerFailure: unknown = null;

  try {
    browser = await launcher();
    const page = await browser.newPage();

    page.on('pageerror', (payload) => {
      pageErrors.push(String(payload));
    });

    await page.setContent(buildProbeHtml(runtime.data), { waitUntil: 'load' });

    const init = await page.evaluate<ProbePageInitResult, ProbePageInput>(
      (pageInput) =>
        (
          globalThis as unknown as {
            __spineProbeInit: (value: ProbePageInput) => Promise<ProbePageInitResult>;
          }
        ).__spineProbeInit(pageInput),
      input,
    );

    const neutral = {
      png: fromDataUrl(init.neutral.dataUrl),
      slotBoxes: init.neutral.slotBoxes,
      coverage: init.neutral.coverage,
    };

    let batches = 0;
    for (let fromIndex = 0; fromIndex < options.probes.length; fromIndex += batchSize) {
      const count = Math.min(batchSize, options.probes.length - fromIndex);
      batchLabel =
        ` during probe batch ${batches + 1} of ${totalBatches} ` +
        `(probes ${fromIndex}-${fromIndex + count - 1} of ${options.probes.length})`;

      // `PageLike.evaluate` takes exactly ONE argument, so the two in-page
      // parameters travel as one object and are spread inside the page.
      const frames = await page.evaluate<
        ProbePageFrame[],
        { fromIndex: number; count: number }
      >(
        (arg) =>
          (
            globalThis as unknown as {
              __spineProbeRender: (
                from: number,
                howMany: number,
              ) => Promise<ProbePageFrame[]>;
            }
          ).__spineProbeRender(arg.fromIndex, arg.count),
        { fromIndex, count },
      );
      batches += 1;

      for (const frame of frames) {
        // Reduced here, while the Buffer is alive, and dropped before the
        // next evaluate: only one batch is ever resident.
        try {
          options.onProbeFrame(
            {
              bone: frame.bone,
              axis: frame.axis,
              png: fromDataUrl(frame.dataUrl),
              slotBoxes: frame.slotBoxes,
            },
            { png: neutral.png, slotBoxes: neutral.slotBoxes },
          );
        } catch (cause) {
          reducerFailure = cause;
          throw cause;
        }
      }
    }

    return ok(
      {
        neutral,
        translateUnits: init.translateUnits,
        canvas: init.canvas,
        framing: init.framing,
        warnings: init.warnings,
        slots: init.slots,
        batches,
      },
      `Probed ${options.probes.length} bone-axis combination(s) at ${init.canvas.width}x${init.canvas.height} in ${batches} batch(es).`,
    );
  } catch (cause) {
    // The reducer's own failures belong to the caller, not to the
    // renderer: they are re-thrown so `guardTool` reports them.
    if (reducerFailure !== null) throw reducerFailure;

    const message = cause instanceof Error ? cause.message : String(cause);

    if (message.startsWith('DEPENDENCY_MISSING:')) {
      return err(
        SpineErrorCode.DependencyMissing,
        message.replace('DEPENDENCY_MISSING: ', ''),
        'Headless influence probing needs playwright-core plus a Chromium build. Everything else in this Power works without them.',
      );
    }

    // A failure part way through the plan names the batch and the probe
    // range and abandons the whole run: a document whose influence section
    // silently covers a prefix of the plan is worse than none.
    return err(
      SpineErrorCode.CliFailed,
      `Headless render failed${batchLabel}: ${message}`,
      'Check that the atlas page image names match the files on disk and that the skeleton data is a 4.2-compatible export. The runtime major.minor must match the exporting editor.',
      pageErrors.length > 0 ? { pageErrors } : undefined,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // A browser that already exited is not an error worth surfacing.
      }
    }
  }
}
