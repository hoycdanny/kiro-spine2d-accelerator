// ============================================================
// Template-generated placeholder motion for an exported Spine rig.
//
// Everything here is pure: tables in, JSON objects out. There is no
// subprocess, no Python bridge and no browser, because the input is
// exported JSON and the output is exported JSON — the work is table lookup
// and arithmetic.
//
// Three properties the rest of the tool depends on:
//
//   1. Every emitted number traces to one table row times two scalars
//      (`duration`, `amplitude`), so the output is reviewable and trivially
//      deterministic.
//   2. A template declares the bones it needs, so "does this template fit
//      this rig" has an answer. A procedural generator has no declared
//      preconditions and so can only ever produce something that looks
//      like success.
//   3. No `curve` field is ever written. In the 4.2 reader `readCurve` runs
//      only `if (keyMap.curve)`, so omitting it IS the documented route to
//      linear interpolation and no bezier array has to be guessed.
//
// `canonicalJson` and `byCodeUnit` come from `./canonical-json` rather than
// from the skeleton documenter, so this module depends on nothing but the
// three primitives and the result envelope.
// ============================================================

import { createHash } from 'node:crypto';

import { byCodeUnit, canonicalJson, round } from './canonical-json';
import { SpineErrorCode, SpineResult, err, ok } from './types';

// ------------------------------------------------------------
// The Spine 4.2 timeline-key allow-list
// ------------------------------------------------------------

/** Which section of an animation a timeline key lives under. */
export type TimelineOwner = 'bone' | 'slot' | 'animation';

/** One key the 4.2 reader accepts, and the branch that reads it. */
export interface TimelineKeySpec {
  /** The JSON key, e.g. `rotate`. */
  key: string;
  owner: TimelineOwner;
  /** Fields every keyframe of this timeline carries, besides `time`. */
  valueFields: string[];
  /** The condition in `SkeletonJson.js` that reaches this key. Never empty. */
  readerBranch: string;
}

/**
 * Every timeline key **this generator may emit**, as data.
 *
 * Each row was taken from the dispatch in
 * `@esotericsoftware/spine-core@4.2.120/dist/SkeletonJson.js` and cross-read
 * against `spine-runtimes` 4.2 `SkeletonJson.java`, so every key here is one
 * the 4.2 reader accepts. The converse does not hold: the reader's surface is
 * larger than this table. It also dispatches `position`, `spacing` and `mix`
 * on path constraints, `inertia`, `strength`, `damping`, `mass`, `wind`,
 * `gravity`, `mix` and `reset` on physics constraints, and `ik`, `transform`
 * and `deform`, none of which any template keys. This table is the emit
 * allow-list: a unit test enumerates every key the templates emit and asserts
 * membership here, so adding a key without reviewing the reader fails the
 * build, and a template that keyed a path, physics or deform timeline must
 * have its owner added here first.
 *
 * Two defaults matter to the emitter. `scale` is read with
 * `readTimeline2(…, "x", "y", 1, 1)` — default **one** — while `rotate` and
 * `translate*` default to zero, which is why {@link applyAmplitude} is
 * axis-aware. And `curve` is deliberately absent from this table: it is not
 * a timeline key, it is a per-keyframe field this generator never writes.
 */
