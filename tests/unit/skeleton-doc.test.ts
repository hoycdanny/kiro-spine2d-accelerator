/**
 * Correctness proofs for the document core.
 *
 * These are not smoke tests: every case pins a number, a name or a sorted
 * list that the committed `.spine-doc.json` and `.spine-doc.md` are built
 * from. Nothing here launches a browser, which is the point — three of the
 * document's four sections must work with Chromium absent, so they are
 * tested with the influence section explicitly unavailable.
 */
import { CHROMIUM_LAUNCH_ARGS } from '../../src/preview-renderer';
import {
  AnimationDoc,
  BoneDoc,
  InfluenceDoc,
  SkeletonDocument,
  buildDocument,
  compareStaleness,
  escapeCell,
  fingerprintSkeleton,
  readBoneGeometry,
  renderDocumentMarkdown,
  resolveConstraintsByBone,
} from '../../src/skeleton-doc';
import {
  BROKEN_SKELETON,
  LOOPABLE_SKELETON,
  RICH_SKELETON,
  clone,
} from '../helpers/fixtures';

type Json = Record<string, unknown>;

/**
 * The influence section with the probe deliberately off.
 *
 * AC-7 is exercised this way on purpose: constraint following is read from
 * the data and must work with no renderer at all.
 */
const PROBE_OFF: InfluenceDoc = {
  available: false,
  reason: "Not measured: probeMode was 'off'.",
  mode: 'off',
  canvas: null,
  perturbation: { rotationDegrees: 20, translateFraction: 0.05, translateUnits: 0 },
  thresholds: { channelTolerance: 4, slightFraction: 0.005, moderateFraction: 0.05 },
  probesPlanned: 0,
  probesPerformed: 0,
  environment: { launchArgs: [...CHROMIUM_LAUNCH_ARGS], useGl: null },
  framing: null,
  warnings: [],
  bones: [],
};

function documentOf(root: unknown, generatedAt = '2025-01-01T00:00:00.000Z'): SkeletonDocument {
  return buildDocument({
    root: root as Json,
    skeletonFile: 'C:\\work\\project\\out\\hero.json',
    atlasFile: null,
    generatedAt,
    influence: PROBE_OFF,
  });
}

function boneOf(document: SkeletonDocument, name: string): BoneDoc {
  const bone = document.hierarchy.bones.find((entry) => entry.name === name);
  if (bone === undefined) throw new Error(`no bone named ${name} in the document`);
  return bone;
}

function animationOf(document: SkeletonDocument, name: string): AnimationDoc {
  const animation = document.animations.find((entry) => entry.name === name);
  if (animation === undefined) throw new Error(`no animation named ${name}`);
  return animation;
}

// ------------------------------------------------------------
// Section 1 — defaults, world transforms, broken hierarchies
// ------------------------------------------------------------

describe('readBoneGeometry defaults', () => {
  const geometry = readBoneGeometry({
    bones: [{ name: 'root' }, { name: 'bare', parent: 'root' }],
  });

  it('records an omitted scaleX as 1, not as 0 or absent', () => {
    const bare = geometry.bones.find((bone) => bone.name === 'bare')!;
    expect(bare.local.scaleX).toBe(1);
    expect(bare.local.scaleY).toBe(1);
    expect(bare.local.length).toBe(0);
    expect(bare.local.rotation).toBe(0);
    expect(bare.local.shearX).toBe(0);
  });

  it('records no inheritance key at all as "normal", honoured', () => {
    const bare = geometry.bones.find((bone) => bone.name === 'bare')!;
    expect(bare.mode).toEqual({
      value: 'normal',
      declaredKey: null,
      runtimeHonoursIt: true,
    });
  });
});

