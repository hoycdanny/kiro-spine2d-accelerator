/**
 * Both new tools against the rig the real pipeline produced.
 *
 * Every other proof in this suite drives a hand-written fixture. This one
 * drives `demo/out/generated/`, which `node demo/run-demo.js` produces from
 * a PSD through `psd_to_skeleton` — the only rig in the repo that came out
 * of the pipeline rather than out of a fixtures file.
 *
 * Skips itself when Chromium is unavailable or when the demo has not been
 * run (the folder is git-ignored). Regenerate it with:
 *   npx tsc -p tsconfig.json && node demo/run-demo.js
 *
 * ASSERTS RELATIONSHIPS, NEVER COUNTS, and never the literal hash: the
 * parallel demo-polish branch changes the demo character, so an assertion
 * naming 12 bones, 6 attachments or one particular hash would break the
 * moment it merges. The relationships asserted here are properties of the
 * rig's shape, not of its size.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { TEMPLATE_NAMES } from '../../src/animation-templates';
import { createNodeHost } from '../../src/host';
import { createPlaywrightLauncher } from '../../src/preview-renderer';
import { compareStaleness, fingerprintSkeleton } from '../../src/skeleton-doc';
import { skeletonAnimate } from '../../src/tools/animate-tools';
import { skeletonInspect } from '../../src/tools/data-tools';
import { skeletonDocument } from '../../src/tools/doc-tools';
import { skeletonLint } from '../../src/tools/lint-tools';
import { evenSampleTimes, renderPreview } from '../../src/tools/preview-tools';
import { changedPixelMask } from '../../src/visual-regression';
import { decodePng } from '../helpers/png';
import { chromiumAvailable, samplePoses } from '../helpers/runtime-page';

const repoRoot = resolve(__dirname, '..', '..');
const generated = join(repoRoot, 'demo', 'out', 'generated');
const heroSkeleton = join(generated, 'hero.json');
const heroAnimated = join(generated, 'hero-animated.json');
const heroAtlas = join(generated, 'hero.atlas');

/** The three naming rules `skeleton_animate` disables for its own delta gate. */
const LINT_RULES = join(repoRoot, 'demo', 'out', 'feat004-lint-rules.json');

/** The document the influence proof reads back. */
interface InfluenceDocument {
  influence: {
    available: boolean;
    bones: Array<{
      bone: string;
      axis: string;
      changedFraction: number;
      unattributedFraction: number;
      noVisibleEffect: boolean;
      slots: Array<{ slot: string; changedFraction: number }>;
    }>;
  };
}

let available = false;

beforeAll(async () => {
  if (!existsSync(heroAnimated) || !existsSync(heroAtlas)) return;
  available = await chromiumAvailable();
}, 120_000);

