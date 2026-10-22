import {
  PROBE_AXES,
  SlotBox,
  attributeChangedPixels,
  bucketOf,
  planProbes,
  resolveReachableSlots,
} from '../../src/skeleton-probe';
import { resolveConstraintsByBone } from '../../src/skeleton-doc';
import { readBones, readSlots } from '../../src/skeleton-data';
import { SpineErrorCode } from '../../src/types';
import { RICH_SKELETON, clone } from '../helpers/fixtures';

/** Twelve bones, which is the rig size the cost model is documented with. */
const TWELVE = [
  'root',
  'hip',
  'torso',
  'chest',
  'neck',
  'head',
  'shoulder_left',
  'arm_left',
  'shoulder_right',
  'arm_right',
  'thigh_left',
  'thigh_right',
];

describe('planProbes', () => {
  it('plans one probe per bone in rotate mode', () => {
    const plan = planProbes(TWELVE, { probeMode: 'rotate', maxProbes: 256 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.plannedCount).toBe(12);
    expect(plan.data.axes).toEqual(['rotate']);
    expect(plan.data.targets).toHaveLength(12);
  });

  it('plans three probes per bone in full mode', () => {
    const plan = planProbes(TWELVE, { probeMode: 'full', maxProbes: 256 });
    expect(plan.ok && plan.data.plannedCount).toBe(36);
  });

  it('plans nothing at all in off mode', () => {
    const plan = planProbes(TWELVE, { probeMode: 'off', maxProbes: 256 });
    expect(plan.ok && plan.data.plannedCount).toBe(0);
    expect(plan.ok && plan.data.targets).toEqual([]);
    expect(PROBE_AXES.off).toEqual([]);
  });

  it('flattens the plan bone-major, with the axes in a fixed order', () => {
    const plan = planProbes(['a', 'b'], { probeMode: 'full', maxProbes: 256 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.targets).toEqual([
      { bone: 'a', axis: 'rotate' },
      { bone: 'a', axis: 'translateX' },
      { bone: 'a', axis: 'translateY' },
      { bone: 'b', axis: 'rotate' },
      { bone: 'b', axis: 'translateX' },
      { bone: 'b', axis: 'translateY' },
    ]);
  });

  it('filters to probeBones, in declaration order rather than the caller order', () => {
    const plan = planProbes(TWELVE, {
      probeMode: 'rotate',
      probeBones: ['head', 'hip'],
      maxProbes: 256,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.bones).toEqual(['hip', 'head']);
    expect(plan.data.plannedCount).toBe(2);
  });

  it('names the unknown probeBones entries and the real bones', () => {
    const plan = planProbes(TWELVE, {
      probeMode: 'rotate',
      probeBones: ['head', 'nope', 'also-nope'],
      maxProbes: 256,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe(SpineErrorCode.InvalidArgument);
    expect(plan.message).toContain('nope');
    expect(plan.message).toContain('also-nope');
    expect(plan.hint).toContain('head');
    expect(plan.hint).toContain('thigh_right');
  });

  it('refuses an over-cap plan, naming both the count and the cap', () => {
    const plan = planProbes(TWELVE, { probeMode: 'full', maxProbes: 8 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe(SpineErrorCode.InvalidArgument);
    expect(plan.message).toContain('36');
    expect(plan.message).toContain('8');
    // The three ways down, so a caller recovers in one extra call.
    expect(plan.hint).toContain('maxProbes');
    expect(plan.hint).toContain('probeBones');
    expect(plan.hint).toContain("'rotate'");
    expect(plan.hint).toContain('never silently truncated');
  });
});

/** A mask with the listed pixels marked changed. */
function maskOf(
  width: number,
  height: number,
  changed: Array<[number, number]>,
): { width: number; height: number; mask: Uint8Array } {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of changed) mask[y * width + x] = 1;
  return { width, height, mask };
}

function box(slot: string, x0: number, y0: number, x1: number, y1: number): SlotBox {
  return { slot, x0, y0, x1, y1 };
}

describe('attributeChangedPixels', () => {
  it('credits a pixel inside one box to that slot', () => {
    const result = attributeChangedPixels(
      maskOf(4, 4, [[1, 1]]),
      [box('a', 0, 0, 2, 2)],
      [box('a', 0, 0, 2, 2)],
      ['a'],
    );
    expect(result.perSlot).toEqual([{ slot: 'a', changedPixels: 1 }]);
    expect(result.unattributed).toBe(0);
  });

  it('credits a pixel inside two overlapping boxes to both slots', () => {
    const result = attributeChangedPixels(
      maskOf(4, 4, [[1, 1]]),
      [box('a', 0, 0, 2, 2), box('b', 1, 1, 3, 3)],
      [box('a', 0, 0, 2, 2), box('b', 1, 1, 3, 3)],
      ['a', 'b'],
    );
    expect(result.perSlot).toEqual([
      { slot: 'a', changedPixels: 1 },
      { slot: 'b', changedPixels: 1 },
    ]);
    expect(result.unattributed).toBe(0);
  });

  it('counts a pixel inside no box as unattributed rather than hiding it', () => {
    const result = attributeChangedPixels(
      maskOf(4, 4, [[3, 3]]),
      [box('a', 0, 0, 1, 1)],
      [box('a', 0, 0, 1, 1)],
      ['a'],
    );
    expect(result.perSlot).toEqual([]);
    expect(result.unattributed).toBe(1);
  });

  it('credits a pixel to the union of the neutral and perturbed boxes', () => {
    // The limb swung out of its old box and into a new one, so a pixel in
    // either one belongs to that slot.
    const result = attributeChangedPixels(
      maskOf(8, 8, [
        [0, 0],
        [7, 7],
      ]),
      [box('a', 0, 0, 1, 1)],
      [box('a', 6, 6, 7, 7)],
      ['a'],
    );
    expect(result.perSlot).toEqual([{ slot: 'a', changedPixels: 2 }]);
    expect(result.unattributed).toBe(0);
  });

  it('sorts by descending changed pixels, then by draw order', () => {
    const result = attributeChangedPixels(
      maskOf(4, 4, [
        [0, 0],
        [1, 0],
        [3, 3],
      ]),
      [box('front', 0, 0, 1, 0), box('back', 3, 3, 3, 3)],
      [box('front', 0, 0, 1, 0), box('back', 3, 3, 3, 3)],
      ['back', 'front'],
    );
    expect(result.perSlot.map((entry) => entry.slot)).toEqual(['front', 'back']);
  });

  it('breaks a tie on draw-order index, not on name', () => {
    const result = attributeChangedPixels(
      maskOf(4, 4, [
        [0, 0],
        [3, 3],
      ]),
      [box('zulu', 0, 0, 0, 0), box('alpha', 3, 3, 3, 3)],
      [box('zulu', 0, 0, 0, 0), box('alpha', 3, 3, 3, 3)],
      ['zulu', 'alpha'],
    );
    expect(result.perSlot.map((entry) => entry.slot)).toEqual(['zulu', 'alpha']);
  });
});

describe('resolveReachableSlots', () => {
  // RICH_SKELETON is the rig to ask this of: `head` and `leg-left` sit in
  // disjoint subtrees (chest -> neck -> head versus hip -> leg-left), and
  // `leg-left` is IK-driven by `ik-target`, which is parented straight to
  // the root. So it has both a structural answer and a constraint one.
  const root = clone(RICH_SKELETON) as Record<string, unknown>;
  const bones = readBones(root);
  const slots = readSlots(root, new Set(bones.names));
  const reachable = resolveReachableSlots(
    bones.parents,
    slots.bones,
    resolveConstraintsByBone(root),
  );
  const from = (bone: string): string[] => [...(reachable.get(bone) ?? [])].sort();

  it('reaches the slots of the bone itself and of its descendants', () => {
    expect(from('head')).toEqual(['head']);
    expect(from('chest')).toEqual(['glow', 'head']);
    expect(from('root')).toEqual([
      'glow',
      'head',
      'hitbox',
      'leg-left',
      'shadow',
      'torso',
    ]);
  });

  it('does not reach a slot in a disjoint subtree', () => {
    expect(from('leg-left')).not.toContain('head');
    expect(from('head')).not.toContain('leg-left');
  });

  it('follows an IK constraint from its target to the bones it constrains', () => {
    // `ik-target` is a leaf under the root, so without the constraint it
    // would reach nothing at all.
    expect(from('ik-target')).toEqual(['leg-left']);
  });

  it('makes no claim about a bone it was not given', () => {
    expect(reachable.has('nonexistent')).toBe(false);
    expect(reachable.get('nonexistent')).toBeUndefined();
  });

  it('terminates on a cyclic parent chain', () => {
    const cyclic = resolveReachableSlots(
      { a: 'b', b: 'a' },
      { only: 'a' },
      resolveConstraintsByBone({}),
    );
    expect([...(cyclic.get('a') ?? [])]).toEqual(['only']);
    expect([...(cyclic.get('b') ?? [])]).toEqual(['only']);
  });
});

describe('bucketOf', () => {
  it('calls exactly zero "none"', () => {
    expect(bucketOf(0)).toBe('none');
  });

  it('puts anything below 0.005 in "slight"', () => {
    expect(bucketOf(0.0001)).toBe('slight');
    expect(bucketOf(0.00499)).toBe('slight');
  });

  it('treats the 0.005 boundary itself as "moderate"', () => {
    expect(bucketOf(0.005)).toBe('moderate');
    expect(bucketOf(0.0499)).toBe('moderate');
  });

  it('treats the 0.05 boundary itself as "strong"', () => {
    expect(bucketOf(0.05)).toBe('strong');
    expect(bucketOf(0.9)).toBe('strong');
  });
});
