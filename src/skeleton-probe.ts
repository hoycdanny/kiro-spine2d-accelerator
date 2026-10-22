// ============================================================
// Influence probes: the plan, and the arithmetic that attributes a
// changed pixel to a slot.
//
// Pure. The cost model runs before the browser is launched and before
// anything is written, so an over-budget request costs nothing. The
// attribution arithmetic is separated from `preview-renderer.ts` on
// purpose: the renderer knows about pages and PNGs, this module knows
// about masks and buckets, and neither has to know the other.
// ============================================================

import { byCodeUnit } from './canonical-json';
import {
  BUCKET_THRESHOLDS,
  ConstraintIndex,
  InfluenceBucket,
  ProbeAxis,
  ProbeMode,
} from './skeleton-doc';
import { SpineErrorCode, SpineResult, err, ok } from './types';

export type { InfluenceBucket, ProbeAxis, ProbeMode };

/**
 * The axes each mode perturbs, in the fixed order they are applied.
 *
 * `rotate` is the default mode because rotation is what a bone in a Spine
 * rig is for; translation-only influence is confined to `root`/`hip`, and
 * `full` exists for when that is the question.
 */
export const PROBE_AXES: Record<ProbeMode, ProbeAxis[]> = {
  off: [],
  rotate: ['rotate'],
  full: ['rotate', 'translateX', 'translateY'],
};

/** One bone-axis combination to render. */
export interface ProbeTarget {
  bone: string;
  axis: ProbeAxis;
}

/** What the browser will be asked to do, decided before it is launched. */
export interface ProbePlan {
  mode: ProbeMode;
  axes: ProbeAxis[];
  /** Bones in skeleton declaration order, filtered by `probeBones`. */
  bones: string[];
  /** `bones.length * axes.length`. */
  plannedCount: number;
  /**
   * The plan flattened in BONE-MAJOR order: skeleton declaration order
   * first, then axis in the fixed order `rotate`, `translateX`,
   * `translateY`. That matches how the influence section sorts its rows,
   * which is what makes batch boundaries and the determinism assertion
   * reproducible rather than incidental.
   */
  targets: ProbeTarget[];
}

/**
 * Decide what to probe, and refuse an over-budget plan before any IO.
 *
 * The probe samples one moment, never an animation, so the cost is
 * `1 + bones × axesPerMode` rather than `O(bones × frames)`. The list is
 * never silently truncated: a document that quietly skipped half the rig
 * is worse than no document, so an over-cap request is an
 * `INVALID_ARGUMENT` naming both numbers and the three ways down.
 */
export function planProbes(
  boneNames: string[],
  args: { probeMode: ProbeMode; probeBones?: string[] | undefined; maxProbes: number },
): SpineResult<ProbePlan> {
  const axes = PROBE_AXES[args.probeMode];

  let bones = boneNames;
  if (args.probeBones !== undefined) {
    const declared = new Set(boneNames);
    const unknown = args.probeBones.filter((name) => !declared.has(name));
    if (unknown.length > 0) {
      return err(
        SpineErrorCode.InvalidArgument,
        `probeBones names ${unknown.length} bone(s) this skeleton does not declare: ${unknown.join(', ')}.`,
        `The rig declares: ${boneNames.join(', ')}.`,
        { unknown, declared: boneNames },
      );
    }
    const wanted = new Set(args.probeBones);
    // Declaration order, not the caller's order: the plan's order is the
    // document's row order, and the document's is the skeleton's.
    bones = boneNames.filter((name) => wanted.has(name));
  }

  const plannedCount = bones.length * axes.length;

  if (plannedCount > args.maxProbes) {
    return err(
      SpineErrorCode.InvalidArgument,
      `Probing ${plannedCount} bone-axis combination(s) exceeds the maximum of ${args.maxProbes}.`,
      "Raise maxProbes (up to 512), narrow the rig with probeBones, or use probeMode 'rotate' instead of 'full'. " +
        'The list is never silently truncated, because a document that quietly skipped half the rig is worse than no document.',
      { plannedCount, maxProbes: args.maxProbes },
    );
  }

  const targets: ProbeTarget[] = [];
  for (const bone of bones) {
    for (const axis of axes) targets.push({ bone, axis });
  }

  return ok(
    { mode: args.probeMode, axes: [...axes], bones, plannedCount, targets },
    `Planned ${plannedCount} probe(s) over ${bones.length} bone(s) in ${args.probeMode} mode.`,
  );
}

