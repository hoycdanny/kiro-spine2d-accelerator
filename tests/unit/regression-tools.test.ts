import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RUNTIME_RELATIVE_PATH, type BrowserLauncher } from '../../src/preview-renderer';
import { encodePng, solidImage, type RgbaImage } from '../../src/png';
import { MANIFEST_FILE, readManifest, visualRegression } from '../../src/tools/regression-tools';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';
import { RENDERABLE_ATLAS, RENDERABLE_SKELETON, toJsonText } from '../helpers/fixtures';

const SKELETON = 'C:\\work\\project\\export\\hero.json';
const ATLAS = 'C:\\work\\project\\export\\hero.atlas';
const PAGE = 'C:\\work\\project\\export\\fixture.png';
const BASELINE_DIR = 'C:\\work\\project\\baseline';

const REPO_ROOT = join(__dirname, '..', '..');
const RUNTIME_PATH = join(REPO_ROOT, RUNTIME_RELATIVE_PATH);
const RUNTIME_SOURCE = readFileSync(RUNTIME_PATH, 'utf8');

const GREEN = solidImage(16, 16, [0, 200, 0, 255]);
const GREEN_PNG = encodePng(GREEN);

/** A launcher that renders a fixed image, so comparisons are predictable. */
function stubLauncher(image: RgbaImage = GREEN): BrowserLauncher {
  const png = encodePng(image);
  return async () => ({
    newPage: async () => ({
      setContent: async () => {},
      on: () => {},
      evaluate: async (_fn: unknown, input: unknown) => {
        const times = (input as { times: number[] }).times;
        return {
          frames: times.map((time) => ({
            time,
            dataUrl: `data:image/png;base64,${png.toString('base64')}`,
            coverage: 0.4,
          })),
          bounds: { x: 0, y: 0, width: 64, height: 64 },
          animations: ['spin'],
          skins: ['default'],
          warnings: [],
          spineVersion: '4.2.37',
        } as never;
      },
    }),
    close: async () => {},
  });
}

function regressionHost(extraFiles: Record<string, string> = {}, extraBinaries: Record<string, Buffer> = {}) {
  return createFakeHost({
    files: {
      [SKELETON]: toJsonText(RENDERABLE_SKELETON),
      [ATLAS]: RENDERABLE_ATLAS,
      [RUNTIME_PATH]: RUNTIME_SOURCE,
      ...extraFiles,
    },
    binaries: { [PAGE]: GREEN_PNG, ...extraBinaries },
  });
}

const baseArgs = {
  skeleton: 'export/hero.json',
  atlas: 'export/hero.atlas',
  baselineDir: 'baseline',
  times: [0, 0.5],
  width: 16,
  height: 16,
};

describe('readManifest', () => {
  it('returns null when no manifest exists', () => {
    const host = regressionHost();
    const result = readManifest(host, BASELINE_DIR);
    expect(result.ok && result.data).toBeNull();
  });

  it('reports invalid JSON', () => {
    const host = regressionHost({ [join(BASELINE_DIR, MANIFEST_FILE)]: '{ broken' });
    const result = readManifest(host, BASELINE_DIR);
    expect(!result.ok && result.code).toBe(SpineErrorCode.ParseFailed);
  });

  it('rejects a manifest without files or times', () => {
    const host = regressionHost({
      [join(BASELINE_DIR, MANIFEST_FILE)]: JSON.stringify({ version: 1 }),
    });
    const result = readManifest(host, BASELINE_DIR);
    expect(!result.ok && result.code).toBe(SpineErrorCode.ValidationFailed);
  });
});

