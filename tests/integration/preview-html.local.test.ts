/**
 * The standalone interactive export, opened for real.
 *
 * Writing the file needs no browser, but "it renders when a client opens
 * it" is the whole claim, so this test loads the written file over file://
 * in real Chromium, looks at the canvas pixels, and scrubs the timeline.
 *
 * Skips itself when Chromium is unavailable, like the other local
 * integration tests.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNodeHost } from '../../src/host';
import { createPlaywrightLauncher } from '../../src/preview-renderer';
import { exportInteractivePreview } from '../../src/tools/preview-tools';
import { RENDERABLE_ATLAS, RENDERABLE_SKELETON, toJsonText } from '../helpers/fixtures';
import { RgbaImage, decodePng, encodePng, pixelDifference, solidImage } from '../helpers/png';

/**
 * In-page shims. This package compiles with `lib: ES2022` and no DOM, so
 * browser-side code is typed here. These are types only, which is what
 * lets them survive a function being serialized into the page.
 */
interface PageGlobals {
  document: { getElementById(id: string): unknown };
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
  __spineViewerReady?: boolean;
  __spineViewerError?: string;
}
type PageCanvas = { toDataURL(type: string): string };
type PageSelect = { options: ArrayLike<{ value: string }> };
type PageRange = { value: string; max: string; dispatchEvent(event: unknown): boolean };

/** The Playwright page members this test uses, beyond the renderer's subset. */
interface RichPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  waitForFunction(
    fn: () => unknown,
    arg?: unknown,
    options?: { timeout?: number },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  on(event: string, handler: (payload: unknown) => void): void;
}

async function chromiumAvailable(): Promise<boolean> {
  try {
    const browser = await createPlaywrightLauncher()();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

let available = false;
let workspace = '';

beforeAll(async () => {
  available = await chromiumAvailable();
  if (!available) return;

  workspace = mkdtempSync(join(tmpdir(), 'spine-preview-html-'));
  writeFileSync(join(workspace, 'hero.json'), toJsonText(RENDERABLE_SKELETON), 'utf8');
  writeFileSync(join(workspace, 'hero.atlas'), RENDERABLE_ATLAS, 'utf8');
  // A two-tone page: a solid image would make a rotation invisible.
  const image = solidImage(64, 64, [255, 0, 0, 255]);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const index = (y * 64 + x) * 4;
      image.data[index] = 0;
      image.data[index + 2] = 255;
    }
  }
  writeFileSync(join(workspace, 'fixture.png'), encodePng(image));
}, 120_000);

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe('standalone interactive preview', () => {
  it('renders, lists its animations and responds to a timeline scrub', async () => {
    if (!available) {
      // Chromium is not installed on this machine; nothing to verify.
      return;
    }

    const host = createNodeHost({ workspaceRoot: workspace });
    const exported = exportInteractivePreview(host, {
      skeleton: join(workspace, 'hero.json'),
      atlas: join(workspace, 'hero.atlas'),
      output: 'standalone/hero.html',
      animation: 'spin',
      width: 160,
      height: 160,
    });

    // Surface the failure message rather than a bare false.
    expect(exported.ok ? 'ok' : exported.message).toBe('ok');
    if (!exported.ok) return;

    const browser = await createPlaywrightLauncher()();
    const pageErrors: string[] = [];

    try {
      const page = (await browser.newPage()) as unknown as RichPage;
      page.on('pageerror', (payload) => pageErrors.push(String(payload)));

      await page.goto(pathToFileURL(exported.data.outputFile).href, { waitUntil: 'load' });
      await page.waitForFunction(
        () => (globalThis as unknown as PageGlobals).__spineViewerReady === true,
        undefined,
        { timeout: 60_000 },
      );

      expect(pageErrors).toEqual([]);
      expect(
        await page.evaluate(
          () => (globalThis as unknown as PageGlobals).__spineViewerError ?? null,
        ),
      ).toBeNull();

      // The selector is populated from the embedded skeleton data.
      const animations = await page.evaluate(() => {
        const select = (globalThis as unknown as PageGlobals).document.getElementById(
          'animation-select',
        ) as PageSelect;
        const values: string[] = [];
        for (let index = 0; index < select.options.length; index++) {
          values.push(select.options[index]!.value);
        }
        return values;
      });
      expect(animations).toEqual(['spin']);

      /** Read the canvas back out of the page as a decoded PNG. */
      const capture = async (): Promise<RgbaImage> => {
        await page.waitForTimeout(150);
        const base64 = await page.evaluate(() => {
          const canvas = (globalThis as unknown as PageGlobals).document.getElementById(
            'spine-canvas',
          ) as PageCanvas;
          return canvas.toDataURL('image/png').split(',')[1]!;
        });
        return decodePng(Buffer.from(base64, 'base64'));
      };

      // Hold the animation at its start. Scrubbing pauses, so the pose is
      // stable for the comparison below.
      await page.evaluate(() => {
        const globals = globalThis as unknown as PageGlobals;
        const range = globals.document.getElementById('timeline') as PageRange;
        range.value = '0';
        range.dispatchEvent(new globals.Event('input', { bubbles: true }));
      });
      const atStart = await capture();

      expect(atStart.width).toBe(160);
      expect(atStart.height).toBe(160);

      // Non-blank is the acceptance criterion, not "the page loaded".
      let covered = 0;
      for (let index = 3; index < atStart.data.length; index += 4) {
        if (atStart.data[index] !== 0) covered++;
      }
      expect(covered / (atStart.width * atStart.height)).toBeGreaterThan(0.01);

      // Scrub to the middle of the loop: a different pose, different pixels.
      await page.evaluate(() => {
        const globals = globalThis as unknown as PageGlobals;
        const range = globals.document.getElementById('timeline') as PageRange;
        range.value = String(Number(range.max) / 2);
        range.dispatchEvent(new globals.Event('input', { bubbles: true }));
      });
      const midway = await capture();

      expect(pixelDifference(atStart, midway)).toBeGreaterThan(0.01);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);
});