export const SPINE_42_TIMELINE_KEYS: TimelineKeySpec[] = [
  {
    key: 'rotate',
    owner: 'bone',
    valueFields: ['value'],
    readerBranch: 'timelineName === "rotate" → readTimeline1(…, 0, 1)',
  },
  {
    key: 'translate',
    owner: 'bone',
    valueFields: ['x', 'y'],
    readerBranch: 'timelineName === "translate" → readTimeline2(…, "x", "y", 0, scale)',
  },
  {
    key: 'translatex',
    owner: 'bone',
    valueFields: ['value'],
    readerBranch: 'timelineName === "translatex" → readTimeline1(…, 0, scale)',
  },
  {
    key: 'translatey',
    owner: 'bone',
    valueFields: ['value'],
    readerBranch: 'timelineName === "translatey" → readTimeline1(…, 0, scale)',
  },
  {
    key: 'scale',
    owner: 'bone',
    valueFields: ['x', 'y'],
    readerBranch: 'timelineName === "scale" → readTimeline2(…, "x", "y", 1, 1)',
  },
  {
    key: 'scalex',
    owner: 'bone',
    valueFields: ['value'],
    readerBranch: 'timelineName === "scalex" → readTimeline1(…, 1, 1)',
  },
  {
    key: 'scaley',
    owner: 'bone',
    valueFields: ['value'],
    readerBranch: 'timelineName === "scaley" → readTimeline1(…, 1, 1)',
  },
  {
    key: 'shear',
    owner: 'bone',
    valueFields: ['x', 'y'],
    readerBranch: 'timelineName === "shear" → readTimeline2(…, "x", "y", 0, 1)',
  },
  {
    key: 'shearx',
    owner: 'bone',
    valueFields: ['value'],
    readerBranch: 'timelineName === "shearx" → readTimeline1(…, 0, 1)',
  },
  {
    key: 'sheary',
    owner: 'bone',
    valueFields: ['value'],
    readerBranch: 'timelineName === "sheary" → readTimeline1(…, 0, 1)',
  },
  {
    key: 'inherit',
    owner: 'bone',
    valueFields: ['inherit'],
    readerBranch: 'timelineName === "inherit" → Inherit[getValue(keyMap, "inherit", "normal")]',
  },
  {
    key: 'attachment',
    owner: 'slot',
    valueFields: ['name'],
    readerBranch: 'timelineName === "attachment" → AttachmentTimeline, getValue(keyMap, "name", null)',
  },
  {
    key: 'rgba',
    owner: 'slot',
    valueFields: ['color'],
    readerBranch: 'timelineName === "rgba" → RGBATimeline, Color.fromString(keyMap.color)',
  },
  {
    key: 'rgb',
    owner: 'slot',
    valueFields: ['color'],
    readerBranch: 'timelineName === "rgb" → RGBTimeline, Color.fromString(keyMap.color)',
  },
  {
    key: 'alpha',
    owner: 'slot',
    valueFields: ['value'],
    readerBranch: 'timelineName === "alpha" → AlphaTimeline via readTimeline1',
  },
  {
    key: 'rgba2',
    owner: 'slot',
    valueFields: ['light', 'dark'],
    readerBranch: 'timelineName === "rgba2" → RGBA2Timeline, keyMap.light and keyMap.dark',
  },
  {
    key: 'rgb2',
    owner: 'slot',
    valueFields: ['light', 'dark'],
    readerBranch: 'timelineName === "rgb2" → RGB2Timeline, keyMap.light and keyMap.dark',
  },
  {
    key: 'events',
    owner: 'animation',
    valueFields: ['name'],
    readerBranch: 'if (map.events) → EventTimeline; throws "Event not found" when name is not in root events',
  },
  {
    key: 'drawOrder',
    owner: 'animation',
    valueFields: ['offsets'],
    readerBranch: 'if (map.drawOrder) → DrawOrderTimeline',
  },
];

/** The allow-list entry for one owner/key pair, or undefined. */
export function timelineKeySpec(
  owner: TimelineOwner,
  key: string,
): TimelineKeySpec | undefined {
  return SPINE_42_TIMELINE_KEYS.find(
    (entry) => entry.owner === owner && entry.key === key,
  );
}

// ------------------------------------------------------------
// Templates
// ------------------------------------------------------------

/** The axes a template track may key. */
export type Axis = 'rotate' | 'translate' | 'translatex' | 'translatey' | 'scale';

/** Timeline keys are written in this order inside a bone's object. */
const AXIS_ORDER: Axis[] = ['rotate', 'translate', 'translatex', 'translatey', 'scale'];

/** Axes whose keyframes carry `x` and `y` rather than a single `value`. */
const TWO_VALUE_AXES = new Set<Axis>(['translate', 'scale']);

/** One bone, one axis, and the control points the emitter reads. */
export interface BoneTrack {
  /** Canonical bone name, per `python/src/spine_psd/conventions.py`. */
  bone: string;
  axis: Axis;
  /** `[phase, coefficient]`, or `[phase, coeffX, coeffY]` for a two-value axis. */
  points: Array<[number, number] | [number, number, number]>;
  /**
   * Multiplied into every coefficient of a `rotate`/`translate*` track.
   * `-1` mirrors a right-side limb.
   *
   * MUST be `1` when `axis === 'scale'`: a negative scale is a reflection,
   * not a smaller limb. {@link validateEmittedAnimations} asserts that over
   * the whole table rather than trusting this comment.
   */
  sideSign: 1 | -1;
}

/** An event a template fires, with the declaration it needs in the root. */
export interface TemplateEvent {
  name: string;
  phase: number;
  declaration: { int?: number; float?: number; string?: string };
}