/**
 * The pixel rectangle one slot's attachment occupied in one render.
 *
 * **Integer pixel coordinates in the decoded PNG's coordinate system: `x`
 * rightward from the left edge, `y` downward from the top edge, both
 * bounds inclusive. `mask[y * width + x]` indexes the same pixel.**
 *
 * The page establishes that contract by flipping Y exactly once (the only
 * viewport projection in the pinned runtime, `OrthoCamera.worldToScreen`,
 * is bottom-left origin, while `decodePng` fills row-major from the first
 * scanline and is top-left origin). This module cannot re-derive it, which
 * is why the contract is written on both ends.
 */
export interface SlotBox {
  slot: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How changed pixels divided up between the slots that could own them. */
export interface PixelAttribution {
  perSlot: Array<{ slot: string; changedPixels: number }>;
  /**
   * Changed pixels inside no slot box. Reported rather than hidden: a
   * non-zero value is the honest signal that the attribution model missed
   * something — a clipping attachment, or an additive glow spilling
   * outside its quad.
   */
  unattributed: number;
}

/**
 * Credit each changed pixel to the slots whose box contains it.
 *
 * The boxes are read in the mask's own coordinate system (see
 * {@link SlotBox}): a pixel is inside a box when
 * `x0 <= x <= x1 && y0 <= y <= y1`, and `mask[y * width + x]` is that same
 * pixel.
 *
 * A pixel is credited to the **union** of the neutral and perturbed boxes,
 * because a limb that swings out of its old box and into a new one changes
 * pixels in both. A pixel inside two slots' boxes is credited to both:
 * overlap is real, and draw order — not this function — decides which one
 * the viewer sees.
 *
 * The boxes are axis-aligned bounds of a possibly rotated attachment, so
 * they are larger than the attachment and a slot that did not itself move
 * can be credited. That is a property of the model, not a defect in it;
 * {@link resolveReachableSlots} is what separates those entries from
 * measured movement.
 */
export function attributeChangedPixels(
  mask: { width: number; height: number; mask: Uint8Array },
  neutralBoxes: SlotBox[],
  perturbedBoxes: SlotBox[],
  slotOrder: string[],
): PixelAttribution {
  const union = new Map<string, SlotBox[]>();
  for (const box of [...neutralBoxes, ...perturbedBoxes]) {
    const list = union.get(box.slot);
    if (list === undefined) union.set(box.slot, [box]);
    else list.push(box);
  }

  const counts = new Map<string, number>();
  let unattributed = 0;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.mask[y * mask.width + x] !== 1) continue;
      let credited = false;
      for (const [slot, boxes] of union) {
        if (!boxes.some((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)) {
          continue;
        }
        counts.set(slot, (counts.get(slot) ?? 0) + 1);
        credited = true;
      }
      if (!credited) unattributed += 1;
    }
  }

  const drawIndex = new Map(slotOrder.map((slot, index) => [slot, index]));

  const perSlot = [...counts.entries()]
    .map(([slot, changedPixels]) => ({ slot, changedPixels }))
    // Descending changed pixels, then draw-order index, so ties are stable
    // and the strongest contributor reads first.
    .sort(
      (a, b) =>
        b.changedPixels - a.changedPixels ||
        (drawIndex.get(a.slot) ?? Number.MAX_SAFE_INTEGER) -
          (drawIndex.get(b.slot) ?? Number.MAX_SAFE_INTEGER) ||
        byCodeUnit(a.slot, b.slot),
    );

  return { perSlot, unattributed };
}

