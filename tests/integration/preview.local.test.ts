/**
 * Real headless render: Chromium + the spine-ts WebGL runtime.
 *
 * Skips itself when Chromium is unavailable, so the suite still passes on a
 * machine without the Playwright browsers installed.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeHost } from '../../src/host';
import { createPlaywrightLauncher } from '../../src/preview-renderer';
import { renderPreview } from '../../src/tools/preview-tools';
import { visualRegression } from '../../src/tools/regression-tools';
import { SpineErrorCode } from '../../src/types';
import {
  RENDERABLE_ATLAS,
  RENDERABLE_SKELETON,
  toJsonText,
} from '../helpers/fixtures';
import { decodePng, encodePng, pixelDifference, solidImage } from '../helpers/png';

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

  workspace = mkdtempSync(join(tmpdir(), 'spine-preview-'));
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

const describeIfChromium = () => (available ? describe : describe.skip);

describe('headless preview', () => {
  it('renders non-blank frames and writes them to disk', async () => {
    if (!available) {
      // Chromium is not installed on this machine; nothing to verify.
      return;
    }

    const host = createNodeHost({ workspaceRoot: workspace });
    const result = await renderPreview(host, createPlaywrightLauncher(), {
      skeleton: join(workspace, 'hero.json'),
      atlas: join(workspace, 'hero.atlas'),
      animation: 'spin',
      times: [0, 0.25, 0.5, 0.75],
      outputDir: 'frames',
      width: 128,
      height: 128,
    });

    // Surface the failure message rather than a bare false.
    expect(result.ok ? 'ok' : result.message).toBe('ok');
    if (!result.ok) return;

    expect(result.data.files).toHaveLength(4);
    expect(result.data.render.animations).toEqual(['spin']);
    expect(result.data.render.skins).toEqual(['default']);

    // Every frame must actually contain the skeleton.
    for (const frame of result.data.render.frames) {
      expect(frame.coverage).toBeGreaterThan(0.01);
      expect(frame.bytes).toBeGreaterThan(100);
    }

    // The frames are real PNGs of the requested size.
    const first = decodePng(readFileSync(result.data.files[0]!));
    expect(first.width).toBe(128);
    expect(first.height).toBe(128);

    // A rotating bone must look different at different times.
    const last = decodePng(readFileSync(result.data.files[3]!));
    expect(pixelDifference(first, last)).toBeGreaterThan(0.01);
  }, 180_000);

  it('is deterministic: the same inputs render identical bytes', async () => {
    if (!available) return;

    const host = createNodeHost({ workspaceRoot: workspace });
    const run = () =>
      renderPreview(host, createPlaywrightLauncher(), {
        skeleton: join(workspace, 'hero.json'),
        atlas: join(workspace, 'hero.atlas'),
        animation: 'spin',
        times: [0.4],
        width: 96,
        height: 96,
      });

    const first = await run();
    const second = await run();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.data.render.frames[0]!.bytes).toBe(
      second.data.render.frames[0]!.bytes,
    );
    expect(first.data.render.frames[0]!.coverage).toBeCloseTo(
      second.data.render.frames[0]!.coverage,
      6,
    );
  }, 240_000);

  it('fails clearly when the atlas region does not match the attachment', async () => {
    if (!available) return;

    const brokenAtlas = RENDERABLE_ATLAS.replace('body', 'not-body');
    writeFileSync(join(workspace, 'broken.atlas'), brokenAtlas, 'utf8');

    const host = createNodeHost({ workspaceRoot: workspace });
    const result = await renderPreview(host, createPlaywrightLauncher(), {
      skeleton: join(workspace, 'hero.json'),
      atlas: join(workspace, 'broken.atlas'),
      times: [0],
    });

    // The runtime throws while resolving the attachment region.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message.toLowerCase()).toMatch(/region|attachment/);
  }, 180_000);
});

// Referenced so the helper is not flagged as unused when Chromium is absent.
void describeIfChromium;

describe('visual regression against real renders', () => {
  it('creates a baseline, passes a re-render, and catches an atlas change', async () => {
    if (!available) return;

    const host = createNodeHost({ workspaceRoot: workspace });
    const common = {
      skeleton: join(workspace, 'hero.json'),
      atlas: join(workspace, 'hero.atlas'),
      baselineDir: 'baseline',
      animation: 'spin',
      times: [0, 0.5],
      width: 96,
      height: 96,
    };

    // 1. Create the baseline.
    const created = await visualRegression(host, createPlaywrightLauncher(), {
      ...common,
      mode: 'update',
    });
    expect(created.ok ? 'ok' : created.message).toBe('ok');
    if (!created.ok) return;
    expect(created.data.baselineFiles).toHaveLength(2);

    // 2. The same inputs must pass.
    const unchanged = await visualRegression(host, createPlaywrightLauncher(), common);
    expect(unchanged.ok ? 'ok' : unchanged.message).toBe('ok');
    if (!unchanged.ok) return;
    expect(unchanged.data.report.passed).toBe(true);

    // 3. Re-pack the atlas with different padding: the region now sits two
    // pixels in, which is exactly the kind of change a repack introduces.
    const repacked = RENDERABLE_ATLAS.replace(
      'bounds: 0, 0, 64, 64',
      'bounds: 2, 2, 60, 60',
    );
    writeFileSync(join(workspace, 'hero.atlas'), repacked, 'utf8');

    const regressed = await visualRegression(host, createPlaywrightLauncher(), {
      ...common,
      diffDir: 'diff',
    });

    expect(regressed.ok).toBe(false);
    if (regressed.ok) return;
    expect(regressed.code).toBe(SpineErrorCode.GateFailed);
    expect(regressed.hint).toContain('FAIL');

    // A diff image was written and is a decodable PNG of the right size.
    // The failure payload carries paths and numbers only — never the pixels.
    const diffFiles = regressed.details?.['diffFiles'] as string[];
    expect(diffFiles.length).toBeGreaterThan(0);
    const diffImage = decodePng(readFileSync(diffFiles[0]!));
    expect(diffImage.width).toBe(96);
    expect(diffImage.height).toBe(96);

    const failedFrames = regressed.details?.['failedFrames'] as Array<
      Record<string, unknown>
    >;
    expect(failedFrames.length).toBeGreaterThan(0);
    expect(failedFrames[0]).toHaveProperty('differentPixels');
    expect(JSON.stringify(regressed.details)).not.toContain('"type":"Buffer"');

    // Restore the fixture for any later test.
    writeFileSync(join(workspace, 'hero.atlas'), RENDERABLE_ATLAS, 'utf8');
  }, 300_000);
});
