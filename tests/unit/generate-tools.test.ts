import { SidecarRunner } from '../../src/sidecar';
import { psdToSkeleton } from '../../src/tools/generate-tools';
import { probeAll } from '../../src/tools/env-tools';
import { SIDECAR_PROTOCOL_VERSION } from '../../src/sidecar';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';

const PSD = 'C:\\work\\project\\art\\hero.psd';
const OUT = 'C:\\work\\project\\generated';
const SKELETON = `${OUT}\\hero.json`;
const ATLAS = `${OUT}\\hero.atlas`;
const IMAGES_DIR = `${OUT}\\images`;

/**
 * Skeleton data shaped like what the Python generator writes: underscore
 * bone names, region attachments, an empty setup animation.
 */
const GENERATED_SKELETON = {
  skeleton: {
    spine: '4.2.37',
    hash: 'generatedhash',
    x: -35,
    y: 0,
    width: 70,
    height: 250,
    fps: 30,
    images: './images/',
  },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root' },
    { name: 'torso', parent: 'hip' },
    { name: 'chest', parent: 'torso' },
    { name: 'neck', parent: 'chest' },
    { name: 'head', parent: 'neck', y: 150 },
  ],
  slots: [
    { name: 'torso', bone: 'torso', attachment: 'torso' },
    { name: 'head', bone: 'head', attachment: 'head' },
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        torso: { torso: { x: 0, y: 75, width: 40, height: 150 } },
        head: { head: { x: 0, y: 50, width: 60, height: 100 } },
      },
    },
  ],
  animations: { setup: {} },
};

const GENERATED_ATLAS = [
  'hero.png',
  'size: 128, 256',
  'format: RGBA8888',
  'filter: Linear, Linear',
  'repeat: none',
  'pma: false',
  'head',
  'bounds: 1, 1, 60, 100',
  'torso',
  'bounds: 63, 1, 40, 150',
  '',
].join('\n');

const SIDECAR_DATA = {
  skeletonPath: SKELETON,
  atlasPath: ATLAS,
  pagePaths: [`${OUT}\\hero.png`],
  boneCount: 6,
  slotCount: 2,
  attachmentCount: 2,
  regionNames: ['head', 'torso'],
  virtualBones: ['root', 'hip', 'chest', 'neck'],
  unmappedLayers: ['mysterious cape'],
  warnings: ['No layer provided bone "neck"; it was created as a positioned virtual bone.'],
  imagesDir: IMAGES_DIR,
  imagePaths: [`${IMAGES_DIR}\\head.png`, `${IMAGES_DIR}\\torso.png`],
  staleImagesRemoved: [],
};

function sidecar(
  response: Record<string, unknown>,
  capture?: { request?: Record<string, unknown> },
): SidecarRunner {
  return async (request) => {
    if (capture) capture.request = request;
    return {
      code: 0,
      stdout: JSON.stringify(response),
      stderr: '',
      timedOut: false,
    };
  };
}

function generateHost() {
  return createFakeHost({
    paths: [PSD],
    files: {
      [SKELETON]: JSON.stringify(GENERATED_SKELETON),
      [ATLAS]: GENERATED_ATLAS,
    },
  });
}