/** A parameterised animation: control points plus declared preconditions. */
export interface Template {
  name: string;
  defaultDuration: number;
  /** Whether the motion returns to its starting pose, i.e. is meant to loop. */
  intendedLoop: boolean;
  /** Absent → the template does not fit the rig at all. */
  requiredBones: string[];
  /** Absent → that bone's tracks are dropped and the omission is reported. */
  optionalBones: string[];
  tracks: BoneTrack[];
  /**
   * Event keyframes the template emits when `emitEvents` is set. All five
   * shipped templates declare none, so the flag is a no-op for every one
   * of them; the shape and its validation exist for the first template
   * that does declare an event.
   */
  events: TemplateEvent[];
  /** One sentence, copied into the summary and the `_generator` record. */
  note: string;
}

/** The five template names, in the order the tool documents them. */
export const TEMPLATE_NAMES = ['idle', 'walk', 'wave', 'jump', 'turn_head'] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/**
 * The five templates, transcribed from the approved design tables.
 *
 * Bone names are the canonical hierarchy (`root → hip → torso → chest →
 * neck → head`, arms off `chest` via `shoulder_*`, legs off `hip`).
 * Coefficients are degrees for `rotate`, skeleton units for `translate*`
 * and multipliers for `scale`.
 *
 * Two rules hold across every table. Every track carries an explicit
 * `phase: 0` point, so the pose is defined at `time: 0` for every template,
 * amplitude and duration. And the only shorthand is `sideSign: -1`: no
 * template declares a phase shift, because "half a cycle later" has several
 * readings and the naive one emits non-monotonic times with no `time: 0`
 * key. A track that is another track half a cycle later is written out as
 * its own literal points.
 *
 * Rotation sign: Spine rotation is counter-clockwise-positive and a
 * `psd_to_skeleton` rig pivots each limb at its joint edge, so a right arm
 * raising forward needs a negative delta and the left a positive one. That
 * is why `sideSign` is a per-track field — it is unverifiable without
 * rendering, and flipping one constant fixes a whole template.
 */