describe('derived world transforms', () => {
  // root -> a (x 10, rotated 90) -> b (x 10). Hand-computed: b's local x
  // runs along a's rotated axis, so it lands 10 units ABOVE a, not beside.
  const chain = readBoneGeometry({
    bones: [
      { name: 'root' },
      { name: 'a', parent: 'root', x: 10, rotation: 90 },
      { name: 'b', parent: 'a', x: 10 },
    ],
  });
  const at = (name: string) => chain.bones.find((bone) => bone.name === name)!;

  it('leaves a root bone world transform equal to its local one', () => {
    expect(at('root').world).toEqual({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    expect(at('root').depth).toBe(1);
  });

  it('composes position, rotation and depth parent-first down the chain', () => {
    expect(at('a').world).toEqual({ x: 10, y: 0, rotation: 90, scaleX: 1, scaleY: 1 });
    expect(at('a').depth).toBe(2);
    expect(at('b').world).toEqual({ x: 10, y: 10, rotation: 90, scaleX: 1, scaleY: 1 });
    expect(at('b').depth).toBe(3);
  });

  // parent is rotated 90 and scaled 2; three children declare the same
  // local transform and differ only in their inheritance mode.
  const modes = readBoneGeometry({
    bones: [
      { name: 'root' },
      { name: 'parent', parent: 'root', x: 5, rotation: 90, scaleX: 2, scaleY: 2 },
      { name: 'normal', parent: 'parent', rotation: 10, scaleX: 3, scaleY: 3 },
      {
        name: 'noscale',
        parent: 'parent',
        rotation: 10,
        scaleX: 3,
        scaleY: 3,
        inherit: 'NoScale',
      },
      {
        name: 'onlytrans',
        parent: 'parent',
        rotation: 10,
        scaleX: 3,
        scaleY: 3,
        inherit: 'OnlyTranslation',
      },
    ],
  });
  const mode = (name: string) => modes.bones.find((bone) => bone.name === name)!;

  it('inherits both rotation and scale under the default mode', () => {
    expect(mode('normal').world).toEqual({
      x: 5,
      y: 0,
      rotation: 100,
      scaleX: 6,
      scaleY: 6,
    });
  });

  it('suppresses inherited scale under noScale', () => {
    expect(mode('noscale').world.scaleX).toBe(3);
    expect(mode('noscale').world.scaleY).toBe(3);
    // Rotation still composes.
    expect(mode('noscale').world.rotation).toBe(100);
    expect(mode('noscale').mode.value).toBe('noScale');
  });

  it('suppresses inherited rotation and scale under onlyTranslation', () => {
    expect(mode('onlytrans').world.rotation).toBe(10);
    expect(mode('onlytrans').world.scaleX).toBe(3);
    expect(mode('onlytrans').mode.value).toBe('onlyTranslation');
  });
});

describe('a cyclic parent chain', () => {
  // `readBones` breaks this with a guard set but never records which bones
  // it broke, so the document runs the walk itself.
  const root = {
    bones: [{ name: 'root' }, { name: 'a', parent: 'b' }, { name: 'b', parent: 'a' }],
  };

  it('does not hang, and names both bones in the cycle', () => {
    const geometry = readBoneGeometry(root);
    expect(geometry.cyclicBones).toEqual(['a', 'b']);
  });

  it('anchors every cyclic bone at depth 1 with world equal to local', () => {
    const document = documentOf(root);
    expect(document.defects.cyclicBones).toEqual(['a', 'b']);
    for (const name of ['a', 'b']) {
      const bone = boneOf(document, name);
      expect(bone.depth).toBe(1);
      expect(bone.world.x).toBe(bone.local.x);
      expect(bone.world.rotation).toBe(bone.local.rotation);
    }
  });

  it('prints a cyclic bone at top level with a (cycle) marker', () => {
    const markdown = renderDocumentMarkdown(documentOf(root));
    expect(markdown).toContain('a (cycle)');
    expect(markdown).toContain('b (cycle)');
  });
});

describe('the legacy inheritance key', () => {
  const root = {
    bones: [
      { name: 'root' },
      { name: 'legacy', parent: 'root', transform: 'noScale' },
      { name: 'harmless', parent: 'root', transform: 'normal' },
      { name: 'modern', parent: 'root', inherit: 'NoScale' },
    ],
  };
  const document = documentOf(root);

  it('reads the value but reports that 4.2 ignores it', () => {
    expect(boneOf(document, 'legacy').mode).toEqual({
      value: 'noScale',
      declaredKey: 'transform',
      runtimeHonoursIt: false,
    });
  });

  it('records the mismatch in the exact pinned format', () => {
    expect(document.defects.boneModeKeyMismatches).toEqual(['legacy:transform=noScale']);
  });

  it('does not report a legacy key whose value is the default anyway', () => {
    expect(document.defects.boneModeKeyMismatches).not.toContain(
      'harmless:transform=normal',
    );
  });

  it('honours the modern key', () => {
    expect(boneOf(document, 'modern').mode).toEqual({
      value: 'noScale',
      declaredKey: 'inherit',
      runtimeHonoursIt: true,
    });
  });

  it('fires the conditional note about the legacy key', () => {
    expect(document.notes.some((note) => note.includes('reads only inherit'))).toBe(true);
  });
});

describe("BROKEN_SKELETON's detached root", () => {
  const document = documentOf(BROKEN_SKELETON);
  const orphan = boneOf(document, 'orphan');

  it('keeps the declared, missing parent name rather than nulling it', () => {
    expect(orphan.parent).toBe('ghost');
  });

  it('treats it as its own anchor: world equals local, depth 1', () => {
    expect(orphan.depth).toBe(1);
    expect(orphan.world).toEqual({
      x: orphan.local.x,
      y: orphan.local.y,
      rotation: orphan.local.rotation,
      scaleX: orphan.local.scaleX,
      scaleY: orphan.local.scaleY,
    });
  });

  it('does not count it as a root, in either the list or the number', () => {
    expect(document.hierarchy.roots).not.toContain('orphan');
    expect(document.hierarchy.roots).toEqual(['root', 'SecondRoot']);
    expect(document.summary.rootCount).toBe(2);
    expect(document.defects.missingParents).toEqual(['ghost']);
  });

  it('prints it at top level with its missing parent named', () => {
    expect(renderDocumentMarkdown(document)).toContain('orphan (missing parent: ghost)');
  });

  it('reports the multiple-root defect with the count', () => {
    expect(document.defects.multipleRoots).toBe(true);
    expect(document.defects.rootCount).toBe(2);
  });
});

// ------------------------------------------------------------
// Section 2b — constraints, with the probe off
// ------------------------------------------------------------

describe('resolveConstraintsByBone, with the probe off', () => {
  const document = documentOf(RICH_SKELETON);
  const constraints = document.constraints;

  it('is reached at all without a renderer', () => {
    expect(document.influence.available).toBe(false);
    expect(document.summary.constraintCount).toBe(4);
  });

  it("resolves RICH_SKELETON's IK against its bone, with target and mix", () => {
    // AC-7 names an IK constraint over `forearm_left`, which no fixture
    // has; `leg-left-ik` over `leg-left` exercises the same behaviour and
    // the substitution is deliberate.
    expect(constraints.ik).toEqual([
      {
        name: 'leg-left-ik',
        order: 0,
        skin: false,
        bones: ['leg-left'],
        target: 'ik-target',
        mix: 1,
        softness: 0,
        bendPositive: true,
        compress: false,
        stretch: false,
        uniform: false,
      },
    ]);
    expect(constraints.byBone['leg-left']).toEqual([
      {
        kind: 'ik',
        name: 'leg-left-ik',
        role: 'constrained',
        targetSlot: null,
        targetBone: null,
      },
    ]);
    expect(constraints.byBone['ik-target']).toEqual([
      {
        kind: 'ik',
        name: 'leg-left-ik',
        role: 'target',
        targetSlot: null,
        targetBone: null,
      },
    ]);
  });

  it('indexes the transform constraint against both bones it names', () => {
    expect(constraints.byBone['head']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'transform', name: 'head-follow', role: 'constrained' }),
      ]),
    );
    expect(constraints.byBone['chest']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'transform', name: 'head-follow', role: 'target' }),
      ]),
    );
    expect(constraints.transform[0]?.mixRotate).toBe(0.5);
  });

  it('resolves a path target that is not a declared slot as dangling', () => {
    // RICH_SKELETON's `walk-path` targets `path-slot`, which appears only
    // as a key under `skins[0].attachments` and is never a declared slot.
    expect(constraints.path[0]?.target).toBe('path-slot');
    expect(constraints.path[0]?.targetBone).toBeNull();
    expect(document.defects.danglingPathTargets).toEqual(['walk-path:path-slot']);
    // And it is NOT a dangling *bone* reference, which is a different list.
    expect(document.defects.danglingConstraintRefs).toEqual([]);
    // No `role: 'target'` entry exists anywhere for it.
    const targets = Object.values(constraints.byBone)
      .flat()
      .filter((ref) => ref.kind === 'path' && ref.role === 'target');
    expect(targets).toEqual([]);
  });

  it('fires the conditional note about the dangling path target', () => {
    expect(
      document.notes.some((note) => note.includes('defects.danglingPathTargets')),
    ).toBe(true);
  });

  it('resolves a declared path target slot to its bone', () => {
    const fixed = clone(RICH_SKELETON) as unknown as Json;
    (fixed['slots'] as Json[]).push({ name: 'path-slot', bone: 'arm-left' });
    const index = resolveConstraintsByBone(fixed);
    expect(index.path[0]?.targetBone).toBe('arm-left');
    expect(index.danglingPathTargets).toEqual([]);
    expect(index.byBone['arm-left']).toEqual(
      expect.arrayContaining([
        {
          kind: 'path',
          name: 'walk-path',
          role: 'target',
          targetSlot: 'path-slot',
          targetBone: 'arm-left',
        },
      ]),
    );
  });

  it('indexes the physics constraint against its single bone', () => {
    expect(constraints.physics[0]).toMatchObject({
      name: 'hair-physics',
      bone: 'head',
      inertia: 0.8,
    });
  });

  it('sorts the entries for one bone by order, then kind, then name', () => {
    // `head` carries the transform constraint (order 1) and the physics
    // one (order 3), in that order.
    expect(constraints.byBone['head']?.map((ref) => ref.name)).toEqual([
      'head-follow',
      'hair-physics',
    ]);
  });

  it('reports a constraint naming an undeclared bone rather than dropping it', () => {
    const broken = clone(RICH_SKELETON) as unknown as Json;
    (broken['ik'] as Json[])[0]!['bones'] = ['nope'];
    const index = resolveConstraintsByBone(broken);
    expect(index.danglingConstraintRefs).toEqual(['leg-left-ik:nope']);
    expect(index.ik[0]?.bones).toEqual(['nope']);
  });
});