describe('psdToSkeleton', () => {
  it('passes resolved paths to the sidecar', async () => {
    const host = generateHost();
    const capture: { request?: Record<string, unknown> } = {};
    const result = await psdToSkeleton(
      host,
      sidecar({ ok: true, data: SIDECAR_DATA }, capture),
      { psd: 'art/hero.psd', outDir: 'generated', name: 'hero' },
    );

    expect(result.ok).toBe(true);
    expect(capture.request).toEqual({
      command: 'psd_to_skeleton',
      psdPath: PSD,
      outDir: OUT,
      name: 'hero',
    });
  });

  it('forwards the optional packing arguments', async () => {
    const host = generateHost();
    const capture: { request?: Record<string, unknown> } = {};
    await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }, capture), {
      psd: 'art/hero.psd',
      outDir: 'generated',
      padding: 4,
      maxSize: 1024,
      premultipliedAlpha: true,
    });
    expect(capture.request).toMatchObject({
      padding: 4,
      maxSize: 1024,
      premultipliedAlpha: true,
    });
  });

  it('inspects and lints what the generator produced', async () => {
    const host = generateHost();
    const result = await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }), {
      psd: 'art/hero.psd',
      outDir: 'generated',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.skeleton?.bones.count).toBe(6);
    expect(result.data.lint).not.toBeNull();
    // Underscore names are the generator's convention, so those rules are off.
    expect(
      result.data.lint!.findings.some((finding) => finding.id.startsWith('naming/')),
    ).toBe(false);
    expect(result.data.lint!.counts.error).toBe(0);
  });

  it('reports virtual bones and unmapped layers', async () => {
    const host = generateHost();
    const result = await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }), {
      psd: 'art/hero.psd',
      outDir: 'generated',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('Virtual bones created');
    expect(result.summary).toContain('mysterious cape');
  });

  it('reports the loose images folder and the PNG count', async () => {
    const host = generateHost();
    const result = await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }), {
      psd: 'art/hero.psd',
      outDir: 'generated',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain(`Images: ${IMAGES_DIR} — 2 loose PNG(s)`);
    expect(result.summary).toContain('File -> Import Data');
    // The full list travels in structuredContent, not in the summary text.
    expect(result.data.generated.imagePaths).toEqual([
      `${IMAGES_DIR}\\head.png`,
      `${IMAGES_DIR}\\torso.png`,
    ]);
    expect(result.summary).not.toContain('head.png');
  });

  it('forwards emitLooseImages when the caller turns it off', async () => {
    const host = generateHost();
    const capture: { request?: Record<string, unknown> } = {};
    await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }, capture), {
      psd: 'art/hero.psd',
      outDir: 'generated',
      emitLooseImages: false,
    });
    expect(capture.request).toMatchObject({ emitLooseImages: false });
  });

  it('warns that editor import will not resolve when no images were written', async () => {
    // Either an older sidecar with no image fields at all, or the toggle off.
    const host = generateHost();
    const { imagesDir, imagePaths, staleImagesRemoved, ...withoutImages } = SIDECAR_DATA;
    const result = await psdToSkeleton(host, sidecar({ ok: true, data: withoutImages }), {
      psd: 'art/hero.psd',
      outDir: 'generated',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('No loose per-attachment images were written');
    expect(result.summary).toContain('File -> Import Data');
    expect(result.data.generated.imagePaths).toBeUndefined();
  });

  it('reports stale images that were pruned', async () => {
    const host = generateHost();
    const result = await psdToSkeleton(
      host,
      sidecar({
        ok: true,
        data: { ...SIDECAR_DATA, staleImagesRemoved: ['cape.png', 'sword.png'] },
      }),
      { psd: 'art/hero.psd', outDir: 'generated' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('Stale images pruned');
    expect(result.summary).toContain('cape.png, sword.png');
  });

  it('names the import step as the next action', async () => {
    const host = generateHost();
    const result = await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }), {
      psd: 'art/hero.psd',
      outDir: 'generated',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nextStep).toContain('spine_import');
    expect(result.summary).toContain('needs a licensed Spine');
  });

  it('reports a missing PSD before calling the sidecar', async () => {
    const host = generateHost();
    let called = false;
    const result = await psdToSkeleton(
      host,
      async () => {
        called = true;
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
      { psd: 'art/nope.psd', outDir: 'generated' },
    );
    expect(called).toBe(false);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('refuses an output directory outside the workspace', async () => {
    const host = generateHost();
    const result = await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }), {
      psd: 'art/hero.psd',
      outDir: '../escape',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });

  it('propagates a sidecar validation failure', async () => {
    const host = generateHost();
    const result = await psdToSkeleton(
      host,
      sidecar({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The generated skeleton failed structural validation: Expected exactly one root bone, found 2.',
          hint: 'This is a bug in the generator or an unusual PSD.',
        },
      }),
      { psd: 'art/hero.psd', outDir: 'generated' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
    expect(result.message).toContain('one root bone');
  });

  it('still succeeds when the generated file cannot be re-read', async () => {
    // The sidecar wrote files the in-memory host does not know about.
    const host = createFakeHost({ paths: [PSD] });
    const result = await psdToSkeleton(host, sidecar({ ok: true, data: SIDECAR_DATA }), {
      psd: 'art/hero.psd',
      outDir: 'generated',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.skeleton).toBeNull();
    expect(result.data.lint).toBeNull();
  });
});

describe('probeAll', () => {
  const readyProbe = {
    ok: true,
    data: {
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      python: '3.12.10',
      dependencies: { 'psd-tools': '1.10.7' },
      missing: [],
      ready: true,
    },
  };

  it('reports Spine and the sidecar together', async () => {
    const host = createFakeHost({ edition: 'trial' });
    const result = await probeAll(host, sidecar(readyProbe));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.spine.edition).toBe('trial');
    expect(result.data.sidecar).toEqual({ available: true, probe: readyProbe.data });
    expect(result.summary).toContain('sidecar ready');
  });

  it('reports an unavailable sidecar without failing the probe', async () => {
    const host = createFakeHost({ edition: 'trial' });
    const result = await probeAll(
      host,
      async () => ({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: 'spawn uv ENOENT' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sidecar).toMatchObject({ available: false });
    expect(result.summary).toContain('PSD generation unavailable');
  });

  it('skips the sidecar probe when asked', async () => {
    const host = createFakeHost({ edition: 'trial' });
    let called = false;
    const result = await probeAll(
      host,
      async () => {
        called = true;
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
      { includeSidecar: false },
    );

    expect(called).toBe(false);
    expect(result.ok && result.data.sidecar).toBeNull();
  });

  it('fails when Spine itself is missing', async () => {
    const host = createFakeHost({ edition: 'none' });
    const result = await probeAll(host, sidecar(readyProbe));
    expect(!result.ok && result.code).toBe(SpineErrorCode.SpineNotFound);
  });
});