describe('visualRegression', () => {
  it('creates a baseline in update mode', async () => {
    const host = regressionHost();
    const result = await visualRegression(host, stubLauncher(), {
      ...baseArgs,
      mode: 'update',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.report.baselineWritten).toBe(true);
    expect(result.data.baselineFiles).toEqual([
      join(BASELINE_DIR, 'spin-00-0_000s.png'),
      join(BASELINE_DIR, 'spin-01-0_500s.png'),
    ]);

    const manifest = JSON.parse(host.writes[join(BASELINE_DIR, MANIFEST_FILE)]!);
    expect(manifest.skeletonHash).toBe('renderable');
    expect(manifest.times).toEqual([0, 0.5]);
    expect(manifest.width).toBe(16);
    expect(manifest.files).toHaveLength(2);
  });

  it('refuses to check without a baseline', async () => {
    const host = regressionHost();
    const result = await visualRegression(host, stubLauncher(), baseArgs);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.GateFailed);
    expect(result.hint).toContain('No baseline exists yet');
  });

  it('passes when the render matches the baseline', async () => {
    const host = regressionHost();
    const created = await visualRegression(host, stubLauncher(), {
      ...baseArgs,
      mode: 'update',
    });
    expect(created.ok).toBe(true);

    const checked = await visualRegression(host, stubLauncher(), baseArgs);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.data.report.passed).toBe(true);
    expect(checked.data.report.comparisons).toHaveLength(2);
    expect(checked.summary).toContain('2/2 frame(s) within tolerance');
  });

  it('fails and writes diff images when pixels move', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    const shifted = solidImage(16, 16, [0, 200, 0, 255]);
    // Change a quarter of the pixels, well past the default budget.
    for (let i = 0; i < 64; i++) {
      shifted.data[i * 4] = 255;
    }

    const result = await visualRegression(host, stubLauncher(shifted), {
      ...baseArgs,
      diffDir: 'diff',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.GateFailed);
    expect(result.hint).toContain('FAIL');
    expect(Object.keys(host.binaryWrites).some((path) => path.includes('diff'))).toBe(
      true,
    );
  });

  it('suggests diffDir when a failure has nowhere to write diffs', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    const changed = solidImage(16, 16, [255, 0, 0, 255]);
    const result = await visualRegression(host, stubLauncher(changed), baseArgs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.hint).toContain('Pass `diffDir`');
  });

  it('reports a changed skeleton hash instead of pixel noise', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    // Re-point the skeleton at data with a different hash.
    const edited = JSON.parse(toJsonText(RENDERABLE_SKELETON));
    edited.skeleton.hash = 'changed';
    host.writeText(SKELETON, JSON.stringify(edited));

    const result = await visualRegression(host, stubLauncher(), baseArgs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.GateFailed);
    expect(result.message).toContain('hash');
    expect(result.hint).toContain('skeleton_diff');
  });

  it('reports a changed canvas size as a baseline mismatch', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    const result = await visualRegression(host, stubLauncher(), {
      ...baseArgs,
      width: 32,
      height: 32,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.hint).toContain('16x16');
  });

  it('honours custom thresholds', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    const nudged = solidImage(16, 16, [2, 201, 1, 255]);
    const strict = await visualRegression(host, stubLauncher(nudged), {
      ...baseArgs,
      channelTolerance: 0,
      maxDifferentFraction: 0,
    });
    expect(strict.ok).toBe(false);

    const lenient = await visualRegression(host, stubLauncher(nudged), {
      ...baseArgs,
      channelTolerance: 5,
    });
    expect(lenient.ok).toBe(true);
  });

  it('reports a baseline image listed in the manifest but missing on disk', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    const manifestPath = join(BASELINE_DIR, MANIFEST_FILE);
    const manifest = JSON.parse(host.writes[manifestPath]!);
    // Rename the expected file so the lookup misses.
    manifest.files = ['spin-00-0_000s.png', 'spin-01-0_500s.png'];
    host.writeText(manifestPath, JSON.stringify(manifest));

    const bare = regressionHost({ [manifestPath]: JSON.stringify(manifest) });
    const result = await visualRegression(bare, stubLauncher(), baseArgs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InputMissing);
    expect(result.hint).toContain('mode "update"');
  });

  it('refuses a baseline directory outside the workspace', async () => {
    const host = regressionHost();
    const result = await visualRegression(host, stubLauncher(), {
      ...baseArgs,
      baselineDir: '../escape',
      mode: 'update',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });

  it('always states which renderer produced the frames', async () => {
    const host = regressionHost();
    const result = await visualRegression(host, stubLauncher(), {
      ...baseArgs,
      mode: 'update',
    });
    expect(result.ok && result.summary).toContain('authoritative visual output');
  });
});

describe('result size', () => {
  /**
   * A tool result travels over stdio and into an AI's context. A diff image
   * is a full RGBA buffer, so leaking one into the payload is both useless
   * to the caller and large enough to kill the transport — which it did,
   * once, before this was fixed.
   */
  function assertNoPixelBuffers(value: unknown): void {
    const serialised = JSON.stringify(value);
    expect(serialised).not.toContain('"type":"Buffer"');
    // Four 240x240 frames would be megabytes; a sane report is kilobytes.
    expect(serialised.length).toBeLessThan(60_000);
  }

  it('keeps diff images out of a passing result', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    const result = await visualRegression(host, stubLauncher(), baseArgs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const comparison of result.data.report.comparisons) {
      expect(comparison.diff).toBeNull();
      // The numbers a caller actually needs are still there.
      expect(typeof comparison.differentPixels).toBe('number');
      expect(typeof comparison.maxChannelDelta).toBe('number');
    }
    assertNoPixelBuffers(result.data);
  });

  it('keeps diff images out of a failing result', async () => {
    const host = regressionHost();
    await visualRegression(host, stubLauncher(), { ...baseArgs, mode: 'update' });

    const changed = solidImage(16, 16, [255, 0, 0, 255]);
    const result = await visualRegression(host, stubLauncher(changed), {
      ...baseArgs,
      diffDir: 'diff',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    assertNoPixelBuffers(result.details);
    // The failure still says which frames moved, and by how much.
    const frames = result.details?.['failedFrames'] as Array<Record<string, unknown>>;
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toHaveProperty('differentPixels');
    expect(frames[0]).toHaveProperty('maxChannelDelta');
    // And where to look at the picture.
    expect((result.details?.['diffFiles'] as string[]).length).toBeGreaterThan(0);
  });
});