describe('skeleton_document and skeleton_animate on the real demo rig', () => {
  it('attributes a head rotation to the head slot and not to a disjoint subtree', async () => {
    if (!available) return;

    const host = createNodeHost({ workspaceRoot: repoRoot });
    const result = await skeletonDocument(host, createPlaywrightLauncher(), {
      skeleton: heroAnimated,
      atlas: heroAtlas,
      outDir: join(generated, 'doc'),
      probeMode: 'rotate',
    });

    expect(result.ok ? 'ok' : result.message).toBe('ok');
    if (!result.ok) return;
    expect(result.data.probe.available).toBe(true);
    expect(result.data.probe.performed).toBe(result.data.probe.planned);

    const document = JSON.parse(
      readFileSync(result.data.jsonPath, 'utf8'),
    ) as InfluenceDocument;

    const influenced = (bone: string): string[] => {
      const entry = document.influence.bones.find((probe) => probe.bone === bone);
      expect(entry).toBeDefined();
      return (entry?.slots ?? []).map((slot) => slot.slot);
    };

    // `head` and `thigh_left` sit in disjoint subtrees of this rig
    // (root -> hip -> torso -> chest -> neck -> head versus
    // root -> hip -> thigh_left), so this is a claim about the rig's
    // structure rather than a tolerance. Perturbing one cannot move the
    // other, and a probe that says otherwise has its boxes wrong.
    const fromHead = influenced('head');
    expect(fromHead).toContain('head');
    expect(fromHead).not.toContain('thigh_left');

    const fromThigh = influenced('thigh_left');
    expect(fromThigh).toContain('thigh_left');
    expect(fromThigh).not.toContain('head');

    // The box model places every changed pixel, on a real rig as on the
    // fixtures: a non-zero value here means a slot box landed in the wrong
    // coordinate system.
    for (const bone of document.influence.bones) {
      expect(bone.unattributedFraction).toBe(0);
    }

    const headEntry = document.influence.bones.find((bone) => bone.bone === 'head');
    const thighEntry = document.influence.bones.find(
      (bone) => bone.bone === 'thigh_left',
    );
    process.stdout.write(
      `\n[FEAT-004] demo rig: ${result.data.probe.performed} probes over ` +
        `${result.data.counts.bones} bones in ${result.data.probe.elapsedMs} ms. ` +
        `head changedFraction ${headEntry?.changedFraction} slots ` +
        `${JSON.stringify(headEntry?.slots)}; thigh_left changedFraction ` +
        `${thighEntry?.changedFraction} slots ${JSON.stringify(thighEntry?.slots)}\n`,
    );
  }, 300_000);

  it('generates all five templates onto the real rig, and they play', async () => {
    if (!available) return;

    const host = createNodeHost({ workspaceRoot: repoRoot });
    const outPath = join(generated, 'hero-templates.json');

    const animated = skeletonAnimate(host, {
      skeleton: heroSkeleton,
      atlas: heroAtlas,
      animations: TEMPLATE_NAMES.map((template) => ({ template })),
      outPath,
      overwriteFile: true,
    });
    expect(animated.ok ? 'ok' : animated.message).toBe('ok');
    if (!animated.ok) return;

    // All five fit this rig: torso for idle, thigh_left/thigh_right for
    // walk, arm_right for wave, hip for jump, head for turn_head.
    expect(animated.data.animations).toHaveLength(TEMPLATE_NAMES.length);
    expect(animated.data.hashTo).not.toBe(animated.data.hashFrom);

    // Re-read with the tools a caller would use, rather than trusting the
    // reports the writing tool returned.
    const inspected = skeletonInspect(host, { input: outPath, atlas: heroAtlas });
    expect(inspected.ok ? 'ok' : inspected.message).toBe('ok');
    if (!inspected.ok) return;
    expect(inspected.data.atlasCrossCheck?.missingRegions).toEqual([]);
    for (const template of TEMPLATE_NAMES) {
      expect(inspected.data.report.animations.map((entry) => entry.name)).toContain(
        template,
      );
    }

    writeFileSync(
      LINT_RULES,
      `${JSON.stringify(
        { disabled: ['naming/bone', 'naming/slot', 'naming/attachment'] },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const linted = skeletonLint(host, {
      input: outPath,
      atlas: heroAtlas,
      rules: [LINT_RULES],
    });
    expect(linted.ok ? 'ok' : linted.message).toBe('ok');

    // Renders and moves, by the same criteria as the CANONICAL_RIG proof.
    for (const emitted of animated.data.animations) {
      const times = evenSampleTimes(emitted.duration, 5);
      const rendered = await renderPreview(host, createPlaywrightLauncher(), {
        skeleton: outPath,
        atlas: heroAtlas,
        animation: emitted.name,
        times,
        width: 256,
        height: 256,
        outputDir: join(generated, 'doc', `frames-${emitted.name}`),
      });
      expect(rendered.ok ? 'ok' : rendered.message).toBe('ok');
      if (!rendered.ok) return;

      const frames = rendered.data.files.map((file) => decodePng(readFileSync(file)));
      const coverages = rendered.data.render.frames.map((frame) => frame.coverage);
      expect(Math.min(...coverages)).toBeGreaterThan(0);

      const movement = frames
        .slice(1)
        .map((frame, index) => changedPixelMask(frames[index]!, frame).differentPixels);
      const moving = movement.filter((changed) => changed > 0).length;
      expect(movement.some((changed) => changed > 0)).toBe(true);
      expect(moving * 2).toBeGreaterThanOrEqual(movement.length);

      const poses = await samplePoses(host, createPlaywrightLauncher(), {
        skeletonJson: readFileSync(outPath, 'utf8'),
        atlasText: readFileSync(heroAtlas, 'utf8'),
        animation: emitted.name,
        times,
      });
      expect(poses.setupBounds).not.toBeNull();
      if (!poses.setupBounds) return;
      const setup = poses.setupBounds;
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

      process.stdout.write(
        `\n[FEAT-004] demo rig ${emitted.name}: changed pixels ${JSON.stringify(
          movement,
        )}\n`,
      );
    }
  }, 600_000);

  it('shows skeleton.hash missing a change the fingerprint catches', () => {
    if (!existsSync(heroAnimated)) return;

    const hero = JSON.parse(readFileSync(heroSkeleton, 'utf8')) as Record<
      string,
      unknown
    >;
    const withAnimations = JSON.parse(readFileSync(heroAnimated, 'utf8')) as Record<
      string,
      unknown
    >;

    const hashOf = (root: Record<string, unknown>): string =>
      String((root['skeleton'] as Record<string, unknown>)['hash']);
    const animationsOf = (root: Record<string, unknown>): string[] =>
      Object.keys((root['animations'] ?? {}) as Record<string, unknown>);

    // The measurement FR-A18 and AC-16 rest on: two files that differ by
    // whole animations carry the SAME editor hash.
    expect(hashOf(withAnimations)).toBe(hashOf(hero));
    expect(animationsOf(withAnimations).length).toBeGreaterThan(
      animationsOf(hero).length,
    );

    const fingerprint = fingerprintSkeleton(withAnimations);
    expect(fingerprint).not.toBe(fingerprintSkeleton(hero));
    expect(
      compareStaleness(
        { skeletonHash: hashOf(hero), fingerprint: fingerprintSkeleton(hero) },
        { skeletonHash: hashOf(withAnimations), fingerprint },
      ),
    ).toBe('fingerprintChanged');

    process.stdout.write(
      `\n[FEAT-004] demo rig staleness: hero.json and hero-animated.json share ` +
        `skeleton.hash ${hashOf(hero)} while differing by ` +
        `${animationsOf(withAnimations).length - animationsOf(hero).length} animation(s); ` +
        `fingerprints ${fingerprintSkeleton(hero)} -> ${fingerprint}\n`,
    );
  });
});