export const TEMPLATES: Record<TemplateName, Template> = {
  idle: {
    name: 'idle',
    defaultDuration: 2,
    intendedLoop: true,
    requiredBones: ['torso'],
    optionalBones: ['chest', 'head', 'hip', 'arm_left', 'arm_right'],
    tracks: [
      { bone: 'torso', axis: 'rotate', sideSign: 1, points: [[0, 0], [0.5, 1.5], [1, 0]] },
      { bone: 'chest', axis: 'rotate', sideSign: 1, points: [[0, 0], [0.5, -1], [1, 0]] },
      { bone: 'head', axis: 'rotate', sideSign: 1, points: [[0, 0], [0.5, 1], [1, 0]] },
      {
        bone: 'hip',
        axis: 'translate',
        sideSign: 1,
        points: [[0, 0, 0], [0.5, 0, 1.5], [1, 0, 0]],
      },
      { bone: 'arm_left', axis: 'rotate', sideSign: 1, points: [[0, 0], [0.5, 2], [1, 0]] },
      { bone: 'arm_right', axis: 'rotate', sideSign: -1, points: [[0, 0], [0.5, 2], [1, 0]] },
    ],
    events: [],
    note: 'A slow breathing sway: the torso and chest counter-rotate while the hip lifts, so a standing rig is not frozen.',
  },

  walk: {
    name: 'walk',
    defaultDuration: 1,
    intendedLoop: true,
    requiredBones: ['thigh_left', 'thigh_right'],
    optionalBones: [
      'shin_left',
      'shin_right',
      'hip',
      'torso',
      'arm_left',
      'arm_right',
    ],
    tracks: [
      {
        bone: 'thigh_left',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 25], [0.25, 0], [0.5, -25], [0.75, 0], [1, 25]],
      },
      {
        bone: 'thigh_right',
        axis: 'rotate',
        sideSign: -1,
        points: [[0, 25], [0.25, 0], [0.5, -25], [0.75, 0], [1, 25]],
      },
      {
        bone: 'shin_left',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, -5], [0.25, -20], [0.5, -5], [0.75, 0], [1, -5]],
      },
      // `shin_left` half a cycle later, written out as points rather than as
      // a shift — and NOT as a negation, because the shin curve is
      // asymmetric about zero (a knee bends one way only), so `×−1` would
      // straighten the leg backwards.
      {
        bone: 'shin_right',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, -5], [0.25, 0], [0.5, -5], [0.75, -20], [1, -5]],
      },
      {
        bone: 'hip',
        axis: 'translate',
        sideSign: 1,
        points: [[0, 0, 0], [0.25, 0, 2], [0.5, 0, 0], [0.75, 0, 2], [1, 0, 0]],
      },
      {
        bone: 'torso',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.25, 1], [0.5, 0], [0.75, -1], [1, 0]],
      },
      {
        bone: 'arm_left',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, -15], [0.25, 0], [0.5, 15], [0.75, 0], [1, -15]],
      },
      {
        bone: 'arm_right',
        axis: 'rotate',
        sideSign: -1,
        points: [[0, -15], [0.25, 0], [0.5, 15], [0.75, 0], [1, -15]],
      },
    ],
    events: [],
    note: 'An in-place walk cycle: the legs alternate and the arms counter-swing, with no root translation, so the rig walks on the spot.',
  },

  wave: {
    name: 'wave',
    defaultDuration: 1,
    intendedLoop: false,
    requiredBones: ['arm_right'],
    optionalBones: ['forearm_right', 'hand_right', 'head', 'arm_left'],
    tracks: [
      {
        bone: 'arm_right',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.2, -70], [0.5, -70], [0.8, -70], [1, 0]],
      },
      {
        bone: 'forearm_right',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.2, -20], [0.5, 10], [0.8, -20], [1, 0]],
      },
      {
        bone: 'hand_right',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.35, 10], [0.65, -10], [1, 0]],
      },
      {
        bone: 'head',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.2, 3], [0.8, 3], [1, 0]],
      },
      // A small counter-pose on the other arm. A figure whose other arm is
      // frozen while it waves reads as paralysed; it stays optional, so the
      // required set is still just `arm_right`.
      { bone: 'arm_left', axis: 'rotate', sideSign: -1, points: [[0, 0], [0.5, 6], [1, 0]] },
    ],
    events: [],
    note: 'A one-shot greeting: the right arm lifts and the forearm sweeps twice while the head tips towards the viewer.',
  },

  jump: {
    name: 'jump',
    defaultDuration: 0.8,
    intendedLoop: false,
    requiredBones: ['hip'],
    optionalBones: [
      'thigh_left',
      'thigh_right',
      'shin_left',
      'shin_right',
      'torso',
      'arm_left',
      'arm_right',
    ],
    tracks: [
      {
        bone: 'hip',
        axis: 'translate',
        sideSign: 1,
        points: [[0, 0, 0], [0.15, 0, -8], [0.45, 0, 30], [0.75, 0, -6], [1, 0, 0]],
      },
      // The only `scale` track in any template, and the reason
      // `applyAmplitude` is axis-aware. Its `phase: 0` point is (1,1), the
      // neutral scale, so the template satisfies its own `time: 0`
      // invariant.
      {
        bone: 'hip',
        axis: 'scale',
        sideSign: 1,
        points: [[0, 1, 1], [0.15, 1.05, 0.92], [0.45, 0.97, 1.06], [1, 1, 1]],
      },
      // All four leg tracks are sideSign +1: a jump is symmetric, and
      // negating the right leg would bend one knee backwards.
      {
        bone: 'thigh_left',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.15, 20], [0.45, -10], [0.75, 15], [1, 0]],
      },
      {
        bone: 'thigh_right',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.15, 20], [0.45, -10], [0.75, 15], [1, 0]],
      },
      {
        bone: 'shin_left',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.15, -25], [0.45, 5], [0.75, -20], [1, 0]],
      },
      {
        bone: 'shin_right',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.15, -25], [0.45, 5], [0.75, -20], [1, 0]],
      },
      {
        bone: 'torso',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.15, -5], [0.45, 3], [1, 0]],
      },
      { bone: 'arm_left', axis: 'rotate', sideSign: 1, points: [[0, 0], [0.45, 35], [1, 0]] },
      { bone: 'arm_right', axis: 'rotate', sideSign: -1, points: [[0, 0], [0.45, 35], [1, 0]] },
    ],
    events: [],
    note: 'A one-shot jump: the hip crouches, rises and lands, with a squash on the way down and a stretch at the top.',
  },

  turn_head: {
    name: 'turn_head',
    defaultDuration: 1.2,
    intendedLoop: false,
    requiredBones: ['head'],
    optionalBones: ['neck', 'chest'],
    tracks: [
      {
        bone: 'head',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.25, 18], [0.75, 18], [1, 0]],
      },
      {
        bone: 'neck',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.25, 6], [0.75, 6], [1, 0]],
      },
      {
        bone: 'chest',
        axis: 'rotate',
        sideSign: 1,
        points: [[0, 0], [0.25, 2], [0.75, 2], [1, 0]],
      },
    ],
    events: [],
    note: 'A one-shot look to the side: the head turns, the neck and chest follow a little, and everything returns to the setup pose.',
  },
};

