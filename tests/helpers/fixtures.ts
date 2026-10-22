/**
 * Synthetic fixtures.
 *
 * Everything here is generated, not copied from Spine's example assets:
 * the bundled spineboy project is licensed for evaluation with Spine, not
 * for redistribution in this repository.
 */

/** The smallest thing that still counts as skeleton data. */
export const MINIMAL_SKELETON = {
  skeleton: { hash: 'minimalhash', spine: '4.2.37' },
  bones: [{ name: 'root' }],
};

/**
 * A skeleton exercising every section: hierarchy, slots with blend modes,
 * two skins, each attachment type, all four constraint kinds, events, and
 * animations with bone/slot/deform/event/draw-order timelines.
 */
export const RICH_SKELETON = {
  skeleton: {
    hash: 'Qq9tZ1example',
    spine: '4.2.37',
    x: -100.5,
    y: -10,
    width: 400,
    height: 700,
    fps: 30,
    images: './images/',
    audio: './audio/',
  },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', length: 0, x: 0, y: 220 },
    { name: 'torso', parent: 'hip', length: 80, rotation: 90 },
    { name: 'chest', parent: 'torso', length: 60 },
    { name: 'neck', parent: 'chest', length: 20 },
    { name: 'head', parent: 'neck', length: 90, color: 'ff0000ff' },
    { name: 'arm-left', parent: 'chest', length: 70 },
    { name: 'leg-left', parent: 'hip', length: 100 },
    { name: 'ik-target', parent: 'root', x: 50 },
  ],
  slots: [
    { name: 'leg-left', bone: 'leg-left', attachment: 'leg-left' },
    { name: 'torso', bone: 'torso', attachment: 'torso' },
    { name: 'head', bone: 'head', attachment: 'head' },
    { name: 'glow', bone: 'chest', attachment: 'glow', blend: 'additive' },
    { name: 'shadow', bone: 'root', blend: 'multiply' },
    { name: 'hitbox', bone: 'hip' },
  ],
  ik: [{ name: 'leg-left-ik', order: 0, bones: ['leg-left'], target: 'ik-target' }],
  transform: [
    { name: 'head-follow', order: 1, bones: ['head'], target: 'chest', mixRotate: 0.5 },
  ],
  path: [
    {
      name: 'walk-path',
      order: 2,
      bones: ['arm-left'],
      target: 'path-slot',
      positionMode: 'percent',
    },
  ],
  physics: [{ name: 'hair-physics', order: 3, bone: 'head', inertia: 0.8 }],
  events: {
    footstep: { int: 1, float: 0.5, string: 'left' },
    swing: { audio: 'swing.wav', volume: 0.9, balance: -0.25 },
  },
  skins: [
    {
      name: 'default',
      attachments: {
        'leg-left': {
          'leg-left': { x: 10, y: 20, width: 64, height: 128 },
        },
        torso: {
          torso: {
            type: 'mesh',
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 2, 3, 0],
            vertices: [0, 0, 50, 0, 50, 90, 0, 90],
            hull: 4,
            edges: [0, 2, 2, 4],
            width: 50,
            height: 90,
          },
        },
        head: {
          head: {
            type: 'mesh',
            // Weighted: vertices is longer than uvs, because each vertex
            // carries bone index, bind position and weight.
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 2, 3, 0],
            vertices: [
              1, 5, 0, 0, 1, 1, 5, 40, 0, 1, 1, 5, 40, 40, 1, 1, 5, 0, 40, 1,
            ],
            hull: 4,
          },
        },
        glow: {
          glow: { path: 'fx/glow', width: 32, height: 32 },
        },
        hitbox: {
          hitbox: { type: 'boundingbox', vertexCount: 4, vertices: [0, 0, 10, 0, 10, 10, 0, 10] },
        },
        'path-slot': {
          'walk-path': { type: 'path', vertexCount: 4, vertices: [0, 0, 1, 1, 2, 2, 3, 3] },
        },
        muzzle: {
          muzzle: { type: 'point', x: 5, y: 6, rotation: 45 },
        },
        clip: {
          clip: { type: 'clipping', end: 'head', vertexCount: 4, vertices: [0, 0, 1, 0, 1, 1, 0, 1] },
        },
      },
    },
    {
      name: 'blue',
      attachments: {
        head: {
          head: { type: 'linkedmesh', parent: 'head', skin: 'default', path: 'blue/head' },
        },
        torso: {
          torso: { name: 'blue/torso', width: 50, height: 90 },
        },
      },
    },
  ],
  animations: {
    walk: {
      bones: {
        hip: {
          translate: [
            { time: 0, x: 0, y: 0 },
            { time: 0.5, x: 10, y: 4, curve: 'stepped' },
            { time: 1, x: 0, y: 0 },
          ],
          rotate: [
            { time: 0, value: 0 },
            { time: 1, value: 15 },
          ],
        },
        'leg-left': {
          rotate: [
            { time: 0, value: 0 },
            { time: 0.25, value: -30 },
          ],
        },
      },
      slots: {
        head: {
          attachment: [
            { time: 0, name: 'head' },
            { time: 0.75, name: null },
          ],
        },
      },
      deform: {
        default: {
          torso: {
            torso: [
              { time: 0, curve: [0.25, 0, 0.75, 1] },
              { time: 1.25, offset: 2, vertices: [1, 2, 3, 4] },
            ],
          },
        },
      },
      events: [
        { time: 0.1, name: 'footstep', int: 1 },
        { time: 0.6, name: 'footstep', int: 2 },
      ],
      drawOrder: [{ time: 0.3, offsets: [{ slot: 'glow', offset: 1 }] }],
      ik: {
        'leg-left-ik': [{ time: 0, mix: 1 }],
      },
    },
    idle: {
      bones: {
        head: {
          rotate: [
            { time: 0, value: 0 },
            { time: 2, value: 3 },
          ],
        },
      },
    },
    empty: {},
  },
};