// ------------------------------------------------------------
// Section 3 — motion profile
// ------------------------------------------------------------

describe('loopability', () => {
  it('pins RICH_SKELETON.walk at exactly three disagreeing timelines', () => {
    // hip.translate goes (0,0) -> (0,0) and agrees; hip.rotate goes
    // 0 -> 15; leg-left.rotate goes 0 -> -30; slots.head.attachment goes
    // 'head' -> null. The identifier is a path, not a dotted pair, because
    // this fixture declares both a bone and a slot named `head`.
    const walk = animationOf(documentOf(RICH_SKELETON), 'walk');
    expect(walk.loopable.value).toBe(false);
    expect(walk.loopable.mismatches).toEqual([
      'bones/hip/rotate',
      'bones/leg-left/rotate',
      'slots/head/attachment',
    ]);
  });

  it('pins RICH_SKELETON.idle at its single disagreeing timeline', () => {
    const idle = animationOf(documentOf(RICH_SKELETON), 'idle');
    expect(idle.loopable.value).toBe(false);
    expect(idle.loopable.mismatches).toEqual(['bones/head/rotate']);
  });

  it('reports LOOPABLE_SKELETON.breathe as loopable with no mismatches at all', () => {
    const breathe = animationOf(documentOf(LOOPABLE_SKELETON), 'breathe');
    expect(breathe.loopable.value).toBe(true);
    expect(breathe.loopable.mismatches).toEqual([]);
  });

  it('always says the answer is inferred, with the method stated', () => {
    for (const document of [documentOf(RICH_SKELETON), documentOf(LOOPABLE_SKELETON)]) {
      for (const animation of document.animations) {
        expect(animation.loopable.inferred).toBe(true);
        expect(animation.loopable.method.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports a generator intent separately from the heuristic', () => {
    const generated = clone(LOOPABLE_SKELETON) as unknown as Json;
    generated['_generator'] = {
      templates: [{ animation: 'breathe', intendedLoop: false }],
    };
    const breathe = animationOf(documentOf(generated), 'breathe');
    // Both statements are true and they disagree, which is the point.
    expect(breathe.loopable.value).toBe(true);
    expect(breathe.generatorIntendedLoop).toBe(false);
  });

  it('reports no generator intent when the file records none', () => {
    expect(animationOf(documentOf(LOOPABLE_SKELETON), 'breathe').generatorIntendedLoop)
      .toBeNull();
  });
});

describe('root motion', () => {
  const rootOnly = (animation: Json) => ({
    skeleton: { hash: 'motion', spine: '4.2.37' },
    bones: [{ name: 'root' }],
    animations: animation,
  });

  it('reads a translate-keyed root as travelling', () => {
    const document = documentOf(
      rootOnly({
        walk: {
          bones: {
            root: {
              translate: [
                { time: 0, x: 0, y: 0 },
                { time: 1, x: 12, y: 3 },
              ],
            },
          },
        },
      }),
    );
    expect(animationOf(document, 'walk').rootMotion).toEqual({
      bone: 'root',
      netTranslate: { x: 12, y: 3 },
      locomotive: true,
    });
  });

  it('reads a translatex-keyed root, which the two-value shape would miss', () => {
    const document = documentOf(
      rootOnly({
        slide: {
          bones: {
            root: {
              translatex: [
                { time: 0, value: 0 },
                { time: 1, value: 8 },
              ],
            },
          },
        },
      }),
    );
    expect(animationOf(document, 'slide').rootMotion).toEqual({
      bone: 'root',
      netTranslate: { x: 8, y: 0 },
      locomotive: true,
    });
  });

  it('reads a cycle that returns to its start as in place, not travelling', () => {
    const document = documentOf(
      rootOnly({
        march: {
          bones: {
            root: {
              translate: [
                { time: 0, x: 0, y: 0 },
                { time: 0.5, x: 10, y: 0 },
                { time: 1, x: 0, y: 0 },
              ],
            },
          },
        },
      }),
    );
    expect(animationOf(document, 'march').rootMotion.locomotive).toBe(false);
    expect(animationOf(document, 'march').rootMotion.netTranslate).toEqual({ x: 0, y: 0 });
  });

  it('reports no root bone at all when the rig has more than one', () => {
    const document = documentOf(BROKEN_SKELETON);
    expect(animationOf(document, 'Walk').rootMotion.bone).toBeNull();
    expect(animationOf(document, 'Walk').rootMotion.locomotive).toBe(false);
  });
});

describe('event and attachment keyframes', () => {
  const walk = animationOf(documentOf(RICH_SKELETON), 'walk');

  it('lists every event keyframe with its name and time', () => {
    expect(walk.events).toEqual([
      { name: 'footstep', time: 0.1, int: 1, float: null, string: null },
      { name: 'footstep', time: 0.6, int: 2, float: null, string: null },
    ]);
    expect(walk.eventsTruncated).toBe(0);
  });

  it('lists attachment switches, with null meaning hide', () => {
    expect(walk.attachmentSwitches).toEqual([
      { slot: 'head', time: 0, to: 'head' },
      { slot: 'head', time: 0.75, to: null },
    ]);
  });

  it('reports an event keyframe the root events section never declares', () => {
    const root = clone(RICH_SKELETON) as unknown as Json;
    const animations = root['animations'] as Json;
    const walkAnimation = animations['walk'] as Json;
    (walkAnimation['events'] as Json[]).push({ time: 0.9, name: 'ghost-event' });
    expect(documentOf(root).defects.undeclaredEventRefs).toEqual(['walk:ghost-event']);
  });

  it('caps both lists and reports the overflow as a count', () => {
    const root = clone(RICH_SKELETON) as unknown as Json;
    const animations = root['animations'] as Json;
    const walkAnimation = animations['walk'] as Json;
    walkAnimation['events'] = Array.from({ length: 200 }, (_, index) => ({
      time: index / 100,
      name: 'footstep',
    }));
    const long = animationOf(documentOf(root), 'walk');
    expect(long.events).toHaveLength(64);
    expect(long.eventsTruncated).toBe(136);
    // Time order, so the retained entries are the start of the animation.
    expect(long.events[0]?.time).toBe(0);
    expect(long.events[63]?.time).toBe(0.63);
  });

  it('states the activity measure in words, and ranks by it', () => {
    expect(walk.activityMeasure).toContain('divided by 10');
    expect(walk.mostActiveBones.length).toBeGreaterThan(0);
    expect(walk.mostActiveBones[0]?.bone).toBe('leg-left');
  });
});

// ------------------------------------------------------------
// Staleness
// ------------------------------------------------------------

/** Re-serialise with every object's keys in reverse order. */
function shuffleKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => shuffleKeys(entry));
  if (value !== null && typeof value === 'object') {
    const source = value as Json;
    const out: Json = {};
    for (const key of Object.keys(source).reverse()) out[key] = shuffleKeys(source[key]);
    return out;
  }
  return value;
}

describe('fingerprintSkeleton', () => {
  it('differs for two files with one hash and different animations', () => {
    const before = clone(RICH_SKELETON) as unknown as Json;
    const after = clone(RICH_SKELETON) as unknown as Json;
    (after['animations'] as Json)['extra'] = {
      bones: { hip: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 5 }] } },
    };

    // The precondition this test exists for: the editor hash is identical.
    expect((before['skeleton'] as Json)['hash']).toBe((after['skeleton'] as Json)['hash']);
    expect(fingerprintSkeleton(before)).not.toBe(fingerprintSkeleton(after));
  });

  it('matches for the same data re-serialised with shuffled keys', () => {
    const original = clone(RICH_SKELETON) as unknown as Json;
    expect(fingerprintSkeleton(shuffleKeys(original) as Json)).toBe(
      fingerprintSkeleton(original),
    );
  });

  it('ignores skeleton.hash, images, audio, fps and _generator', () => {
    const original = clone(RICH_SKELETON) as unknown as Json;
    const noisy = clone(RICH_SKELETON) as unknown as Json;
    const meta = noisy['skeleton'] as Json;
    meta['hash'] = 'something-else-entirely';
    meta['images'] = './elsewhere/';
    meta['audio'] = './other-audio/';
    meta['fps'] = 60;
    noisy['_generator'] = { tool: 'anything' };
    expect(fingerprintSkeleton(noisy)).toBe(fingerprintSkeleton(original));
  });

  it('is 24 hex characters', () => {
    expect(fingerprintSkeleton(RICH_SKELETON as unknown as Json)).toMatch(
      /^[0-9a-f]{24}$/,
    );
  });
});

