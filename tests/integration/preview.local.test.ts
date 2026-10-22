/**
 * Real headless render: Chromium + the spine-ts WebGL runtime.
 *
 * Skips itself when Chromium is unavailable, so the suite still passes on a
 * machine without the Playwright browsers installed.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inspectAtlasText } from '../../src/atlas-data';
import { createNodeHost } from '../../src/host';
import { ProbeFrame, createPlaywrightLauncher, renderProbes } from '../../src/preview-renderer';
import { SlotBox, attributeChangedPixels } from '../../src/skeleton-probe';
import { skeletonDocument } from '../../src/tools/doc-tools';
import { loadAtlasImages, renderPreview } from '../../src/tools/preview-tools';
import { visualRegression } from '../../src/tools/regression-tools';
import { SpineErrorCode } from '../../src/types';
import { changedPixelMask } from '../../src/visual-regression';
import { CANONICAL_PALETTE, RigPaths, Rgba, writeRig } from '../helpers/atlas-pages';
import {
  CANONICAL_RIG,
  CANONICAL_RIG_ATLAS,
  PROBE_WARNING_ATLAS,
  PROBE_WARNING_SKELETON,
  RENDERABLE_ATLAS,
  RENDERABLE_SKELETON,
  clone,
  toJsonText,
} from '../helpers/fixtures';
import { RgbaImage, decodePng, encodePng, pixelDifference, solidImage } from '../helpers/png';

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

/**
 * The crest's colour, and nothing else's: pure green appears in no other
 * region of the probe page, so the crest's painted pixels are ground truth
 * the Y-flip guard can check the reported slot box against.
 */
const PROBE_PALETTE: Record<string, Rgba> = {
  body: [220, 60, 60, 255],
  crest: [0, 255, 0, 255],
};

let probeRig: RigPaths = { skeleton: '', atlas: '' };
let canonicalRig: RigPaths = { skeleton: '', atlas: '' };

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

  probeRig = writeRig(
    workspace,
    'probe-warning',
    PROBE_WARNING_SKELETON,
    PROBE_WARNING_ATLAS,
    PROBE_PALETTE,
  );
  canonicalRig = writeRig(
    workspace,
    'canonical',
    CANONICAL_RIG,
    CANONICAL_RIG_ATLAS,
    CANONICAL_PALETTE,
  );
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

// ============================================================
// Influence probes on the real runtime.
//
// A stub launcher proves the attribution arithmetic but never the page.
// Chromium is what decides whether `preserveDrawingBuffer` survived,
// whether the Y flip points the way both ends of the contract claim, and
// whether two runs in one process agree to the byte.
// ============================================================

/** What one probe run handed back, with the frames kept for comparison. */
interface ProbeRun {
  neutral: { png: Buffer; slotBoxes: SlotBox[]; coverage: number };
  canvas: { width: number; height: number };
  warnings: string[];
  frames: Array<Pick<ProbeFrame, 'bone' | 'axis' | 'png' | 'slotBoxes'>>;
}

/** Run a plan against the real page and keep every frame. */
async function runProbes(
  rig: RigPaths,
  probes: Array<{ bone: string; axis: ProbeFrame['axis'] }>,
  size = 256,
): Promise<ProbeRun> {
  const host = createNodeHost({ workspaceRoot: workspace });
  const skeletonJson = readFileSync(rig.skeleton, 'utf8');
  const atlasText = readFileSync(rig.atlas, 'utf8');

  const atlas = inspectAtlasText(atlasText);
  if (!atlas.ok) throw new Error(atlas.message);
  const images = loadAtlasImages(host, rig.atlas, atlas.data);
  if (!images.ok) throw new Error(images.message);

  const frames: ProbeRun['frames'] = [];
  const result = await renderProbes(host, createPlaywrightLauncher(), {
    skeletonJson,
    atlasText,
    images: images.data,
    probes,
    rotationDegrees: 20,
    translateFraction: 0.05,
    width: size,
    height: size,
    // The same atlas-derived rule `prepareRender` and `skeleton_document`
    // apply, so these frames composite like every other render here.
    premultipliedAlpha: atlas.data.pages.some((page) => page.pma),
    scale: 1,
    onProbeFrame: (frame) => {
      // Copied: the contract releases the Buffer when this returns.
      frames.push({
        bone: frame.bone,
        axis: frame.axis,
        png: Buffer.from(frame.png),
        slotBoxes: frame.slotBoxes,
      });
    },
  });
  if (!result.ok) {
    throw new Error(`${result.message} ${JSON.stringify(result.details ?? {})}`);
  }

  return {
    neutral: result.data.neutral,
    canvas: result.data.canvas,
    warnings: result.data.warnings,
    frames,
  };
}

