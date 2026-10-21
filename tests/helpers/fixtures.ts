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
