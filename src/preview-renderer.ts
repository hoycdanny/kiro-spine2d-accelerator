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
  buildPreviewHtml,
} from './preview-page';
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
        // Deliberately no --use-gl override: headless Chromium already
        // renders WebGL through its software path, which is what keeps
        // screenshots comparable across machines. Forcing
        // `--use-gl=swiftshader` instead makes the spine-ts two-colour
        // tint shader fail to compile — verified on Chromium 151.
        args: ['--hide-scrollbars', '--mute-audio'],
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
