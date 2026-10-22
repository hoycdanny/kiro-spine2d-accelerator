/**
 * Real headless proof that a template-generated animation actually plays.
 *
 * Skips itself when Chromium is unavailable, so the suite still passes on a
 * machine without the Playwright browsers installed.
 *
 * `skeleton_animate`'s unit tests prove the emitted data is well formed:
 * the right timelines, finite values, a recomputed hash, no new lint
 * errors. None of that distinguishes an animation that moves from a frozen
 * pose that happens to render, and none of it can see a mirrored limb — so
 * these cases render the output across time and compare the frames.
 *
 * Set SPINE_KEEP_FRAMES=1 to keep the frames and a per-template contact
 * sheet in <tmp>/spine-feat004-frames, which is how the visual verdict in
 * the FEAT-004 findings was reached and how it can be repeated.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TEMPLATE_NAMES } from '../../src/animation-templates';
import { createNodeHost } from '../../src/host';
import { createPlaywrightLauncher } from '../../src/preview-renderer';
import { skeletonAnimate } from '../../src/tools/animate-tools';
import { evenSampleTimes, renderPreview } from '../../src/tools/preview-tools';
import { changedPixelMask } from '../../src/visual-regression';
import { CANONICAL_PALETTE, RigPaths, writeRig } from '../helpers/atlas-pages';
import { CANONICAL_RIG, CANONICAL_RIG_ATLAS } from '../helpers/fixtures';
import { RgbaImage, decodePng, encodePng, solidImage } from '../helpers/png';
import { chromiumAvailable, samplePoses } from '../helpers/runtime-page';

/** Frames sampled per animation: enough to see a cycle, cheap enough to render. */
const SAMPLE_COUNT = 6;

/** Where kept frames go, when SPINE_KEEP_FRAMES is set. */
const KEEP_DIR = join(tmpdir(), 'spine-feat004-frames');

let available = false;
let workspace = '';
let rig: RigPaths = { skeleton: '', atlas: '' };

beforeAll(async () => {
  available = await chromiumAvailable();
  if (!available) return;

  workspace = mkdtempSync(join(tmpdir(), 'spine-animate-'));
  rig = writeRig(workspace, 'canonical', CANONICAL_RIG, CANONICAL_RIG_ATLAS, CANONICAL_PALETTE);
  if (process.env['SPINE_KEEP_FRAMES'] === '1') mkdirSync(KEEP_DIR, { recursive: true });
}, 120_000);

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

/**
 * Tile frames left to right over a dark background.
 *
 * Transparent frames composited onto grey, because a limb crossing the
 * torso is only judgeable when every frame of the cycle is visible at once.
 */
function contactSheet(frames: RgbaImage[]): RgbaImage {
  const height = Math.max(...frames.map((frame) => frame.height));
  const width = frames.reduce((sum, frame) => sum + frame.width, 0);
  const sheet = solidImage(width, height, [24, 24, 28, 255]);

  let originX = 0;
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const from = (y * frame.width + x) * 4;
        const to = (y * width + originX + x) * 4;
        const alpha = frame.data[from + 3]! / 255;
        for (let channel = 0; channel < 3; channel++) {
          sheet.data[to + channel] = Math.round(
            frame.data[from + channel]! * alpha + sheet.data[to + channel]! * (1 - alpha),
          );
        }
      }
    }
    originX += frame.width;
  }

  return sheet;
}