/**
 * Layer-name aliases, mirroring `conventions.ALIASES` in
 * `python/src/spine_psd/conventions.py`.
 *
 * Consulted SOLELY to write a better hint — "the rig has `upper_arm_left`,
 * which this generator would call `arm_left`" — and NEVER to pick a
 * substitute bone. It mirrors Python by hand and may drift from it; drift
 * can only make a hint less helpful, never make the output wrong.
 */
export const ADVISORY_ALIASES: Record<string, string> = {
  body: 'torso',
  belly: 'torso',
  pelvis: 'hip',
  hips: 'hip',
  waist: 'hip',
  upper_body: 'chest',
  upperbody: 'chest',
  ribs: 'chest',
  skull: 'head',
  face: 'head',
  upper_arm_left: 'arm_left',
  upperarm_left: 'arm_left',
  lower_arm_left: 'forearm_left',
  upper_arm_right: 'arm_right',
  upperarm_right: 'arm_right',
  lower_arm_right: 'forearm_right',
  leg_left: 'thigh_left',
  lower_leg_left: 'shin_left',
  calf_left: 'shin_left',
  leg_right: 'thigh_right',
  lower_leg_right: 'shin_right',
  calf_right: 'shin_right',
};

/**
 * The one honesty sentence, used verbatim in the `_generator` note, the tool
 * summary, the tool description and every documentation file. One sentence
 * in one place cannot drift between the code and the docs.
 */
export const PLACEHOLDER_MOTION_NOTE =
  'mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it.';

/** Name of the hash algorithm, recorded so nobody mistakes it for Spine's. */
export const HASH_ALGORITHM = 'kiro-spine2d/canonical-sha1-22';

/** Hex characters of hash Spine and `writer.py` both use. */
const HASH_LENGTH = 22;

/** What every generator-defect failure tells the caller to do. */
const GENERATOR_DEFECT_HINT =
  'This is a defect in the generator; report it with the skeleton that triggered it.';

// ------------------------------------------------------------
// Amplitude
// ------------------------------------------------------------

/**
 * Amplitude scales the DEVIATION from the axis's neutral value.
 *
 * `rotate` and `translate*` are additive around 0; `scale` is multiplicative
 * around 1, because the 4.2 reader defaults a `scale` keyframe to one. A
 * single `coefficient × amplitude` rule would map `jump`'s `hip.scale` point
 * `(1.05, 0.92)` at `amplitude: 0.5` to `(0.525, 0.46)`: a caller who asked
 * for less squash would get a hip at half size, with every validation
 * invariant satisfied, shipping as a success.
 *
 * `sideSign` mirrors a limb and is meaningless on a `scale` track, where a
 * negative value is a reflection rather than a smaller bone.
 */
export function applyAmplitude(
  axis: Axis,
  coefficient: number,
  amplitude: number,
  sideSign: 1 | -1,
): number {
  if (axis === 'scale') return round(1 + (coefficient - 1) * amplitude, 3);
  return round(coefficient * amplitude * sideSign, 3);
}

// ------------------------------------------------------------
// Rig fitting
// ------------------------------------------------------------

/** A template that fits the rig, with what was used and what was dropped. */
export interface MatchOk {
  ok: true;
  /** Bones with at least one track, in skeleton declaration order. */
  usedBones: string[];
  /** Optional bones the rig lacks, so their tracks were dropped. */
  omittedOptional: string[];
  /** The dropped tracks themselves, as `<bone>/<axis>`. */
  droppedTracks: string[];
}

/** A template that does not fit, with an advisory rename hint. */
export interface MatchFail {
  ok: false;
  missingRequired: string[];
  /** Advisory only. Never used to substitute a bone. */
  suggestions: Array<{ missing: string; candidate: string }>;
}

export type MatchResult = MatchOk | MatchFail;

/**
 * Decide whether a template fits a rig.
 *
 * A missing REQUIRED bone fails: no substitution, no scaling down to a
 * meaningless subset, no empty animation that looks like success. A missing
 * OPTIONAL bone drops its tracks and is reported.
 *
 * `boneNames` is expected in skeleton declaration order, which is the order
 * `usedBones` — and therefore the emitted `bones` object — comes back in.
 */
