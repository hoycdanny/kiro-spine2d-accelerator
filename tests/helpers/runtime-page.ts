/**
 * Drive the pinned spine-ts runtime in a real page, for the facts a
 * rendered frame does not carry.
 *
 * `RENDER_SCRIPT` reports pixels, coverage and bounds; it says nothing
 * about bone world transforms, and it is byte-frozen because every
 * visual-regression baseline in the repo depends on it. So the proofs that
 * need transforms drive their own minimal page from the same runtime
 * source, through the same launcher and therefore the same Chromium args.
 * No canvas and no GL context: `AnimationState` plus `updateWorldTransform`
 * is pure data, and the atlas regions carry usable UVs straight out of the
 * parser (`TextureAtlas.js` computes `u`/`v` from the page `size:` line),
 * so nothing has to be textured to compute a world vertex.
 *
 * The in-page sampler mirrors `RENDER_SCRIPT`'s `poseAt` step for step —
 * setup pose, cleared tracks, looping track 0, fixed-step advance — so a
 * sample describes the same moment the matching frame rendered.
 */
import { SpineHost } from '../../src/host';
import {
  BrowserLauncher,
  createPlaywrightLauncher,
  loadRuntimeSource,
} from '../../src/preview-renderer';

/** A rectangle in skeleton world units. */
export interface PoseBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One sampled moment of an animation, as the runtime computed it. */
export interface PoseSample {
  time: number;
  /** Bones whose world transform held a non-finite number. Empty is the pass. */
  nonFiniteBones: string[];
  /** Bounds of everything drawn at this time, or null when nothing was. */
  bounds: PoseBounds | null;
}

/** What {@link samplePoses} measured. */
export interface PoseSampleResult {
  /** The rig's own extent, which "no limbs flying off" is judged against. */
  setupBounds: PoseBounds | null;
  samples: PoseSample[];
  boneCount: number;
}

/** Everything the in-page sampler needs, as one serialisable argument. */
interface SampleInput {
  skeletonJson: string;
  atlasText: string;
  animation: string;
  times: number[];
  stepSeconds: number;
}

/**
 * Only what the sampler touches of the page's `spine` global.
 *
 * Loose on purpose: this file cannot import the runtime bundle (it is an
 * IIFE for a browser), so the shape is declared rather than derived.
 */
interface SkeletonLike {
  bones: Array<{
    data: { name: string };
    worldX: number;
    worldY: number;
    a: number;
    b: number;
    c: number;
    d: number;
  }>;
  setToSetupPose: () => void;
  update: (delta: number) => void;
  updateWorldTransform: (physics: unknown) => void;
  getBounds: (
    offset: { x: number; y: number },
    size: { x: number; y: number },
    temp: number[],
  ) => void;
}

interface SpineRuntime {
  TextureAtlas: new (text: string) => unknown;
  AtlasAttachmentLoader: new (atlas: unknown) => unknown;
  SkeletonJson: new (loader: unknown) => { readSkeletonData: (json: string) => unknown };
  Skeleton: new (data: unknown) => SkeletonLike;
  AnimationStateData: new (data: unknown) => unknown;
  AnimationState: new (data: unknown) => {
    clearTracks: () => void;
    setAnimation: (track: number, name: string, loop: boolean) => unknown;
    update: (delta: number) => void;
    apply: (skeleton: SkeletonLike) => boolean;
  };
  Vector2: new () => { x: number; y: number };
  Physics: { update: unknown };
}

/** True when Chromium can actually be launched on this machine. */
export async function chromiumAvailable(): Promise<boolean> {
  try {
    const browser = await createPlaywrightLauncher()();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/** Sample bone world transforms and pose bounds across an animation. */
export async function samplePoses(
  host: SpineHost,
  launcher: BrowserLauncher,
  input: {
    skeletonJson: string;
    atlasText: string;
    animation: string;
    times: number[];
    stepSeconds?: number;
  },
): Promise<PoseSampleResult> {
  const runtime = loadRuntimeSource(host);
  if (!runtime.ok) throw new Error(runtime.message);

  const browser = await launcher();
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (payload) => {
      pageErrors.push(String(payload));
    });

    await page.setContent(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Spine pose sampler</title></head><body><script>${runtime.data}</script></body></html>`,
      { waitUntil: 'load' },
    );

    const result = await page.evaluate<PoseSampleResult, SampleInput>((arg) => {
      const spine = (globalThis as unknown as { spine: SpineRuntime }).spine;

      const atlas = new spine.TextureAtlas(arg.atlasText);
      const json = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
      const skeletonData = json.readSkeletonData(arg.skeletonJson);
      const skeleton = new spine.Skeleton(skeletonData);
      const state = new spine.AnimationState(new spine.AnimationStateData(skeletonData));

      const offset = new spine.Vector2();
      const size = new spine.Vector2();
      const boundsNow = (): PoseBounds | null => {
        skeleton.getBounds(offset, size, []);
        if (!isFinite(offset.x) || !isFinite(size.x) || size.x <= 0 || size.y <= 0) {
          return null;
        }
        return { x: offset.x, y: offset.y, width: size.x, height: size.y };
      };

      // Step for step what RENDER_SCRIPT's poseAt does, so a sample and the
      // frame rendered at the same time describe the same pose.
      const poseAt = (time: number): void => {
        skeleton.setToSetupPose();
        state.clearTracks();
        state.setAnimation(0, arg.animation, true);
        const step = Math.max(arg.stepSeconds, 1 / 240);
        const steps = Math.ceil(time / step);
        for (let i = 0; i < steps; i++) {
          const delta = i === steps - 1 ? time - step * (steps - 1) : step;
          state.update(delta);
          state.apply(skeleton);
          skeleton.update(delta);
          skeleton.updateWorldTransform(spine.Physics.update);
        }
        if (steps === 0) {
          state.update(0);
          state.apply(skeleton);
          skeleton.updateWorldTransform(spine.Physics.update);
        }
      };

      skeleton.setToSetupPose();
      skeleton.updateWorldTransform(spine.Physics.update);
      const setupBounds = boundsNow();

      const samples: PoseSample[] = [];
      for (const time of arg.times) {
        poseAt(time);
        const nonFiniteBones: string[] = [];
        for (const bone of skeleton.bones) {
          const values = [bone.worldX, bone.worldY, bone.a, bone.b, bone.c, bone.d];
          if (values.some((value) => !isFinite(value))) nonFiniteBones.push(bone.data.name);
        }
        samples.push({ time, nonFiniteBones, bounds: boundsNow() });
      }

      return { setupBounds, samples, boneCount: skeleton.bones.length };
    }, {
      skeletonJson: input.skeletonJson,
      atlasText: input.atlasText,
      animation: input.animation,
      times: input.times,
      stepSeconds: input.stepSeconds ?? 1 / 60,
    });

    if (pageErrors.length > 0) {
      throw new Error(`The pose sampler page reported errors: ${pageErrors.join(' | ')}`);
    }
    return result;
  } finally {
    try {
      await browser.close();
    } catch {
      // A browser that already exited is not an error worth surfacing.
    }
  }
}