/** Skeleton exported without nonessential data (no fps/images/edges). */
export const LEAN_SKELETON = {
  skeleton: { hash: 'leanhash', spine: '4.2.37', x: 0, y: 0, width: 10, height: 10 },
  bones: [{ name: 'root' }, { name: 'bone', parent: 'root' }],
  slots: [{ name: 'slot', bone: 'bone', attachment: 'region' }],
  skins: [{ name: 'default', attachments: { slot: { region: { width: 4, height: 4 } } } }],
  animations: { idle: { bones: { bone: { rotate: [{ time: 0.5, value: 1 }] } } } },
};

/** Current (4.0+) atlas format with two pages. */
export const MODERN_ATLAS = [
  'hero.png',
  'size: 512, 256',
  'format: RGBA8888',
  'filter: Linear, Linear',
  'repeat: none',
  'pma: true',
  'head',
  'bounds: 2, 2, 100, 80',
  'offsets: 1, 1, 102, 82',
  'rotate: 90',
  'torso',
  'bounds: 104, 2, 50, 90',
  'leg-left',
  'index: 0',
  'bounds: 156, 2, 64, 128',
  '',
  'hero2.png',
  'size: 128, 128',
  'format: RGB565',
  'filter: Nearest, Nearest',
  'repeat: x',
  'fx/glow',
  'bounds: 2, 2, 32, 32',
  'split: 10, 10, 29, 10',
  'pad: -1, -1, 28, 10',
  'extraKey: extraValue',
  '',
].join('\n');

/** Legacy (pre-4.0) atlas format. */
export const LEGACY_ATLAS = [
  'hero.png',
  'size: 256, 256',
  'format: RGBA8888',
  'filter: Linear, Linear',
  'repeat: none',
  'head',
  '  rotate: false',
  '  xy: 2, 2',
  '  size: 100, 80',
  '  orig: 102, 82',
  '  offset: 1, 1',
  '  index: -1',
  'torso',
  '  rotate: true',
  '  xy: 104, 2',
  '  size: 50, 90',
  '  orig: 50, 90',
  '  offset: 0, 0',
  '  index: -1',
  '',
].join('\n');

/** Deep-copy a fixture so a test can mutate it safely. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Serialize a fixture the way Spine's pretty-print export would. */
export function toJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * A deliberately broken skeleton: two roots, a missing parent, duplicate
 * names, a dangling slot bone, CamelCase names, an empty animation, a
 * duration outlier, no default skin, and no nonessential data.
 */
export const BROKEN_SKELETON = {
  skeleton: { spine: '4.2.37' },
  bones: [
    { name: 'root' },
    { name: 'SecondRoot' },
    { name: 'dup' },
    { name: 'dup', parent: 'root' },
    { name: 'orphan', parent: 'ghost' },
  ],
  slots: [
    { name: 'Head_Slot', bone: 'missing-bone' },
    { name: 'dupslot', bone: 'root' },
    { name: 'dupslot', bone: 'root' },
  ],
  skins: [
    {
      name: 'Blue Skin',
      attachments: {
        dupslot: { 'Weird Name': { width: 1, height: 1 } },
      },
    },
  ],
  events: { 'Foot Step': { int: 1 } },
  animations: {
    Walk: { bones: { root: { rotate: [{ time: 1, value: 10 }] } } },
    idle: { bones: { root: { rotate: [{ time: 1, value: 0 }] } } },
    'very-long': { bones: { root: { rotate: [{ time: 120, value: 0 }] } } },
    empty: {},
  },
};

