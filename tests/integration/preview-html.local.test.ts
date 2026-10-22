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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  document: {
    getElementById(id: string): unknown;
    querySelector(selector: string): unknown;
  };
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
  __spineViewerReady?: boolean;
  __spineViewerError?: string;
}
type PageCanvas = { toDataURL(type: string): string };
type PageSelect = { options: ArrayLike<{ value: string }> };
type PageRange = { value: string; max: string; dispatchEvent(event: unknown): boolean };
type PageControl = {
  id: string;
  disabled: boolean;
  textContent: string | null;
  className: string;
  getAttribute(name: string): string | null;
};
type PageStrip = {
  textContent: string | null;
  querySelectorAll(selector: string): ArrayLike<unknown>;
};

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

  it('shows the error and shuts the controls down when the viewer throws', async () => {
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

    expect(exported.ok ? 'ok' : exported.message).toBe('ok');
    if (!exported.ok) return;

    // Break the texture upload, which is the real unguarded statement:
    // `page.setTexture(...)` runs after the atlas page loop's try/catch
    // ends, so it rejects the viewer's promise instead of reaching a
    // fail() site. The stub goes in its own script element between the
    // viewer and the bootstrap, leaving both of them exactly as shipped.
    // It patches the prototype rather than `spine.GLTexture`, because the
    // bundle's exports are getter-only and assigning to one is a silent
    // no-op.
    const html = readFileSync(exported.data.outputFile, 'utf8');
    const broken = html.replace(
      '</script>\n<script>\nwindow.__spineInteractiveViewer(',
      '</script>\n<script>spine.TextureAtlasPage.prototype.setTexture = function () { throw new Error("texture upload refused"); };</script>\n<script>\nwindow.__spineInteractiveViewer(',
    );
    expect(broken).not.toBe(html);

    const brokenFile = join(workspace, 'standalone', 'hero-broken.html');
    writeFileSync(brokenFile, broken, 'utf8');

    const browser = await createPlaywrightLauncher()();
    const pageErrors: string[] = [];

    try {
      const page = (await browser.newPage()) as unknown as RichPage;
      page.on('pageerror', (payload) => pageErrors.push(String(payload)));

      await page.goto(pathToFileURL(brokenFile).href, { waitUntil: 'load' });
      await page.waitForFunction(
        () =>
          typeof (globalThis as unknown as PageGlobals).__spineViewerError === 'string',
        undefined,
        { timeout: 60_000 },
      );

      const state = await page.evaluate(() => {
        const globals = globalThis as unknown as PageGlobals;
        const strip = globals.document.querySelector('.controls') as PageStrip;
        const nodes = strip.querySelectorAll('button, select, input');
        const controls: Array<{
          id: string;
          disabled: boolean;
          pressed: string | null;
          text: string;
        }> = [];
        for (let index = 0; index < nodes.length; index++) {
          const control = nodes[index] as PageControl;
          controls.push({
            id: control.id,
            disabled: control.disabled,
            pressed: control.getAttribute('aria-pressed'),
            text: control.textContent ?? '',
          });
        }
        const status = globals.document.getElementById('viewer-status') as PageControl;
        return {
          error: globals.__spineViewerError ?? null,
          ready: globals.__spineViewerReady === true,
          status: status.textContent ?? '',
          statusClass: status.className,
          stripText: strip.textContent ?? '',
          controls,
        };
      });

      // The rejection is reported, not swallowed, and not left unhandled.
      expect(state.ready).toBe(false);
      expect(state.error).toContain('The viewer failed to start');
      expect(state.error).toContain('texture upload refused');
      expect(state.status).toBe(state.error);
      expect(state.statusClass).toContain('failed');
      expect(pageErrors).toEqual([]);

      // And the strip is honest about it: nothing clickable, nothing
      // claiming to be playing.
      expect(state.controls.map((control) => control.id).sort()).toEqual([
        'animation-select',
        'bones-toggle',
        'loop-toggle',
        'play-toggle',
        'speed-select',
        'timeline',
      ]);
      expect(state.controls.filter((control) => !control.disabled)).toEqual([]);
      expect(state.controls.filter((control) => control.pressed === 'true')).toEqual([]);
      expect(state.stripText).not.toContain('Pause');
      expect(state.stripText).toContain('Play');
    } finally {
      await browser.close();
    }
  }, 180_000);
});