export function matchTemplate(template: Template, boneNames: string[]): MatchResult {
  const present = new Set(boneNames);

  const missingRequired = template.requiredBones.filter((bone) => !present.has(bone));
  if (missingRequired.length > 0) {
    const suggestions: Array<{ missing: string; candidate: string }> = [];
    for (const missing of missingRequired) {
      for (const [alias, canonical] of Object.entries(ADVISORY_ALIASES)) {
        if (canonical === missing && present.has(alias)) {
          suggestions.push({ missing, candidate: alias });
        }
      }
    }
    return { ok: false, missingRequired, suggestions };
  }

  const tracked = new Set(template.tracks.map((track) => track.bone));
  return {
    ok: true,
    usedBones: boneNames.filter((name) => tracked.has(name)),
    omittedOptional: template.optionalBones
      .filter((bone) => !present.has(bone))
      .sort(byCodeUnit),
    droppedTracks: template.tracks
      .filter((track) => !present.has(track.bone))
      .map((track) => `${track.bone}/${track.axis}`),
  };
}

// ------------------------------------------------------------
// Emission
// ------------------------------------------------------------

/** The two scalars and the two flags one emitted animation needs. */
export interface EmitRequest {
  name: string;
  duration: number;
  amplitude: number;
  emitEvents: boolean;
}

/** One emitted animation, plus the event declarations it references. */
export interface EmittedAnimation {
  animation: Record<string, unknown>;
  /** Declarations to merge into the root `events` object, if any. */
  eventDeclarations: Record<string, unknown>;
  /** Distinct timeline keys written, in the order they were first written. */
  emittedKeys: string[];
}

/** Build one keyframe object. Never carries a `curve` field. */
function keyframeOf(
  axis: Axis,
  time: number,
  point: readonly number[],
  amplitude: number,
  sideSign: 1 | -1,
): Record<string, unknown> {
  if (TWO_VALUE_AXES.has(axis)) {
    return {
      time,
      x: applyAmplitude(axis, point[1] ?? 0, amplitude, sideSign),
      y: applyAmplitude(axis, point[2] ?? 0, amplitude, sideSign),
    };
  }
  return { time, value: applyAmplitude(axis, point[1] ?? 0, amplitude, sideSign) };
}

/**
 * Emit one animation from a template, a request and a match.
 *
 * Construction order is fixed: `bones` (bone names in skeleton declaration
 * order, timeline keys in the order `rotate`, `translate`, `translatex`,
 * `translatey`, `scale`), then `slots`, then `events`. Keyframes are sorted
 * by time ascending, `time = round(phase × duration, 4)`, every value goes
 * through {@link applyAmplitude}, the first keyframe's value is always
 * written explicitly even though the reader would default it, and no `curve`
 * field is ever written.
 *
 * No table declares a slot track today, so no `slots` section is written;
 * the key order above is stated because it is the order the reader walks and
 * the order a reviewer should see.
 */
export function emitAnimation(
  template: Template,
  request: EmitRequest,
  match: MatchOk,
): EmittedAnimation {
  const emittedKeys: string[] = [];
  const bones: Record<string, Record<string, unknown>> = {};

  for (const bone of match.usedBones) {
    const tracks = template.tracks.filter((track) => track.bone === bone);
    if (tracks.length === 0) continue;

    const timelines: Record<string, unknown> = {};
    for (const axis of AXIS_ORDER) {
      const track = tracks.find((entry) => entry.axis === axis);
      if (track === undefined) continue;

      timelines[axis] = [...track.points]
        .sort((a, b) => a[0] - b[0])
        .map((point) =>
          keyframeOf(
            axis,
            round(point[0] * request.duration, 4),
            point,
            request.amplitude,
            track.sideSign,
          ),
        );
      if (!emittedKeys.includes(axis)) emittedKeys.push(axis);
    }
    bones[bone] = timelines;
  }

  const animation: Record<string, unknown> = { bones };
  const eventDeclarations: Record<string, unknown> = {};

  if (request.emitEvents && template.events.length > 0) {
    const keyframes = [...template.events]
      .sort((a, b) => a.phase - b.phase)
      .map((event) => ({
        time: round(event.phase * request.duration, 4),
        name: event.name,
      }));
    animation['events'] = keyframes;
    if (!emittedKeys.includes('events')) emittedKeys.push('events');
    for (const event of template.events) {
      eventDeclarations[event.name] = { ...event.declaration };
    }
  }

  return { animation, eventDeclarations, emittedKeys };
}

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

/** What {@link validateEmittedAnimations} counted while checking. */
export interface EmittedValidation {
  animations: number;
  timelines: number;
  keyframes: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `name` values of a declaration array, e.g. `bones` or `slots`. */
function declaredNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((entry) => entry['name'])
    .filter((name): name is string => typeof name === 'string');
}