/** An atlas that is missing the regions BROKEN_SKELETON needs. */
export const MISMATCHED_ATLAS = [
  'page.png',
  'size: 300, 200',
  'format: RGBA8888',
  'filter: Linear, Linear',
  'pma: false',
  'leftover',
  'bounds: 2, 2, 10, 10',
  'twin',
  'bounds: 20, 2, 10, 10',
  'twin',
  'bounds: 40, 2, 10, 10',
  '',
].join('\n');

/**
 * A renderable pair: a skeleton whose single region attachment matches a
 * region in the atlas below. Used by the headless preview tests, where the
 * data has to be consistent enough for the real runtime to load it.
 */
export const RENDERABLE_SKELETON = {
  skeleton: {
    hash: 'renderable',
    spine: '4.2.37',
    x: -32,
    y: 0,
    width: 64,
    height: 64,
    images: './images/',
  },
  bones: [
    { name: 'root' },
    { name: 'body', parent: 'root', length: 64, rotation: 90 },
  ],
  slots: [{ name: 'body', bone: 'body', attachment: 'body' }],
  skins: [
    {
      name: 'default',
      attachments: {
        body: {
          body: { x: 32, y: 0, rotation: -90, width: 64, height: 64 },
        },
      },
    },
  ],
  animations: {
    spin: {
      bones: {
        body: {
          rotate: [
            { time: 0, value: 0 },
            { time: 1, value: 90 },
          ],
        },
      },
    },
  },
};

/** The atlas that pairs with {@link RENDERABLE_SKELETON}. */
export const RENDERABLE_ATLAS = [
  'fixture.png',
  'size: 64, 64',
  'format: RGBA8888',
  'filter: Linear, Linear',
  'repeat: none',
  'pma: false',
  'body',
  'bounds: 0, 0, 64, 64',
  '',
].join('\n');

/**
 * A skeleton with a genuinely loopable animation.
 *
 * Needed because no other fixture has one: the loopability heuristic
 * compares each timeline's first and last keyframe values, and
 * `RICH_SKELETON.walk` and `.idle` both disagree, while `LEAN_SKELETON.idle`
 * only qualifies through the degenerate single-keyframe rule. `breathe`
 * returns both of its timelines to their starting values at t = 2.
 */
export const LOOPABLE_SKELETON = {
  skeleton: {
    hash: 'loopablehash',
    spine: '4.2.37',
    x: -16,
    y: 0,
    width: 32,
    height: 124,
  },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', y: 64 },
    { name: 'torso', parent: 'hip', length: 60 },
  ],
  slots: [{ name: 'torso', bone: 'torso', attachment: 'torso' }],
  skins: [
    {
      name: 'default',
      attachments: { torso: { torso: { x: 0, y: 30, width: 32, height: 60 } } },
    },
  ],
  animations: {
    breathe: {
      bones: {
        torso: {
          rotate: [
            { time: 0, value: 0 },
            { time: 1, value: 2 },
            { time: 2, value: 0 },
          ],
          translate: [
            { time: 0, x: 0, y: 0 },
            { time: 1, x: 0, y: 1.5 },
            { time: 2, x: 0, y: 0 },
          ],
        },
      },
    },
  },
};

/**
 * The full canonical hierarchy from `python/src/spine_psd/conventions.py`:
 * `root -> hip -> torso -> chest -> neck -> head`, arms off `chest` through
 * the `shoulder_*` bones, legs off `hip`.
 *
 * Every bone rotation is zero and every joint is placed with plain parent
 * relative offsets, so a rotation keyframe on a limb pivots about that
 * limb's joint and nothing else — which is what makes it a usable target
 * for the animation templates.
 *
 * Every attachment sits on a declared slot and every region it names is in
 * {@link CANONICAL_RIG_ATLAS}, so the real runtime can load it and reach a
 * draw call. Hand-generated; nothing here comes from a Spine install.
 */