describe('template-generated animations in the real renderer', () => {
  for (const template of TEMPLATE_NAMES) {
    it(`${template}: renders, moves over time and stays coherent`, async () => {
      if (!available) return;

      const host = createNodeHost({ workspaceRoot: workspace });
      const outPath = join(workspace, `${template}-rig.json`);

      // CANONICAL_RIG already declares an `idle`, so the name clash is
      // allowed rather than avoided: the point is to render the template's
      // own motion, not to pick a free name.
      const animated = skeletonAnimate(host, {
        skeleton: rig.skeleton,
        atlas: rig.atlas,
        animations: [{ template }],
        outPath,
        overwriteAnimations: true,
      });
      expect(animated.ok ? 'ok' : animated.message).toBe('ok');
      if (!animated.ok) return;

      const emitted = animated.data.animations[0]!;
      const times = evenSampleTimes(emitted.duration, SAMPLE_COUNT);

      const rendered = await renderPreview(host, createPlaywrightLauncher(), {
        skeleton: outPath,
        atlas: rig.atlas,
        animation: emitted.name,
        times,
        outputDir: `frames-${template}`,
        width: 256,
        height: 256,
      });
      // A page error comes back as CLI_FAILED carrying `pageErrors`, so an
      // ok result is the no-page-errors assertion.
      expect(rendered.ok ? 'ok' : rendered.message).toBe('ok');
      if (!rendered.ok) return;
      expect(rendered.data.files).toHaveLength(times.length);

      const frames = rendered.data.files.map((file) => decodePng(readFileSync(file)));
      const coverages = rendered.data.render.frames.map((frame) => frame.coverage);
      expect(Math.max(...coverages)).toBeGreaterThan(0);
      // Stronger than the criterion asks for, and true of this rig: the
      // character cannot leave the frame, because the camera is framed on
      // the union of every sampled pose.
      expect(Math.min(...coverages)).toBeGreaterThan(0);

      // Moving, not merely rendering. `changedPixelMask` counts a pixel as
      // changed only past the channel tolerance of 4, so this is movement
      // above rasteriser noise rather than any difference at all.
      const movement = frames
        .slice(1)
        .map((frame, index) => changedPixelMask(frames[index]!, frame).differentPixels);
      const moving = movement.filter((changed) => changed > 0).length;

      process.stdout.write(
        `\n[FEAT-004] ${template}: ${emitted.duration.toFixed(2)}s, coverage ` +
          `${Math.min(...coverages).toFixed(4)}-${Math.max(...coverages).toFixed(4)}, ` +
          `frame-to-frame changed pixels ${JSON.stringify(movement)}\n`,
      );

      // Not every pair: a still pair is legitimate here and is not a frozen
      // animation. `idle` is a symmetric triangle wave, so its samples
      // either side of the midpoint hold the same pose, and `turn_head` and
      // `wave` hold their extreme between two keyframes by design. A
      // majority of moving pairs separates that from a pose that never
      // changes at all, which is what a frozen render looks like.
      expect(movement.some((changed) => changed > 0)).toBe(true);
      expect(moving * 2).toBeGreaterThanOrEqual(movement.length);

      // Coherent: the runtime's own world transforms at the same moments.
      const poses = await samplePoses(host, createPlaywrightLauncher(), {
        skeletonJson: readFileSync(outPath, 'utf8'),
        atlasText: readFileSync(rig.atlas, 'utf8'),
        animation: emitted.name,
        times,
      });
      expect(poses.setupBounds).not.toBeNull();
      if (!poses.setupBounds) return;

      const setup = poses.setupBounds;
      // No limbs flying off: a pose may reach well outside the setup box —
      // a raised arm does — but not by more than three quarters of the
      // rig's own largest dimension. A detached limb or a bad constraint
      // overshoots this by orders of magnitude.
      const drift = Math.max(setup.width, setup.height) * 0.75;
      for (const sample of poses.samples) {
        expect(sample.nonFiniteBones).toEqual([]);
        expect(sample.bounds).not.toBeNull();
        if (!sample.bounds) continue;
        expect(sample.bounds.x).toBeGreaterThan(setup.x - drift);
        expect(sample.bounds.y).toBeGreaterThan(setup.y - drift);
        expect(sample.bounds.x + sample.bounds.width).toBeLessThan(
          setup.x + setup.width + drift,
        );
        expect(sample.bounds.y + sample.bounds.height).toBeLessThan(
          setup.y + setup.height + drift,
        );
      }

      if (process.env['SPINE_KEEP_FRAMES'] === '1') {
        for (const [index, file] of rendered.data.files.entries()) {
          writeFileSync(join(KEEP_DIR, `${template}-${index}.png`), readFileSync(file));
        }
        writeFileSync(
          join(KEEP_DIR, `${template}-sheet.png`),
          encodePng(contactSheet(frames)),
        );
      }
    }, 300_000);
  }
});