describe('compareStaleness', () => {
  const current = { skeletonHash: 'h1', fingerprint: 'f1' };

  it('reports no previous document as absent', () => {
    expect(compareStaleness(null, current)).toBe('absent');
    expect(compareStaleness({ skeletonHash: 'h1', fingerprint: null }, current)).toBe(
      'absent',
    );
  });

  it('reports an unchanged pair as fresh', () => {
    expect(compareStaleness({ skeletonHash: 'h1', fingerprint: 'f1' }, current)).toBe(
      'fresh',
    );
  });

  it('reports a changed hash alone', () => {
    expect(compareStaleness({ skeletonHash: 'h0', fingerprint: 'f1' }, current)).toBe(
      'hashChanged',
    );
  });

  it('reports a changed fingerprint alone, which is the two-files-one-hash case', () => {
    expect(compareStaleness({ skeletonHash: 'h1', fingerprint: 'f0' }, current)).toBe(
      'fingerprintChanged',
    );
  });

  it('reports both when both moved', () => {
    expect(compareStaleness({ skeletonHash: 'h0', fingerprint: 'f0' }, current)).toBe(
      'both',
    );
  });
});

// ------------------------------------------------------------
// Markdown
// ------------------------------------------------------------

describe('renderDocumentMarkdown', () => {
  it('is byte-identical for the same document rendered twice', () => {
    const document = documentOf(RICH_SKELETON);
    expect(renderDocumentMarkdown(document)).toBe(renderDocumentMarkdown(document));
  });

  it('carries no timestamp, so two runs differ only in the JSON', () => {
    const first = documentOf(RICH_SKELETON, '2025-01-01T00:00:00.000Z');
    const second = documentOf(RICH_SKELETON, '2030-06-30T12:34:56.789Z');
    expect(renderDocumentMarkdown(first)).toBe(renderDocumentMarkdown(second));
    expect(first.generatedAt).not.toBe(second.generatedAt);
  });

  it('escapes a hostile bone name so it cannot break a table row', () => {
    const document = documentOf({
      skeleton: { hash: 'hostile', spine: '4.2.37' },
      bones: [{ name: 'root' }, { name: 'a|b`c', parent: 'root' }],
    });
    const markdown = renderDocumentMarkdown(document);
    expect(escapeCell('a|b`c')).toBe('a\\|b\\`c');
    expect(markdown).toContain('a\\|b\\`c');
    // The raw pipe never reaches a cell, so the column count is intact.
    const row = markdown
      .split('\n')
      .find((line) => line.startsWith('| `a\\|b\\`c`'))!;
    expect(row.split(' | ')).toHaveLength(14);
  });

  it('flattens a newline in a name rather than splitting the row', () => {
    expect(escapeCell('a\nb')).toBe('a b');
  });

  it('omits the dead-bone claim entirely when nothing was measured', () => {
    const markdown = renderDocumentMarkdown(documentOf(RICH_SKELETON));
    // No claim line at all. The only place the phrase appears is note 12,
    // which exists to say that nobody looked.
    expect(markdown).not.toContain('Bones with no visible effect:');
    expect(markdown).toContain("Not measured: probeMode was 'off'.");
    expect(markdown).toContain('No bone in this document is claimed to have no visible effect');
  });

  it('says "None found." rather than printing an empty defect table', () => {
    const markdown = renderDocumentMarkdown(documentOf(LOOPABLE_SKELETON));
    expect(markdown).toContain('## Defects\nNone found.');
  });

  it('never prints "loops" without saying it is inferred', () => {
    const markdown = renderDocumentMarkdown(documentOf(LOOPABLE_SKELETON));
    expect(markdown).toContain('loops (inferred)');
  });
});