export const CANONICAL_RIG = {
  skeleton: {
    hash: 'canonicalrig',
    spine: '4.2.37',
    x: -32,
    y: -14,
    width: 64,
    height: 236,
    images: './images/',
  },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', x: 0, y: 70 },
    { name: 'torso', parent: 'hip', length: 48 },
    { name: 'chest', parent: 'torso', y: 48, length: 40 },
    { name: 'neck', parent: 'chest', y: 40, length: 16 },
    { name: 'head', parent: 'neck', y: 16, length: 48 },
    { name: 'shoulder_left', parent: 'chest', x: 14, y: 34, length: 8 },
    { name: 'arm_left', parent: 'shoulder_left', x: 8, length: 40 },
    { name: 'forearm_left', parent: 'arm_left', y: -40, length: 36 },
    { name: 'hand_left', parent: 'forearm_left', y: -36, length: 16 },
    { name: 'shoulder_right', parent: 'chest', x: -14, y: 34, length: 8 },
    { name: 'arm_right', parent: 'shoulder_right', x: -8, length: 40 },
    { name: 'forearm_right', parent: 'arm_right', y: -40, length: 36 },
    { name: 'hand_right', parent: 'forearm_right', y: -36, length: 16 },
    { name: 'thigh_left', parent: 'hip', x: 10, length: 44 },
    { name: 'shin_left', parent: 'thigh_left', y: -44, length: 40 },
    { name: 'thigh_right', parent: 'hip', x: -10, length: 44 },
    { name: 'shin_right', parent: 'thigh_right', y: -44, length: 40 },
  ],
  // Declaration order is draw order: the rig's right side sits behind the
  // torso, its left side in front, so a limb sweep is readable in a render.
  slots: [
    { name: 'shin_right', bone: 'shin_right', attachment: 'shin_right' },
    { name: 'thigh_right', bone: 'thigh_right', attachment: 'thigh_right' },
    { name: 'hand_right', bone: 'hand_right', attachment: 'hand_right' },
    { name: 'forearm_right', bone: 'forearm_right', attachment: 'forearm_right' },
    { name: 'arm_right', bone: 'arm_right', attachment: 'arm_right' },
    { name: 'shin_left', bone: 'shin_left', attachment: 'shin_left' },
    { name: 'thigh_left', bone: 'thigh_left', attachment: 'thigh_left' },
    { name: 'torso', bone: 'torso', attachment: 'torso' },
    { name: 'chest', bone: 'chest', attachment: 'chest' },
    { name: 'neck', bone: 'neck', attachment: 'neck' },
    { name: 'head', bone: 'head', attachment: 'head' },
    { name: 'arm_left', bone: 'arm_left', attachment: 'arm_left' },
    { name: 'forearm_left', bone: 'forearm_left', attachment: 'forearm_left' },
    { name: 'hand_left', bone: 'hand_left', attachment: 'hand_left' },
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        shin_right: { shin_right: { x: 0, y: -20, width: 18, height: 40 } },
        thigh_right: { thigh_right: { x: 0, y: -22, width: 20, height: 44 } },
        hand_right: { hand_right: { x: 0, y: -8, width: 16, height: 16 } },
        forearm_right: { forearm_right: { x: 0, y: -18, width: 14, height: 36 } },
        arm_right: { arm_right: { x: 0, y: -20, width: 16, height: 40 } },
        shin_left: { shin_left: { x: 0, y: -20, width: 18, height: 40 } },
        thigh_left: { thigh_left: { x: 0, y: -22, width: 20, height: 44 } },
        torso: { torso: { x: 0, y: 24, width: 44, height: 48 } },
        chest: { chest: { x: 0, y: 20, width: 40, height: 40 } },
        neck: { neck: { x: 0, y: 8, width: 16, height: 16 } },
        head: { head: { x: 0, y: 24, width: 48, height: 48 } },
        arm_left: { arm_left: { x: 0, y: -20, width: 16, height: 40 } },
        forearm_left: { forearm_left: { x: 0, y: -18, width: 14, height: 36 } },
        hand_left: { hand_left: { x: 0, y: -8, width: 16, height: 16 } },
      },
    },
  ],
  // An empty `setup` plus a minimal `idle`, which is what the PSD generator
  // produces: enough for a test to prove existing animations survive.
  animations: {
    setup: {},
    idle: {
      bones: {
        torso: {
          rotate: [
            { time: 0, value: 0 },
            { time: 1, value: 1 },
            { time: 2, value: 0 },
          ],
        },
      },
    },
  },
};