/**
 * Which slots a perturbation of one bone can structurally reach.
 *
 * {@link attributeChangedPixels} credits a changed pixel to every slot
 * whose axis-aligned bounding box contains it, and those boxes are larger
 * than the attachments they bound, so a slot that did not itself move is
 * credited whenever its box overlaps one that did. The skeleton data
 * states exactly which slots a bone can move, so the document flags those
 * entries rather than leaving a reader to tell them apart by eye.
 *
 * A slot is reachable from a bone when the slot's own bone IS that bone or
 * one of its descendants, or when a constraint carries the movement across
 * to it. Constraint propagation is included because an IK or transform
 * constraint genuinely moves bones outside the perturbed bone's subtree,
 * and calling that an overlap artefact would be the opposite error: moving
 * a constraint's target moves every bone it constrains, and their
 * subtrees. A path constraint propagates from the bone its target slot is
 * bound to; a physics constraint drives its own bone, which that bone's
 * own subtree already covers.
 *
 * Structural, never probed — the same reason `resolveConstraintsByBone`
 * reads the data rather than inferring from pixels. One entry per declared
 * bone; a bone with no entry is one this function could not resolve, and
 * no claim is made about it.
 */
export function resolveReachableSlots(
  boneParents: Record<string, string | null>,
  slotBones: Record<string, string | null>,
  constraints: ConstraintIndex,
): Map<string, Set<string>> {
  const children = new Map<string, string[]>();
  for (const [bone, parent] of Object.entries(boneParents)) {
    if (parent === null) continue;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [bone]);
    else list.push(bone);
  }

  // source bone -> bones a constraint makes follow it.
  const follows = new Map<string, string[]>();
  const link = (source: string | null, dependents: string[]): void => {
    if (source === null || dependents.length === 0) return;
    const list = follows.get(source);
    if (list === undefined) follows.set(source, [...dependents]);
    else list.push(...dependents);
  };
  for (const entry of constraints.ik) link(entry.target, entry.bones);
  for (const entry of constraints.transform) link(entry.target, entry.bones);
  for (const entry of constraints.path) link(entry.targetBone, entry.bones);

  const slotsOfBone = new Map<string, string[]>();
  for (const [slot, bone] of Object.entries(slotBones)) {
    if (bone === null) continue;
    const list = slotsOfBone.get(bone);
    if (list === undefined) slotsOfBone.set(bone, [slot]);
    else list.push(slot);
  }

  const reachable = new Map<string, Set<string>>();
  for (const bone of Object.keys(boneParents)) {
    const moved = new Set<string>();
    const queue = [bone];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      if (moved.has(current)) continue;
      moved.add(current);
      for (const child of children.get(current) ?? []) queue.push(child);
      for (const dependent of follows.get(current) ?? []) queue.push(dependent);
    }
    const slots = new Set<string>();
    for (const moving of moved) {
      for (const slot of slotsOfBone.get(moving) ?? []) slots.add(slot);
    }
    reachable.set(bone, slots);
  }
  return reachable;
}

/**
 * Which bucket a changed fraction falls in.
 *
 * The bucket, not the fraction, is what the prose and the dead-bone list
 * are built from: a bucket boundary is two orders of magnitude away from
 * rasteriser noise, so two machines with different GPUs can disagree in
 * the fourth decimal and still produce the same conclusions.
 */
export function bucketOf(changedFraction: number): InfluenceBucket {
  if (changedFraction === 0) return 'none';
  if (changedFraction < BUCKET_THRESHOLDS.slightFraction) return 'slight';
  if (changedFraction < BUCKET_THRESHOLDS.moderateFraction) return 'moderate';
  return 'strong';
}