/** The first non-finite number anywhere in a value, by path. Null when none. */
function firstNonFinite(value: unknown, path: string): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = firstNonFinite(value[index], `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const found = firstNonFinite(entry, `${path}.${key}`);
      if (found !== null) return found;
    }
  }
  return null;
}

function defect(message: string, details?: Record<string, unknown>): SpineResult<never> {
  return err(SpineErrorCode.ValidationFailed, message, GENERATOR_DEFECT_HINT, details);
}

/** Invariants 3, 4, 6 and 7, for one timeline. */
function checkKeyframes(
  path: string,
  frames: unknown,
  spec: TimelineKeySpec,
): { error: SpineResult<never> } | { keyframes: number } {
  if (!Array.isArray(frames) || frames.length === 0) {
    return {
      error: defect(
        `Emitted timeline ${path} is not a non-empty keyframe array. The 4.2 reader skips an empty timeline, so this animation would silently do nothing.`,
      ),
    };
  }

  let previous: number | null = null;
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (!isObject(frame)) {
      return { error: defect(`Emitted keyframe ${path}[${index}] is not an object.`) };
    }

    if ('curve' in frame) {
      return {
        error: defect(
          `Emitted keyframe ${path}[${index}] carries a \`curve\` property. This generator writes linear keyframes only, and omitting \`curve\` is what makes them linear.`,
        ),
      };
    }

    const time = frame['time'];
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      return { error: defect(`Emitted keyframe ${path}[${index}] has no finite \`time\`.`) };
    }
    if (index === 0 && time !== 0) {
      return {
        error: defect(
          `Emitted timeline ${path} starts at time ${time} rather than 0, so the pose is undefined before the first keyframe.`,
        ),
      };
    }
    if (previous !== null && time <= previous) {
      return {
        error: defect(
          `Emitted timeline ${path} has a non-increasing time at keyframe ${index}: ${previous} then ${time}.`,
        ),
      };
    }
    previous = time;

    for (const field of spec.valueFields) {
      if (!(field in frame)) {
        return {
          error: defect(
            `Emitted keyframe ${path}[${index}] is missing the \`${field}\` field its ${spec.key} timeline requires.`,
          ),
        };
      }
    }

    // Invariant 7's value half: a zero or negative scale is a collapsed or
    // reflected bone. `applyAmplitude` makes it unreachable; this is what
    // keeps it unreachable after an edit to the table.
    if (spec.key === 'scale' || spec.key === 'scalex' || spec.key === 'scaley') {
      for (const field of spec.valueFields) {
        const scale = frame[field];
        if (typeof scale !== 'number' || scale <= 0) {
          return {
            error: defect(
              `Emitted keyframe ${path}[${index}] has scale ${field} = ${String(scale)}, which is not greater than zero.`,
            ),
          };
        }
      }
    }
  }

  return { keyframes: frames.length };
}

/**
 * The seven invariants an emitted animation has to satisfy, checked before
 * a single byte is written.
 *
 * Each failure is its own `VALIDATION_FAILED` naming the offending
 * identifier, because every one of them means the generator produced data
 * the runtime would reject — not that the caller did anything wrong.
 *
 * Note that the design text says "six invariants" in its error table; there
 * are seven, and the seventh (scale positivity) is the one that keeps the
 * `applyAmplitude` scale branch honest.
 */