/** The atlas that pairs with {@link CANONICAL_RIG}; one page, no padding overlap. */
export const CANONICAL_RIG_ATLAS = [
  'canonical.png',
  'size: 512, 256',
  'format: RGBA8888',
  'filter: Linear, Linear',
  'repeat: none',
  'pma: false',
  'head',
  'bounds: 2, 2, 48, 48',
  'chest',
  'bounds: 54, 2, 40, 40',
  'torso',
  'bounds: 98, 2, 44, 48',
  'neck',
  'bounds: 146, 2, 16, 16',
  'arm_left',
  'bounds: 166, 2, 16, 40',
  'arm_right',
  'bounds: 186, 2, 16, 40',
  'forearm_left',
  'bounds: 206, 2, 14, 36',
  'forearm_right',
  'bounds: 224, 2, 14, 36',
  'hand_left',
  'bounds: 242, 2, 16, 16',
  'hand_right',
  'bounds: 262, 2, 16, 16',
  'thigh_left',
  'bounds: 282, 2, 20, 44',
  'thigh_right',
  'bounds: 306, 2, 20, 44',
  'shin_left',
  'bounds: 330, 2, 18, 40',
  'shin_right',
  'bounds: 352, 2, 18, 40',
  '',
].join('\n');

/**
 * A renderable skeleton that exercises the probe layer's warning path.
 *
 * `RICH_SKELETON` cannot do this job: the pinned reader throws
 * `Couldn't find slot <name> for skin <skin>` for any skin attachment key
 * that is not a declared slot, and `RICH_SKELETON` declares attachments
 * under `path-slot`, `muzzle` and `clip` while its slots are only
 * `leg-left`, `torso`, `head`, `glow`, `shadow` and `hitbox`. It therefore
 * never reaches a draw call in the real runtime and exercises the warning
 * path through a stub launcher only.
 *
 * Here every attachment is on a declared slot. The non-drawable kinds are
 * exactly three — `point`, `boundingbox`, `clipping` — and no `path`
 * attachment is declared, so a real-page probe run produces exactly three
 * warnings.
 *
 * `crest` is deliberately a small 16x16 box at `y: 96` on the same bone as
 * `body`: off-centre and vertically compact, so a mirrored box lands in the
 * other half of the canvas and a missing Y-flip fails loudly instead of
 * producing a plausible document with the wrong slot names in it.
 */
export const PROBE_WARNING_SKELETON = {
  skeleton: {
    hash: 'probewarning',
    spine: '4.2.37',
    x: -32,
    y: -4,
    width: 64,
    height: 112,
    images: './images/',
  },
  bones: [
    { name: 'root' },
    { name: 'body', parent: 'root', length: 64 },
  ],
  slots: [
    { name: 'body', bone: 'body', attachment: 'body' },
    { name: 'crest', bone: 'body', attachment: 'crest' },
    // These three carry a setup-pose attachment on purpose. The probe page
    // names a skipped kind only for a slot whose attachment is actually
    // set, so leaving them null would produce no warnings at all.
    { name: 'muzzle', bone: 'body', attachment: 'muzzle' },
    { name: 'hitbox', bone: 'body', attachment: 'hitbox' },
    { name: 'clip', bone: 'body', attachment: 'clip' },
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        body: { body: { x: 0, y: 32, width: 64, height: 64 } },
        crest: { crest: { x: 0, y: 96, width: 16, height: 16 } },
        muzzle: { muzzle: { type: 'point', x: 8, y: 40, rotation: 0 } },
        hitbox: {
          hitbox: {
            type: 'boundingbox',
            vertexCount: 4,
            vertices: [-16, 0, 16, 0, 16, 64, -16, 64],
          },
        },
        // `end` names a slot drawn *before* this one, so the clipper closes
        // immediately and clips nothing away: the warning is the point, not
        // a hole in the render.
        clip: {
          clip: {
            type: 'clipping',
            end: 'crest',
            vertexCount: 4,
            vertices: [-32, 0, 32, 0, 32, 112, -32, 112],
          },
        },
      },
    },
  ],
  animations: {
    bob: {
      bones: {
        body: {
          rotate: [
            { time: 0, value: 0 },
            { time: 0.5, value: 6 },
          ],
        },
      },
    },
  },
};

/** The atlas that pairs with {@link PROBE_WARNING_SKELETON}. */
export const PROBE_WARNING_ATLAS = [
  'probe.png',
  'size: 128, 128',
  'format: RGBA8888',
  'filter: Linear, Linear',
  'repeat: none',
  'pma: false',
  'body',
  'bounds: 0, 0, 64, 64',
  'crest',
  'bounds: 66, 0, 16, 16',
  '',
].join('\n');