/** Bounds of every pixel matching a predicate, in mask coordinates. */
function colourBounds(
  image: RgbaImage,
  matches: (r: number, g: number, b: number, a: number) => boolean,
): { x0: number; y0: number; x1: number; y1: number; count: number } | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      if (
        !matches(
          image.data[index]!,
          image.data[index + 1]!,
          image.data[index + 2]!,
          image.data[index + 3]!,
        )
      ) {
        continue;
      }
      count += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  return count === 0 ? null : { x0, y0, x1, y1, count };
}

/**
 * Interior crest pixels only.
 *
 * The alpha floor keeps the edge pixels out: an antialiased edge blends the
 * crest's green with the transparent background and can tint a pixel just
 * outside the attachment quad, which would make a containment assertion
 * fail for a reason that has nothing to do with the Y axis.
 */
function isCrestGreen(r: number, g: number, b: number, a: number): boolean {
  return a > 200 && g > 150 && r < 100 && b < 100;
}

describe('influence probes against the real runtime', () => {
  it('renders a non-blank neutral frame and attributes a rotation to the body slot', async () => {
    if (!available) return;

    const run = await runProbes({ skeleton: join(workspace, 'hero.json'), atlas: join(workspace, 'hero.atlas') }, [
      { bone: 'body', axis: 'rotate' },
    ]);

    // Asserted BEFORE any attribution, deliberately. A probe page that lost
    // `preserveDrawingBuffer` hands back blank or stale frames, every bone
    // reads changedFraction 0, and the document would report the whole rig
    // as dead bones — a confident wrong answer. This turns that into a loud
    // failure instead.
    expect(run.neutral.coverage).toBeGreaterThan(0);

    expect(run.frames).toHaveLength(1);
    const frame = run.frames[0]!;
    const mask = changedPixelMask(decodePng(run.neutral.png), decodePng(frame.png));
    expect(mask.differentPixels).toBeGreaterThan(0);

    const attributed = attributeChangedPixels(mask, run.neutral.slotBoxes, frame.slotBoxes, [
      'body',
    ]);
    expect(attributed.perSlot.map((entry) => entry.slot)).toEqual(['body']);
    expect(attributed.perSlot[0]!.changedPixels).toBeGreaterThan(0);
  }, 180_000);

  it('maps slot boxes into the mask coordinate system: the Y-flip guard', async () => {
    if (!available) return;

    const run = await runProbes(probeRig, [{ bone: 'body', axis: 'rotate' }]);
    expect(run.neutral.coverage).toBeGreaterThan(0);

    const crest = run.neutral.slotBoxes.find((box) => box.slot === 'crest');
    expect(crest).toBeDefined();
    if (!crest) return;
    const half = run.canvas.height / 2;

    // STEP ONE: the fixture has to be able to tell the two conventions
    // apart, so that an unsuitable one fails here instead of passing
    // vacuously. The guard is only meaningful on a vertically compact,
    // off-centre box: mirroring a box that straddles the midline, or that
    // spans most of the canvas height, changes nothing an assertion can
    // see. RENDERABLE_SKELETON's single full-canvas quad is exactly that
    // unsuitable case, which is why this case uses `crest`.
    expect(crest.y1 - crest.y0).toBeLessThan(run.canvas.height * 0.6);
    expect(crest.y1 < half || crest.y0 > half).toBe(true);

    // STEP TWO: where the crest actually is, read from the pixels rather
    // than from the box. `crest` is the only green region in the page
    // image, so its painted pixels are ground truth that no coordinate
    // convention can argue with. Camera.js:72's worldToScreen is
    // bottom-left origin and decodePng is top-left, so dropping
    // PROBE_SCRIPT step 8's flip throws nothing — it mirrors every box,
    // and this containment check is what notices.
    const neutral = decodePng(run.neutral.png);
    const green = colourBounds(neutral, isCrestGreen);
    expect(green).not.toBeNull();
    if (!green) return;

    expect(crest.x0).toBeLessThanOrEqual(green.x0);
    expect(crest.x1).toBeGreaterThanOrEqual(green.x1);
    expect(crest.y0).toBeLessThanOrEqual(green.y0);
    expect(crest.y1).toBeGreaterThanOrEqual(green.y1);
    expect(green.y1 < half).toBe(crest.y1 < half);

    // STEP THREE: every changed pixel the attribution credits to `crest`
    // lands in the same half of the mask as the crest's own pixels.
    const frame = run.frames[0]!;
    const mask = changedPixelMask(neutral, decodePng(frame.png));
    const perturbed = frame.slotBoxes.find((box) => box.slot === 'crest');
    expect(perturbed).toBeDefined();
    if (!perturbed) return;

    const boxes = [crest, perturbed];
    const crestIsAbove = green.y1 < half;
    let credited = 0;
    let wrongHalf = 0;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (mask.mask[y * mask.width + x] !== 1) continue;
        const inside = boxes.some(
          (box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1,
        );
        if (!inside) continue;
        credited += 1;
        if (y < half !== crestIsAbove) wrongHalf += 1;
      }
    }

    expect(credited).toBeGreaterThan(0);
    expect(wrongHalf).toBe(0);

    // STEP FOUR: the whole-mask version of the same claim. Every drawn
    // attachment here is a region, and a region's changed pixels always lie
    // inside the union of its before and after boxes — so a slot box in the
    // mask's own coordinate system leaves NOTHING unattributed. Mirror the
    // boxes and that stops being true across the whole canvas at once,
    // which makes this the cheapest statement of the Y-axis contract.
    const attributed = attributeChangedPixels(
      mask,
      run.neutral.slotBoxes,
      frame.slotBoxes,
      ['body', 'crest', 'muzzle', 'hitbox', 'clip'],
    );
    expect(attributed.unattributed).toBe(0);
  }, 180_000);

  it('is bit-deterministic: two runs in one process report identical changed pixels', async () => {
    if (!available) return;

    const rig = { skeleton: join(workspace, 'hero.json'), atlas: join(workspace, 'hero.atlas') };
    const probes: Array<{ bone: string; axis: ProbeFrame['axis'] }> = [
      { bone: 'root', axis: 'rotate' },
      { bone: 'body', axis: 'rotate' },
    ];

    const countsOf = async (): Promise<number[]> => {
      const run = await runProbes(rig, probes);
      const neutral = decodePng(run.neutral.png);
      return run.frames.map(
        (frame) => changedPixelMask(neutral, decodePng(frame.png)).differentPixels,
      );
    };

    const first = await countsOf();
    const second = await countsOf();

    expect(first).toHaveLength(probes.length);
    for (const count of first) expect(count).toBeGreaterThan(0);
    // The property design §3.6 rule 6 rests on: a document prints raw
    // pixel counts, so two runs that disagree would make it unreproducible.
    // The stub-launcher test cannot see this — canned frames pass either
    // way. If this ever fails, §3.6 rule 6 has the pre-decided fallback.
    expect(second).toEqual(first);
  }, 300_000);

  it('names every skipped attachment kind on a real page', async () => {
    if (!available) return;

    // RICH_SKELETON cannot stand in for this fixture: the pinned reader
    // throws `Couldn't find slot <name> for skin <skin>` because
    // RICH_SKELETON declares skin attachments under path-slot, muzzle and
    // clip while its slots are only leg-left, torso, head, glow, shadow
    // and hitbox, and its `blue` skin needs regions MODERN_ATLAS lacks. It
    // exercises the warning path through a stub launcher only.
    const host = createNodeHost({ workspaceRoot: workspace });
    const result = await skeletonDocument(host, createPlaywrightLauncher(), {
      skeleton: probeRig.skeleton,
      atlas: probeRig.atlas,
      outDir: join(workspace, 'docs'),
      probeMode: 'rotate',
    });

    expect(result.ok ? 'ok' : result.message).toBe('ok');
    if (!result.ok) return;

    // Exactly three: point, boundingbox and clipping are declared on
    // slots that carry them in the setup pose, and no path attachment
    // exists anywhere in the fixture.
    const warnings = result.data.probe.probeWarnings;
    expect(warnings).toHaveLength(3);
    expect(warnings.map((warning) => /'([a-z]+)'/.exec(warning)?.[1])).toEqual([
      'boundingbox',
      'clipping',
      'point',
    ]);

    const document = JSON.parse(readFileSync(result.data.jsonPath, 'utf8')) as {
      influence: {
        warnings: string[];
        bones: Array<{ bone: string; unattributedFraction: number }>;
      };
    };
    expect(document.influence.warnings.some((w) => w.includes("'clipping'"))).toBe(true);

    // MEASURED, correcting what design §3.3 leads a reader to expect: the
    // clipping warning does NOT come with unattributed pixels. The three
    // skipped kinds draw nothing, so they cost no pixels, and every drawn
    // attachment is a region whose changed pixels lie inside the union of
    // its before and after boxes. `unattributedFraction` is therefore a
    // zero-by-construction guard against boxes in the wrong coordinate
    // system — not a signal the warning predicts.
    const unattributed = document.influence.bones.map(
      (bone) => bone.unattributedFraction,
    );
    expect(unattributed.every((fraction) => fraction === 0)).toBe(true);
  }, 180_000);

  it('reports a bone with no slots and no descendants as having no visible effect', async () => {
    if (!available) return;

    const rig = clone(RENDERABLE_SKELETON) as { bones: Array<Record<string, unknown>> };
    rig.bones.push({ name: 'spare', parent: 'root', x: 8, y: 8 });
    const skeletonPath = join(workspace, 'dead-bone.json');
    writeFileSync(skeletonPath, toJsonText(rig), 'utf8');

    const host = createNodeHost({ workspaceRoot: workspace });
    const result = await skeletonDocument(host, createPlaywrightLauncher(), {
      skeleton: skeletonPath,
      atlas: join(workspace, 'hero.atlas'),
      outDir: join(workspace, 'docs'),
      probeMode: 'rotate',
    });

    expect(result.ok ? 'ok' : result.message).toBe('ok');
    if (!result.ok) return;
    expect(result.data.deadBones).toContain('spare');

    const document = JSON.parse(readFileSync(result.data.jsonPath, 'utf8')) as {
      influence: {
        bones: Array<{ bone: string; changedPixels: number; noVisibleEffect: boolean }>;
      };
    };
    const spare = document.influence.bones.find((bone) => bone.bone === 'spare');
    expect(spare).toBeDefined();
    expect(spare?.noVisibleEffect).toBe(true);
    expect(spare?.changedPixels).toBe(0);

    // The bones that do carry the render are not swept up with it.
    const body = document.influence.bones.find((bone) => bone.bone === 'body');
    expect(body?.noVisibleEffect).toBe(false);
  }, 180_000);

  it('documents a full rig in the default mode and reports the render time', async () => {
    if (!available) return;

    const host = createNodeHost({ workspaceRoot: workspace });
    const result = await skeletonDocument(host, createPlaywrightLauncher(), {
      skeleton: canonicalRig.skeleton,
      atlas: canonicalRig.atlas,
      outDir: join(workspace, 'docs'),
    });

    expect(result.ok ? 'ok' : result.message).toBe('ok');
    if (!result.ok) return;

    expect(result.data.probe.mode).toBe('rotate');
    expect(result.data.probe.available).toBe(true);
    expect(result.data.probe.performed).toBe(result.data.probe.planned);
    expect(result.data.probe.canvas).toEqual({ width: 256, height: 256 });
    expect(result.data.probe.elapsedMs).toBeGreaterThan(0);

    // Printed rather than asserted against a bound: this is the number
    // design §2.3 only estimated, and the dial it informs is the default
    // probeWidth/probeHeight.
    process.stdout.write(
      `\n[FEAT-004] skeleton_document default mode: ${result.data.probe.performed} probes over ` +
        `${result.data.counts.bones} bones at 256x256 in ${result.data.probe.elapsedMs} ms ` +
        `(${(result.data.probe.elapsedMs / result.data.probe.performed).toFixed(0)} ms/probe)\n`,
    );
  }, 300_000);
});