export function validateEmittedAnimations(
  output: Record<string, unknown>,
  emittedKeys: string[],
  emittedNames: string[],
): SpineResult<EmittedValidation> {
  // Table-level half of invariant 7: no `scale` track may be mirrored.
  for (const template of Object.values(TEMPLATES)) {
    for (const track of template.tracks) {
      if (track.axis === 'scale' && track.sideSign === -1) {
        return defect(
          `Template "${template.name}" declares sideSign -1 on the scale track of ${track.bone}. A negative scale is a reflection, not a smaller bone.`,
        );
      }
    }
  }

  // Invariant 2, over the keys the emitter reported writing.
  for (const key of emittedKeys) {
    if (!SPINE_42_TIMELINE_KEYS.some((entry) => entry.key === key)) {
      return defect(
        `Emitted timeline key "${key}" is not in the Spine 4.2 allow-list, so the reader would ignore or reject it.`,
      );
    }
  }

  const declaredBones = new Set(declaredNames(output['bones']));
  const declaredSlots = new Set(declaredNames(output['slots']));
  const declaredEvents = new Set(
    Object.keys(isObject(output['events']) ? output['events'] : {}),
  );
  const animations = isObject(output['animations']) ? output['animations'] : {};

  const counted: EmittedValidation = { animations: 0, timelines: 0, keyframes: 0 };

  for (const name of emittedNames) {
    const animation = animations[name];
    if (!isObject(animation)) {
      return defect(`Emitted animation "${name}" is missing from the output.`);
    }
    counted.animations += 1;

    // Invariant 6, over the whole animation rather than only its value
    // fields: a NaN anywhere in it serialises as `null` and loads as a zero.
    const nonFinite = firstNonFinite(animation, `animations.${name}`);
    if (nonFinite !== null) {
      return defect(`Emitted value ${nonFinite} is not a finite number.`);
    }

    for (const [section, declared, owner] of [
      ['bones', declaredBones, 'bone'],
      ['slots', declaredSlots, 'slot'],
    ] as Array<[string, Set<string>, TimelineOwner]>) {
      const group = animation[section];
      if (group === undefined) continue;
      if (!isObject(group)) {
        return defect(`Emitted \`animations.${name}.${section}\` is not an object.`);
      }

      for (const [subject, timelines] of Object.entries(group)) {
        // Invariant 1: the runtime throws `Bone not found` / `Slot not found`.
        if (!declared.has(subject)) {
          return defect(
            `Emitted animation "${name}" keys ${section} entry "${subject}", which this skeleton does not declare.`,
          );
        }
        if (!isObject(timelines)) {
          return defect(
            `Emitted \`animations.${name}.${section}.${subject}\` is not an object.`,
          );
        }

        for (const [key, frames] of Object.entries(timelines)) {
          // Invariant 2, over what is actually in the output.
          const spec = timelineKeySpec(owner, key);
          if (spec === undefined) {
            return defect(
              `Emitted timeline key "${key}" on ${owner} "${subject}" of animation "${name}" is not a Spine 4.2 ${owner} timeline.`,
            );
          }

          const checked = checkKeyframes(
            `animations.${name}.${section}.${subject}.${key}`,
            frames,
            spec,
          );
          if ('error' in checked) return checked.error;
          counted.timelines += 1;
          counted.keyframes += checked.keyframes;
        }
      }
    }

    // Invariant 5: the reader throws `Event not found` for a keyframe whose
    // name is not declared in the root `events` object.
    const events = animation['events'];
    if (events !== undefined) {
      if (!Array.isArray(events)) {
        return defect(`Emitted \`animations.${name}.events\` is not an array.`);
      }
      const spec = timelineKeySpec('animation', 'events') as TimelineKeySpec;
      const checked = checkKeyframes(`animations.${name}.events`, events, spec);
      if ('error' in checked) return checked.error;
      counted.timelines += 1;
      counted.keyframes += checked.keyframes;

      for (const entry of events) {
        const eventName = isObject(entry) ? entry['name'] : undefined;
        if (typeof eventName !== 'string' || !declaredEvents.has(eventName)) {
          return defect(
            `Emitted animation "${name}" fires event "${String(eventName)}", which the root \`events\` object does not declare.`,
          );
        }
      }
    }
  }

  return ok(
    counted,
    `${counted.animations} emitted animation(s) satisfy all seven invariants: ${counted.timelines} timeline(s), ${counted.keyframes} keyframe(s).`,
  );
}

// ------------------------------------------------------------
// Hash
// ------------------------------------------------------------

/**
 * Recompute `skeleton.hash` over the data that is actually there.
 *
 * `sha1(canonicalJson(output without skeleton.hash and without _generator))`,
 * hex, truncated to the 22 characters Spine and `writer.py` both use, so
 * nothing downstream that compares hash strings has to care about length.
 *
 * It deliberately does NOT try to reproduce `writer.py`'s hash: that would
 * mean replicating Python's `json.dumps` float repr (`1.0` vs `1`) in
 * JavaScript, a cross-language formatting trap for no benefit. What matters
 * is that the hash differs from the input's and changes when the data
 * changes, which this delivers. The algorithm is named in the output as
 * {@link HASH_ALGORITHM} so nobody mistakes it for the editor's.
 */
export function recomputeSkeletonHash(output: Record<string, unknown>): string {
  const projection: Record<string, unknown> = { ...output };
  delete projection['_generator'];

  const skeleton = projection['skeleton'];
  if (isObject(skeleton)) {
    const withoutHash: Record<string, unknown> = { ...skeleton };
    delete withoutHash['hash'];
    projection['skeleton'] = withoutHash;
  }

  return createHash('sha1')
    .update(canonicalJson(projection), 'utf8')
    .digest('hex')
    .slice(0, HASH_LENGTH);
}