describe('the document as a whole', () => {
  const document = documentOf(RICH_SKELETON);

  it('carries all twelve defect fields in every document, empty or not', () => {
    expect(Object.keys(document.defects)).toEqual([
      'multipleRoots',
      'rootCount',
      'missingParents',
      'cyclicBones',
      'duplicateBoneNames',
      'duplicateSlotNames',
      'danglingSlotBones',
      'slotsWithoutAttachments',
      'boneModeKeyMismatches',
      'danglingConstraintRefs',
      'danglingPathTargets',
      'undeclaredEventRefs',
    ]);
  });

  it('puts the top-level keys in the normative order', () => {
    expect(Object.keys(document)).toEqual([
      'schema',
      'kind',
      'generatedAt',
      'generator',
      'source',
      'summary',
      'defects',
      'hierarchy',
      'constraints',
      'influence',
      'animations',
      'notes',
    ]);
  });

  it('lists every declared bone as unprobed when nothing was measured', () => {
    expect(document.summary.unprobedBones).toHaveLength(document.summary.boneCount);
    expect(document.summary.deadBones).toEqual([]);
    expect(document.hierarchy.bones.every((bone) => bone.probe === null)).toBe(true);
  });

  it('sorts animations the way skeleton_inspect does', () => {
    expect(document.animations.map((animation) => animation.name)).toEqual([
      'empty',
      'idle',
      'walk',
    ]);
  });

  it('binds slots to their bones in draw order', () => {
    expect(boneOf(document, 'root').slots).toEqual(['shadow']);
    expect(boneOf(document, 'head').slots).toEqual(['head']);
  });

  it('carries the ten unconditional notes plus whichever conditionals fired', () => {
    expect(document.notes.length).toBeGreaterThanOrEqual(10);
    expect(document.notes[0]).toContain('affinely in Node');
    expect(document.notes[9]).toContain('64 keyframes');
  });

  it('counts the weighted mesh RICH_SKELETON declares', () => {
    expect(document.summary.weightedMeshCount).toBe(1);
  });
});
