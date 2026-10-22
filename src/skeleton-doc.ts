// ============================================================
// The skeleton document: what a rig *does*, as data.
//
// Pure. The only collaborators are `canonical-json.ts` for the three
// determinism primitives and the readers in `skeleton-data.ts`. Nothing
// here touches the file system, a browser or a pixel: the influence
// section arrives already measured, and every other section is read from
// the skeleton data, so three of the four sections work with no Chromium.
//
// Two structural rules the whole file obeys, because the output is
// committed and reviewed:
//
//  1. Every object is an explicit literal in the order the schema states.
//     No `Object.assign`, no spread of a map, no `Object.keys` iteration
//     building a document object - key order is part of the output.
//  2. Numbers are rounded where they are built, not where they are
//     printed, so the `.json` and the `.md` cannot disagree.
//
// `readBones` is reused for parents, missing parents, duplicate names,
// root count and max depth, so `skeleton_inspect` and `skeleton_document`
// can never disagree about the shape of a rig.
//
// Every non-ASCII character in the emitted Markdown is written as an
// escape sequence, so this source file is pure ASCII and no editor or
// tool can silently re-encode the document's punctuation.
// ============================================================

import { createHash } from 'node:crypto';

import { byCodeUnit, canonicalJson, round } from './canonical-json';
import {
  AnimationSummary,
  BoneSummary,
  SkeletonMeta,
  findNonessentialMarkers,
  readAnimation,
  readBones,
  readMeta,
  readSkinsAndAttachments,
  readSlots,
} from './skeleton-data';

type Json = Record<string, unknown>;

/** Em dash, middle dot, arrow and degree sign, as used in the Markdown. */
const DASH = '\u2014';
const DOT = '\u00b7';
const ARROW = '\u2192';
const DEGREE = '\u00b0';

/** Box-drawing pieces for the bone tree. */
const TREE_LAST = '\u2514\u2500\u2500 ';
const TREE_MID = '\u251c\u2500\u2500 ';
const TREE_PIPE = '\u2502   ';

/** Version stamped into `generator.version`. Matches the package version. */
export const DOCUMENT_GENERATOR_VERSION = '0.1.0';

/** Name stamped into `generator.tool`. */
export const DOCUMENT_GENERATOR_TOOL = 'kiro-spine2d-power/skeleton_document';

/**
 * Keyframes listed per animation for `events` and `attachmentSwitches`.
 *
 * Those two lists are `O(keyframes)` rather than `O(bones)`, so a
 * 500-event animation would make the document unreviewable. The retained
 * entries are the earliest ones, and the overflow is reported as a count.
 */
export const MAX_DOC_KEYFRAMES = 64;

/** Influenced slots listed per probe, with the overflow as a count. */
export const MAX_INFLUENCED_SLOTS = 12;

/** Entries in a loopability mismatch list, and in `mostActiveBones`. */
export const MAX_DOC_LIST_ITEMS = 8;

// ------------------------------------------------------------
// Shared vocabulary
// ------------------------------------------------------------

/** How much of the canvas one bone's perturbation moved. */
export type InfluenceBucket = 'none' | 'slight' | 'moderate' | 'strong';

/** Which perturbations the probe plan applies to each bone. */
export type ProbeMode = 'off' | 'rotate' | 'full';

/** One local-transform axis a probe perturbs. */
export type ProbeAxis = 'rotate' | 'translateX' | 'translateY';

/** Fractions at the bucket boundaries, reported in every document. */
export const BUCKET_THRESHOLDS = { slightFraction: 0.005, moderateFraction: 0.05 };

/** The five inheritance modes `Bone.inherit` accepts, in lower-camel form. */
export const BONE_MODES = [
  'normal',
  'onlyTranslation',
  'noRotationOrReflection',
  'noScale',
  'noScaleOrReflection',
] as const;

// ------------------------------------------------------------
// Document types
// ------------------------------------------------------------

/**
 * The complete defect set. Every field exists in every document and is
 * empty when there is nothing to report, so a reader never has to tell
 * "absent" from "clean". No section may add a field that is not here.
 */
export interface DocumentDefects {
  multipleRoots: boolean;
  rootCount: number;
  missingParents: string[];
  cyclicBones: string[];
  duplicateBoneNames: string[];
  duplicateSlotNames: string[];
  danglingSlotBones: string[];
  slotsWithoutAttachments: string[];
  boneModeKeyMismatches: string[];
  danglingConstraintRefs: string[];
  danglingPathTargets: string[];
  undeclaredEventRefs: string[];
}

/** Setup-pose local transform of one bone, with the reader's defaults applied. */
export interface BoneLocal {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  length: number;
}

/** Derived world transform. An affine approximation; see the document notes. */
export interface BoneWorld {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Which key declared the inheritance mode, and whether 4.2 honours it. */
export interface BoneMode {
  value: string;
  declaredKey: 'inherit' | 'transform' | null;
  runtimeHonoursIt: boolean;
}

/** One bone, in skeleton declaration order. */
export interface BoneDoc {
  name: string;
  parent: string | null;
  depth: number;
  children: string[];
  local: BoneLocal;
  world: BoneWorld;
  mode: BoneMode;
  slots: string[];
  constraints: string[];
  probe: { bucket: InfluenceBucket; noVisibleEffect: boolean } | null;
}

export interface IkConstraintDoc {
  name: string;
  order: number;
  skin: boolean;
  bones: string[];
  target: string | null;
  mix: number;
  softness: number;
  bendPositive: boolean;
  compress: boolean;
  stretch: boolean;
  uniform: boolean;
}

export interface TransformConstraintDoc {
  name: string;
  order: number;
  skin: boolean;
  bones: string[];
  target: string | null;
  mixRotate: number;
  mixX: number;
  mixY: number;
  mixScaleX: number;
  mixScaleY: number;
  mixShearY: number;
  rotation: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  shearY: number;
  local: boolean;
  relative: boolean;
}

export interface PathConstraintDoc {
  name: string;
  order: number;
  skin: boolean;
  bones: string[];
  /** The declared target, which is a *slot* name for a path constraint. */
  target: string | null;
  /** The bone that slot is bound to, or null when it cannot be resolved. */
  targetBone: string | null;
  positionMode: string;
  spacingMode: string;
  rotateMode: string;
  rotation: number;
  position: number;
  spacing: number;
  mixRotate: number;
  mixX: number;
  mixY: number;
}

export interface PhysicsConstraintDoc {
  name: string;
  order: number;
  skin: boolean;
  bone: string | null;
  x: number;
  y: number;
  rotate: number;
  scaleX: number;
  shearX: number;
  limit: number;
  step: number;
  inertia: number;
  strength: number;
  damping: number;
  massInverse: number;
  wind: number;
  gravity: number;
  mix: number;
}

/** One entry of the inverted index: what this bone takes part in. */
export interface ConstraintRef {
  kind: 'ik' | 'transform' | 'path' | 'physics';
  name: string;
  role: 'constrained' | 'target';
  /** Set only for a path constraint's target entry. */
  targetSlot: string | null;
  /** Set only for a path constraint's target entry. */
  targetBone: string | null;
}

/** Constraints, per kind and inverted per bone. */
export interface ConstraintIndex {
  ik: IkConstraintDoc[];
  transform: TransformConstraintDoc[];
  path: PathConstraintDoc[];
  physics: PhysicsConstraintDoc[];
  byBone: Record<string, ConstraintRef[]>;
  /** `"<constraint>:<bone>"` for a bone the skeleton does not declare. */
  danglingConstraintRefs: string[];
  /** `"<constraint>:<slot>"` for a path target that cannot be resolved. */
  danglingPathTargets: string[];
}

export interface InfluenceSlotDoc {
  slot: string;
  changedPixels: number;
  changedFraction: number;
  bucket: InfluenceBucket;
  attachments: string[];
}

export interface InfluenceBoneDoc {
  bone: string;
  axis: ProbeAxis;
  delta: number;
  changedPixels: number;
  totalPixels: number;
  changedFraction: number;
  bucket: InfluenceBucket;
  maxChannelDelta: number;
  noVisibleEffect: boolean;
  slots: InfluenceSlotDoc[];
  slotsTruncated: number;
  unattributedPixels: number;
  unattributedFraction: number;
}

/** The measured influence section, or its honest absence. */
export interface InfluenceDoc {
  available: boolean;
  /** Why it is absent, in the first six words. Null when it is present. */
  reason: string | null;
  mode: ProbeMode;
  canvas: { width: number; height: number } | null;
  perturbation: {
    rotationDegrees: number;
    translateFraction: number;
    translateUnits: number;
  };
  thresholds: {
    channelTolerance: number;
    slightFraction: number;
    moderateFraction: number;
  };
  probesPlanned: number;
  probesPerformed: number;
  environment: { launchArgs: string[]; useGl: string | null };
  /** The camera rectangle every fraction here is relative to. */
  framing: {
    x: number;
    y: number;
    width: number;
    height: number;
    padding: number;
    fromPoses: number;
  } | null;
  warnings: string[];
  bones: InfluenceBoneDoc[];
}

export interface AnimationDoc {
  name: string;
  duration: number;
  timelineCount: number;
  keyframeCount: number;
  groups: Record<string, number>;
  loopable: { value: boolean; inferred: true; method: string; mismatches: string[] };
  generatorIntendedLoop: boolean | null;
  rootMotion: {
    bone: string | null;
    netTranslate: { x: number; y: number };
    locomotive: boolean;
  };
  mostActiveBones: Array<{ bone: string; score: number }>;
  activityMeasure: string;
  animatedBones: string[];
  animatedSlots: string[];
  attachmentSwitches: Array<{ slot: string; time: number; to: string | null }>;
  attachmentSwitchesTruncated: number;
  events: Array<{
    name: string;
    time: number;
    int: number | null;
    float: number | null;
    string: string | null;
  }>;
  eventsTruncated: number;
}

/** The whole document, in the order it is serialised. */
export interface SkeletonDocument {
  schema: 1;
  kind: 'spine-skeleton-document';
  /** ISO-8601. The only field that differs between two runs over one input. */
  generatedAt: string;
  generator: { tool: string; version: string };
  source: {
    skeletonFile: string;
    atlasFile: string | null;
    spineVersion: string | null;
    skeletonHash: string | null;
    fingerprint: string;
    hashNote: string;
  };
  summary: {
    boneCount: number;
    rootCount: number;
    maxDepth: number;
    slotCount: number;
    skinCount: number;
    attachmentCount: number;
    constraintCount: number;
    eventCount: number;
    animationCount: number;
    weightedMeshCount: number;
    deadBones: string[];
    unprobedBones: string[];
    nonessential: boolean;
  };
  defects: DocumentDefects;
  hierarchy: { roots: string[]; bones: BoneDoc[] };
  constraints: ConstraintIndex;
  influence: InfluenceDoc;
  animations: AnimationDoc[];
  notes: string[];
}

// ------------------------------------------------------------
// Local reader helpers
//
// Deliberately private copies of the three-line coercions in
// `skeleton-data.ts`: that module does not export them, and importing it
// more deeply than its readers would couple two files that only need to
// agree on results.
// ------------------------------------------------------------

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objects(value: unknown): Json[] {
  return asArray(value).filter(isObject);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function section(root: Json, key: string): Json {
  return isObject(root[key]) ? root[key] : {};
}

/** Degrees to radians, for the derived world transform. */
const DEG = Math.PI / 180;

// ------------------------------------------------------------
// Section 1 - bone hierarchy with setup-pose and derived world transforms
// ------------------------------------------------------------

/** One bone's geometry, before slots, constraints and probes are attached. */
export interface BoneGeometryEntry {
  name: string;
  parent: string | null;
  depth: number;
  children: string[];
  local: BoneLocal;
  world: BoneWorld;
  mode: BoneMode;
  /** True when `parent` names a bone the skeleton does not declare. */
  detached: boolean;
  /** True when this bone's own ancestor chain revisits it. */
  cyclic: boolean;
}

export interface BoneGeometry {
  /** `readBones`' answer, reused verbatim so the two tools cannot disagree. */
  summary: BoneSummary;
  /** Bones with no declared parent at all, in declaration order. */
  roots: string[];
  bones: BoneGeometryEntry[];
  cyclicBones: string[];
  boneModeKeyMismatches: string[];
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toLowerCase() + value.slice(1);
}

/** Resolve `inherit`, falling back to the pre-4.2 `transform` key. */
function readBoneMode(bone: Json, name: string, mismatches: string[]): BoneMode {
  const inherit = asString(bone['inherit']);
  const legacy = asString(bone['transform']);

  const normalise = (declared: string): string => {
    const camel = lowerFirst(declared);
    return (BONE_MODES as readonly string[]).includes(camel) ? camel : declared;
  };

  if (inherit !== null) {
    const value = normalise(inherit);
    return {
      value,
      declaredKey: 'inherit',
      runtimeHonoursIt: (BONE_MODES as readonly string[]).includes(value),
    };
  }

  if (legacy !== null) {
    const value = normalise(legacy);
    // spine-core 4.2.120 reads only `inherit`, so this mode is inert at
    // runtime. Only a non-default legacy value is worth a defect line:
    // `transform: "normal"` and no key at all behave identically.
    if (value !== 'normal') mismatches.push(`${name}:transform=${legacy}`);
    return { value, declaredKey: 'transform', runtimeHonoursIt: false };
  }

  return { value: 'normal', declaredKey: null, runtimeHonoursIt: true };
}

function readBoneLocal(bone: Json): BoneLocal {
  // Defaults are the pinned reader's `getValue(boneMap, key, default)` calls.
  return {
    x: round(num(bone['x'], 0), 3),
    y: round(num(bone['y'], 0), 3),
    rotation: round(num(bone['rotation'], 0), 3),
    scaleX: round(num(bone['scaleX'], 1), 3),
    scaleY: round(num(bone['scaleY'], 1), 3),
    shearX: round(num(bone['shearX'], 0), 3),
    shearY: round(num(bone['shearY'], 0), 3),
    length: round(num(bone['length'], 0), 3),
  };
}

/** A bone that anchors its own chain: world transform equals its local one. */
function anchoredWorld(local: BoneLocal): BoneWorld {
  return {
    x: local.x,
    y: local.y,
    rotation: local.rotation,
    scaleX: local.scaleX,
    scaleY: local.scaleY,
  };
}

/**
 * Parse the `bones` array for per-bone transforms and derive world ones.
 *
 * The world transform is composed in Node, parent-first, so this section
 * works with the browser absent. It is an affine approximation of
 * `Bone.updateWorldTransform`: shear is recorded but not composed, and
 * reflection is not handled. The measured influence section, not this one,
 * is the authority on what actually moves.
 *
 * Two broken-hierarchy cases are decided here rather than left to a
 * caller, because the document has to be byte-identical across runs:
 *
 *  - A bone whose `parent` names an undeclared bone is a *detached root*
 *    for geometry: `world = local`, `depth = 1`, and `parent` keeps the
 *    declared name, because the document reports what the file says. It is
 *    not in `roots` and not counted in `rootCount`.
 *  - A bone whose ancestor chain revisits it gets the same treatment and
 *    its name in `cyclicBones`. `readBones` breaks such a chain with a
 *    guard set but never records which bones it broke, so the walk is run
 *    again here.
 */
export function readBoneGeometry(root: Json): BoneGeometry {
  const summary = readBones(root);
  const declared = objects(root['bones']).filter(
    (bone) => asString(bone['name']) !== null,
  );
  const names = declared.map((bone) => asString(bone['name']) as string);
  const declaredNames = new Set(names);

  // Last-wins, exactly as `readBones` builds its own parent map, so a
  // duplicate name resolves the same way in both.
  const parentOf = new Map<string, string | null>();
  const boneOf = new Map<string, Json>();
  for (const [index, bone] of declared.entries()) {
    parentOf.set(names[index]!, asString(bone['parent']));
    boneOf.set(names[index]!, bone);
  }

  const cyclic = new Set<string>();
  for (const name of names) {
    const guard = new Set<string>();
    let cursor: string | null = parentOf.get(name) ?? null;
    while (cursor !== null && !guard.has(cursor)) {
      if (cursor === name) {
        cyclic.add(name);
        break;
      }
      guard.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  const mismatches: string[] = [];
  const modeOf = new Map<string, BoneMode>();
  for (const name of names) {
    modeOf.set(name, readBoneMode(boneOf.get(name) as Json, name, mismatches));
  }

  const childrenOf = new Map<string, string[]>();
  for (const name of names) {
    const parent = parentOf.get(name) ?? null;
    if (parent === null) continue;
    const list = childrenOf.get(parent);
    if (list === undefined) childrenOf.set(parent, [name]);
    else if (!list.includes(name)) list.push(name);
  }

  /** Compose one local transform onto a parent's world transform. */
  const compose = (local: BoneLocal, mode: string, parent: BoneWorld): BoneWorld => {
    const inheritsScale =
      mode !== 'noScale' && mode !== 'noScaleOrReflection' && mode !== 'onlyTranslation';
    const inheritsRotation =
      mode !== 'onlyTranslation' && mode !== 'noRotationOrReflection';
    const radians = parent.rotation * DEG;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const lx = local.x * parent.scaleX;
    const ly = local.y * parent.scaleY;
    return {
      x: round(parent.x + lx * cos - ly * sin, 3),
      y: round(parent.y + lx * sin + ly * cos, 3),
      rotation: round(
        inheritsRotation ? parent.rotation + local.rotation : local.rotation,
        3,
      ),
      scaleX: round(inheritsScale ? parent.scaleX * local.scaleX : local.scaleX, 3),
      scaleY: round(inheritsScale ? parent.scaleY * local.scaleY : local.scaleY, 3),
    };
  };

  const resolved = new Map<string, { depth: number; world: BoneWorld }>();

  /**
   * Depth and world transform for one declared name.
   *
   * Terminates on any input: a cyclic bone, a detached bone and a real
   * root all anchor their own chain, so walking upward always reaches one.
   */
  const resolve = (name: string): { depth: number; world: BoneWorld } => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;

    const local = readBoneLocal(boneOf.get(name) as Json);
    const parent = parentOf.get(name) ?? null;

    let answer: { depth: number; world: BoneWorld };
    if (parent === null || !declaredNames.has(parent) || cyclic.has(name)) {
      answer = { depth: 1, world: anchoredWorld(local) };
    } else {
      const up = resolve(parent);
      answer = {
        depth: up.depth + 1,
        world: compose(local, modeOf.get(name)?.value ?? 'normal', up.world),
      };
    }

    resolved.set(name, answer);
    return answer;
  };

  const bones: BoneGeometryEntry[] = declared.map((bone) => {
    const name = asString(bone['name']) as string;
    const local = readBoneLocal(bone);
    const parent = asString(bone['parent']);
    const detached = parent !== null && !declaredNames.has(parent);
    const isCyclic = cyclic.has(name);
    const mode = modeOf.get(name) as BoneMode;

    let depth = 1;
    let world = anchoredWorld(local);
    if (parent !== null && !detached && !isCyclic) {
      const up = resolve(parent);
      depth = up.depth + 1;
      world = compose(local, mode.value, up.world);
    }

    return {
      name,
      parent,
      depth,
      children: [...(childrenOf.get(name) ?? [])],
      local,
      world,
      mode,
      detached,
      cyclic: isCyclic,
    };
  });

  return {
    summary,
    // Derived with the same predicate `rootCount` counts, so the list and
    // the number cannot disagree. A detached bone's parent is the declared
    // (missing) name rather than null, so it appears in neither.
    roots: names.filter((name) => (parentOf.get(name) ?? null) === null),
    bones,
    cyclicBones: [...cyclic].sort(byCodeUnit),
    boneModeKeyMismatches: [...new Set(mismatches)].sort(byCodeUnit),
  };
}

// ------------------------------------------------------------
// Section 2b - constraint following, read from data
// ------------------------------------------------------------

const KIND_ORDER: Record<ConstraintRef['kind'], number> = {
  ik: 0,
  transform: 1,
  path: 2,
  physics: 3,
};

/**
 * Walk the four raw constraint sections and build the inverted index.
 *
 * `readConstraints` in `skeleton-data.ts` returns names only, which cannot
 * answer "what follows what", so the records are read here. Resolution is
 * structural and never probed: a probe sees that two things moved
 * together, which cannot distinguish "follows via IK" from "happens to
 * overlap on screen", and the data states the answer exactly. This section
 * therefore works with `probeMode: 'off'`.
 */
export function resolveConstraintsByBone(root: Json): ConstraintIndex {
  const boneNames = new Set(
    objects(root['bones'])
      .map((bone) => asString(bone['name']))
      .filter((name): name is string => name !== null),
  );
  const slotBone = new Map<string, string | null>();
  for (const slot of objects(root['slots'])) {
    const name = asString(slot['name']);
    if (name !== null) slotBone.set(name, asString(slot['bone']));
  }

  const danglingConstraintRefs: string[] = [];
  const danglingPathTargets: string[] = [];

  /** The `order` each entry sorts by is kept here, not in the document. */
  const index = new Map<string, Array<{ order: number; ref: ConstraintRef }>>();

  const record = (
    bone: string,
    kind: ConstraintRef['kind'],
    name: string,
    order: number,
    role: ConstraintRef['role'],
    targetSlot: string | null = null,
    targetBone: string | null = null,
  ): void => {
    const entry = { order, ref: { kind, name, role, targetSlot, targetBone } };
    const list = index.get(bone);
    if (list === undefined) index.set(bone, [entry]);
    else list.push(entry);
  };

  const constrainedBones = (
    entry: Json,
    kind: ConstraintRef['kind'],
    name: string,
    order: number,
  ): string[] => {
    const list = asArray(entry['bones'])
      .map((value) => asString(value))
      .filter((value): value is string => value !== null);
    for (const bone of list) {
      if (!boneNames.has(bone)) {
        danglingConstraintRefs.push(`${name}:${bone}`);
        continue;
      }
      record(bone, kind, name, order, 'constrained');
    }
    return list;
  };

  const targetBoneOf = (
    entry: Json,
    kind: 'ik' | 'transform',
    name: string,
    order: number,
  ): string | null => {
    const target = asString(entry['target']);
    if (target === null) return null;
    if (!boneNames.has(target)) {
      danglingConstraintRefs.push(`${name}:${target}`);
      return target;
    }
    record(target, kind, name, order, 'target');
    return target;
  };

  const ik: IkConstraintDoc[] = objects(root['ik']).map((entry) => {
    const name = asString(entry['name']) ?? '';
    const order = num(entry['order'], 0);
    const bones = constrainedBones(entry, 'ik', name, order);
    const target = targetBoneOf(entry, 'ik', name, order);
    return {
      name,
      order,
      skin: bool(entry['skin'], false),
      bones,
      target,
      mix: round(num(entry['mix'], 1), 3),
      softness: round(num(entry['softness'], 0), 3),
      bendPositive: bool(entry['bendPositive'], true),
      compress: bool(entry['compress'], false),
      stretch: bool(entry['stretch'], false),
      uniform: bool(entry['uniform'], false),
    };
  });

  const transform: TransformConstraintDoc[] = objects(root['transform']).map((entry) => {
    const name = asString(entry['name']) ?? '';
    const order = num(entry['order'], 0);
    const bones = constrainedBones(entry, 'transform', name, order);
    const target = targetBoneOf(entry, 'transform', name, order);
    return {
      name,
      order,
      skin: bool(entry['skin'], false),
      bones,
      target,
      mixRotate: round(num(entry['mixRotate'], 1), 3),
      mixX: round(num(entry['mixX'], 1), 3),
      mixY: round(num(entry['mixY'], num(entry['mixX'], 1)), 3),
      mixScaleX: round(num(entry['mixScaleX'], 1), 3),
      mixScaleY: round(num(entry['mixScaleY'], num(entry['mixScaleX'], 1)), 3),
      mixShearY: round(num(entry['mixShearY'], 1), 3),
      rotation: round(num(entry['rotation'], 0), 3),
      x: round(num(entry['x'], 0), 3),
      y: round(num(entry['y'], 0), 3),
      scaleX: round(num(entry['scaleX'], 0), 3),
      scaleY: round(num(entry['scaleY'], 0), 3),
      shearY: round(num(entry['shearY'], 0), 3),
      local: bool(entry['local'], false),
      relative: bool(entry['relative'], false),
    };
  });

  const path: PathConstraintDoc[] = objects(root['path']).map((entry) => {
    const name = asString(entry['name']) ?? '';
    const order = num(entry['order'], 0);
    const bones = constrainedBones(entry, 'path', name, order);
    const target = asString(entry['target']);

    // A path constraint targets a SLOT, and three things can be wrong with
    // it. The declared slot may be missing entirely (the repo's own
    // RICH_SKELETON does exactly this), or declared with a bone that is
    // null or undeclared. All three answer the same way: no `target`
    // entry, `targetBone: null`, and one line in `danglingPathTargets`.
    // That list is separate from `danglingConstraintRefs` because this
    // defect is about a slot, and mixing the two makes both harder to read.
    let targetBone: string | null = null;
    if (target !== null) {
      const bone = slotBone.has(target) ? (slotBone.get(target) ?? null) : null;
      if (bone !== null && boneNames.has(bone)) {
        targetBone = bone;
        record(bone, 'path', name, order, 'target', target, bone);
      } else {
        danglingPathTargets.push(`${name}:${target}`);
      }
    }

    return {
      name,
      order,
      skin: bool(entry['skin'], false),
      bones,
      target,
      targetBone,
      positionMode: asString(entry['positionMode']) ?? 'percent',
      spacingMode: asString(entry['spacingMode']) ?? 'length',
      rotateMode: asString(entry['rotateMode']) ?? 'tangent',
      rotation: round(num(entry['rotation'], 0), 3),
      position: round(num(entry['position'], 0), 3),
      spacing: round(num(entry['spacing'], 0), 3),
      mixRotate: round(num(entry['mixRotate'], 1), 3),
      mixX: round(num(entry['mixX'], 1), 3),
      mixY: round(num(entry['mixY'], num(entry['mixX'], 1)), 3),
    };
  });

  const physics: PhysicsConstraintDoc[] = objects(root['physics']).map((entry) => {
    const name = asString(entry['name']) ?? '';
    const order = num(entry['order'], 0);
    const bone = asString(entry['bone']);
    if (bone !== null) {
      if (boneNames.has(bone)) record(bone, 'physics', name, order, 'constrained');
      else danglingConstraintRefs.push(`${name}:${bone}`);
    }
    return {
      name,
      order,
      skin: bool(entry['skin'], false),
      bone,
      x: round(num(entry['x'], 0), 3),
      y: round(num(entry['y'], 0), 3),
      rotate: round(num(entry['rotate'], 0), 3),
      scaleX: round(num(entry['scaleX'], 0), 3),
      shearX: round(num(entry['shearX'], 0), 3),
      limit: round(num(entry['limit'], 5000), 3),
      step: round(num(entry['step'], 1 / 60), 4),
      inertia: round(num(entry['inertia'], 1), 3),
      strength: round(num(entry['strength'], 100), 3),
      damping: round(num(entry['damping'], 1), 3),
      massInverse: round(num(entry['massInverse'], 1), 3),
      wind: round(num(entry['wind'], 0), 3),
      gravity: round(num(entry['gravity'], 0), 3),
      mix: round(num(entry['mix'], 1), 3),
    };
  });

  const byBone: Record<string, ConstraintRef[]> = {};
  for (const bone of [...index.keys()].sort(byCodeUnit)) {
    byBone[bone] = (index.get(bone) ?? [])
      .slice()
      .sort(
        (a, b) =>
          a.order - b.order ||
          KIND_ORDER[a.ref.kind] - KIND_ORDER[b.ref.kind] ||
          byCodeUnit(a.ref.name, b.ref.name),
      )
      .map((entry) => entry.ref);
  }

  return {
    ik,
    transform,
    path,
    physics,
    byBone,
    danglingConstraintRefs: [...new Set(danglingConstraintRefs)].sort(byCodeUnit),
    danglingPathTargets: [...new Set(danglingPathTargets)].sort(byCodeUnit),
  };
}

// ------------------------------------------------------------
// Section 3 - per-animation motion profile
// ------------------------------------------------------------

/** The loopability rule, stated in every document rather than implied. */
export const LOOPABILITY_METHOD =
  "every bone and slot timeline's first and last keyframe values agree within 0.001";

/** The activity measure, stated in every document so the ranking is checkable. */
export const ACTIVITY_MEASURE =
  'sum of absolute differences between consecutive keyframe values, per timeline, ' +
  'with rotation in degrees, translation in skeleton units divided by 10, and ' +
  'scale/shear in hundredths';

/** Tolerance for "the first and last keyframe agree" on a numeric field. */
const LOOP_TOLERANCE = 1e-3;

/** Value fields a keyframe can carry, across the 4.2 bone and slot timelines. */
const VALUE_KEYS = ['value', 'x', 'y', 'name', 'color', 'light', 'dark'] as const;

function isKeyframeArray(value: unknown): value is Json[] {
  return Array.isArray(value) && value.length > 0 && value.every(isObject);
}

/** True when the first and last keyframe of one timeline agree. */
function timelineAgrees(frames: Json[]): boolean {
  const first = frames[0] as Json;
  const last = frames[frames.length - 1] as Json;

  for (const key of VALUE_KEYS) {
    const a = first[key];
    const b = last[key];
    if (a === undefined && b === undefined) continue;
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > LOOP_TOLERANCE) return false;
      continue;
    }
    // Attachment names and colour strings compare strictly: `null` is a
    // real value meaning "hide", and it is not 0.001 away from anything.
    if ((a ?? null) !== (b ?? null)) return false;
  }

  return true;
}

/** Per-timeline activity, on the scale `ACTIVITY_MEASURE` describes. */
function timelineActivity(timeline: string, frames: Json[]): number {
  const divisor = timeline.startsWith('translate')
    ? 10
    : timeline.startsWith('scale') || timeline.startsWith('shear')
      ? 0.01
      : 1;

  let total = 0;
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1] as Json;
    const current = frames[i] as Json;
    for (const key of ['value', 'x', 'y'] as const) {
      const a = previous[key];
      const b = current[key];
      if (typeof a === 'number' && typeof b === 'number') {
        total += Math.abs(b - a) / divisor;
      }
    }
  }
  return total;
}

/** Net translation of one timeline, last keyframe minus first. */
function netOf(frames: Json[], key: 'value' | 'x' | 'y'): number {
  const first = frames[0] as Json;
  const last = frames[frames.length - 1] as Json;
  const a = first[key];
  const b = last[key];
  if (typeof a !== 'number' || typeof b !== 'number') return 0;
  return b - a;
}

/** Extra facts `motionProfile` needs that the animation object does not carry. */
export interface MotionContext {
  /** `readAnimation`'s answer, reused for duration and the three counts. */
  summary: AnimationSummary;
  /** The single parentless bone, or null when `rootCount !== 1`. */
  rootBone: string | null;
  /** Event names declared in the root `events` section. */
  declaredEvents: Set<string>;
  /** The author's own `intendedLoop`, when a `_generator` record states one. */
  generatorIntendedLoop: boolean | null;
}

/** What one animation does, beyond the counts `readAnimation` reports. */
export function motionProfile(
  name: string,
  animation: unknown,
  context: MotionContext,
): { doc: AnimationDoc; undeclaredEventRefs: string[] } {
  const root = isObject(animation) ? animation : {};
  const bones = section(root, 'bones');
  const slots = section(root, 'slots');

  const mismatches: string[] = [];
  const activity = new Map<string, number>();

  for (const [bone, timelines] of Object.entries(bones)) {
    if (!isObject(timelines)) continue;
    for (const [timeline, frames] of Object.entries(timelines)) {
      if (!isKeyframeArray(frames)) continue;
      // The identifier is a path, not a dotted pair: slot timelines take
      // part in this heuristic too, and RICH_SKELETON declares both a bone
      // and a slot named `head`, so `head.attachment` would be ambiguous.
      if (!timelineAgrees(frames)) mismatches.push(`bones/${bone}/${timeline}`);
      const score = timelineActivity(timeline, frames);
      if (score > 0) activity.set(bone, (activity.get(bone) ?? 0) + score);
    }
  }

  const attachmentSwitches: Array<{ slot: string; time: number; to: string | null }> = [];

  for (const [slot, timelines] of Object.entries(slots)) {
    if (!isObject(timelines)) continue;
    for (const [timeline, frames] of Object.entries(timelines)) {
      if (!isKeyframeArray(frames)) continue;
      if (!timelineAgrees(frames)) mismatches.push(`slots/${slot}/${timeline}`);
      if (timeline !== 'attachment') continue;
      for (const frame of frames) {
        attachmentSwitches.push({
          slot,
          time: round(num(frame['time'], 0), 4),
          to: asString(frame['name']),
        });
      }
    }
  }

  attachmentSwitches.sort((a, b) => a.time - b.time || byCodeUnit(a.slot, b.slot));

  const eventFrames = isKeyframeArray(root['events']) ? root['events'] : [];
  const undeclaredEventRefs: string[] = [];
  const events = eventFrames
    .map((frame) => {
      const eventName = asString(frame['name']) ?? '';
      if (eventName.length > 0 && !context.declaredEvents.has(eventName)) {
        // The runtime throws `Event not found` on such a file, so this is
        // worth a line rather than a silent pass.
        undeclaredEventRefs.push(`${name}:${eventName}`);
      }
      return {
        name: eventName,
        time: round(num(frame['time'], 0), 4),
        int: typeof frame['int'] === 'number' ? frame['int'] : null,
        float: typeof frame['float'] === 'number' ? frame['float'] : null,
        string: asString(frame['string']),
      };
    })
    .sort((a, b) => a.time - b.time || byCodeUnit(a.name, b.name));

  // Root motion separates a walk cycle that travels from one that marches
  // in place: last keyframe minus first, per axis independently, so a
  // `translatex`-only animation still reports.
  let netX = 0;
  let netY = 0;
  if (context.rootBone !== null) {
    const timelines = isObject(bones[context.rootBone])
      ? (bones[context.rootBone] as Json)
      : {};
    const translate = timelines['translate'];
    if (isKeyframeArray(translate)) {
      netX += netOf(translate, 'x');
      netY += netOf(translate, 'y');
    }
    const translateX = timelines['translatex'];
    if (isKeyframeArray(translateX)) netX += netOf(translateX, 'value');
    const translateY = timelines['translatey'];
    if (isKeyframeArray(translateY)) netY += netOf(translateY, 'value');
  }

  const mostActiveBones = [...activity.entries()]
    .map(([bone, score]) => ({ bone, score: round(score, 2) }))
    .sort((a, b) => b.score - a.score || byCodeUnit(a.bone, b.bone))
    .slice(0, MAX_DOC_LIST_ITEMS);

  const doc: AnimationDoc = {
    name,
    duration: round(context.summary.duration, 4),
    timelineCount: context.summary.timelineCount,
    keyframeCount: context.summary.keyframeCount,
    groups: context.summary.groups,
    loopable: {
      value: mismatches.length === 0,
      // Spine skeleton data stores no loop flag, so this is inferred and
      // the Markdown never says "loops" without saying "(inferred)".
      inferred: true,
      method: LOOPABILITY_METHOD,
      mismatches: [...new Set(mismatches)].sort(byCodeUnit).slice(0, MAX_DOC_LIST_ITEMS),
    },
    generatorIntendedLoop: context.generatorIntendedLoop,
    rootMotion: {
      bone: context.rootBone,
      netTranslate: { x: round(netX, 3), y: round(netY, 3) },
      locomotive: Math.hypot(netX, netY) > 0.5,
    },
    mostActiveBones,
    activityMeasure: ACTIVITY_MEASURE,
    animatedBones: [...context.summary.animatedBones].sort(byCodeUnit),
    animatedSlots: Object.keys(slots).sort(byCodeUnit),
    attachmentSwitches: attachmentSwitches.slice(0, MAX_DOC_KEYFRAMES),
    attachmentSwitchesTruncated: Math.max(
      0,
      attachmentSwitches.length - MAX_DOC_KEYFRAMES,
    ),
    events: events.slice(0, MAX_DOC_KEYFRAMES),
    eventsTruncated: Math.max(0, events.length - MAX_DOC_KEYFRAMES),
  };

  return { doc, undeclaredEventRefs };
}

/** The author's own loop intent for one animation, when the file records it. */
export function generatorIntendedLoop(root: Json, animation: string): boolean | null {
  const generator = section(root, '_generator');
  for (const entry of objects(generator['templates'])) {
    if (asString(entry['animation']) !== animation) continue;
    return typeof entry['intendedLoop'] === 'boolean' ? entry['intendedLoop'] : null;
  }
  return null;
}

// ------------------------------------------------------------
// Staleness
// ------------------------------------------------------------

/** Characters of the sha256 hex digest kept as the fingerprint. */
const FINGERPRINT_LENGTH = 24;

/**
 * A content fingerprint over what actually changes behaviour.
 *
 * `skeleton.hash` is not enough on its own: this repository's own demo
 * output has two files that share one hash while differing by two whole
 * animations, because the hash was not recomputed after the animations
 * were added. So the document carries both.
 *
 * Deliberately excluded from the projection: `skeleton.hash` itself (so
 * the fingerprint is independent of it), `skeleton.images`,
 * `skeleton.audio`, `fps`, `_generator`, bone `color`/`icon`/`visible`,
 * mesh `edges`, float formatting and key order. Two semantically identical
 * re-exports therefore fingerprint the same.
 */
export function fingerprintSkeleton(root: Json): string {
  const geometry = readBoneGeometry(root);
  const bones = geometry.bones.map((bone) => ({
    name: bone.name,
    parent: bone.parent,
    x: bone.local.x,
    y: bone.local.y,
    rotation: bone.local.rotation,
    scaleX: bone.local.scaleX,
    scaleY: bone.local.scaleY,
    shearX: bone.local.shearX,
    shearY: bone.local.shearY,
    length: bone.local.length,
    inherit: bone.mode.value,
  }));

  const slots = objects(root['slots']).map((slot) => ({
    name: asString(slot['name']),
    bone: asString(slot['bone']),
    attachment: asString(slot['attachment']),
    blend: asString(slot['blend']) ?? 'normal',
  }));

  const slotNames = slots
    .map((slot) => slot.name)
    .filter((name): name is string => name !== null);
  const { attachments } = readSkinsAndAttachments(root, slotNames);
  const skins: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const entry of attachments.entries) {
    const bySlot = (skins[entry.skin] ??= {});
    const byKey = (bySlot[entry.slot] ??= {});
    byKey[entry.key] = { type: entry.type, regionKey: entry.regionKey };
  }

  const constraints = resolveConstraintsByBone(root);

  const events: Record<string, unknown> = {};
  for (const [name, event] of Object.entries(section(root, 'events'))) {
    const declared = isObject(event) ? event : {};
    events[name] = {
      int: num(declared['int'], 0),
      float: num(declared['float'], 0),
      string: asString(declared['string']),
    };
  }

  const animations: Record<string, Array<{ path: string; keys: unknown[] }>> = {};
  for (const [name, animation] of Object.entries(section(root, 'animations'))) {
    animations[name] = animationPaths(animation).sort((a, b) =>
      byCodeUnit(a.path, b.path),
    );
  }

  // canonicalJson sorts every object key with byCodeUnit and formats every
  // number to six places, so the bytes do not depend on host ICU data, the
  // process locale or the exporter's float formatting.
  return createHash('sha256')
    .update(
      canonicalJson({
        bones,
        slots,
        skins,
        ik: constraints.ik,
        transform: constraints.transform,
        path: constraints.path,
        physics: constraints.physics,
        events,
        animations,
      }),
    )
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
}

/** Every timeline in one animation as a `<group>/<owner>/<timeline>` path. */
function animationPaths(animation: unknown): Array<{ path: string; keys: unknown[] }> {
  const root = isObject(animation) ? animation : {};
  const paths: Array<{ path: string; keys: unknown[] }> = [];

  for (const group of ['bones', 'slots'] as const) {
    for (const [owner, timelines] of Object.entries(section(root, group))) {
      if (!isObject(timelines)) continue;
      for (const [timeline, frames] of Object.entries(timelines)) {
        if (!isKeyframeArray(frames)) continue;
        paths.push({
          path: `${group}/${owner}/${timeline}`,
          keys: frames.map((frame) => projectKeyframe(frame)),
        });
      }
    }
  }

  if (isKeyframeArray(root['events'])) {
    paths.push({
      path: 'events//events',
      keys: root['events'].map((frame) => projectKeyframe(frame)),
    });
  }

  return paths;
}

function projectKeyframe(frame: Json): Record<string, unknown> {
  const projected: Record<string, unknown> = { time: round(num(frame['time'], 0), 6) };
  for (const key of [...VALUE_KEYS, 'int', 'float', 'string'] as const) {
    const value = frame[key];
    if (value === undefined) continue;
    projected[key] = typeof value === 'number' ? round(value, 6) : value;
  }
  return projected;
}

/** Whether a document on disk still describes the data it was built from. */
export function compareStaleness(
  previous: { skeletonHash: string | null; fingerprint: string | null } | null,
  current: { skeletonHash: string | null; fingerprint: string },
): 'absent' | 'fresh' | 'hashChanged' | 'fingerprintChanged' | 'both' {
  if (previous === null || previous.fingerprint === null) return 'absent';
  const hashChanged = previous.skeletonHash !== current.skeletonHash;
  const fingerprintChanged = previous.fingerprint !== current.fingerprint;
  if (hashChanged && fingerprintChanged) return 'both';
  if (hashChanged) return 'hashChanged';
  if (fingerprintChanged) return 'fingerprintChanged';
  return 'fresh';
}

// ------------------------------------------------------------
// The document
// ------------------------------------------------------------

const HASH_NOTE =
  "skeleton.hash is not sufficient on its own: two files in this repository's demo output " +
  'share one hash while differing by two whole animations, because the hash was not ' +
  'recomputed after the animations were added. Staleness is reported when either ' +
  'skeleton.hash or the fingerprint below differs.';

/** The ten caveats every document carries, in order. */
const UNCONDITIONAL_NOTES = [
  'World transforms are derived affinely in Node and omit shear composition and reflection; the measured influence section is the authority on what moves.',
  'Loopability is inferred from first/last keyframe values because skeleton data stores no loop flag.',
  'Influence is measured from software-rasterised renders at the recorded canvas size; buckets survive a machine change, the fourth decimal of a fraction may not.',
  "A pixel inside two slots' quads is credited to both; draw order decides which one a viewer sees.",
  `unattributedFraction > 0 means pixels moved that no slot quad covers ${DASH} usually a clipping attachment or additive spill.`,
  'skeleton.hash alone does not detect change; the fingerprint is computed by this tool over the normalised data.',
  'Lists in this document are sorted by code unit, not by locale, so the file is byte-identical on any machine. Animations alone are sorted the way skeleton_inspect sorts them, for consistency between the two tools.',
  'A bone whose parent is not declared, or whose parent chain is circular, is shown at top level with its declared parent named; its world transform is its local transform, and it is not counted as a root.',
  `"Loops (inferred)" means the pose returns to where it started, which is necessary but not sufficient for a usable loop. When the file records a generator's own intendedLoop, that is the author's intent and is reported separately ${DASH} the two can disagree, and both can be right.`,
  `events and attachmentSwitches are listed for the first ${MAX_DOC_KEYFRAMES} keyframes of each animation; the remainder is reported as a count.`,
];

/** Everything `buildDocument` cannot derive from the skeleton data alone. */
export interface BuildDocumentInput {
  root: Json;
  skeletonFile: string;
  atlasFile: string | null;
  /** ISO-8601 timestamp. The one non-deterministic field in the output. */
  generatedAt: string;
  /** The measured influence section, or its degraded shape. */
  influence: InfluenceDoc;
}

/** Rank used to aggregate one bone's buckets across its probed axes. */
const BUCKET_RANK: Record<InfluenceBucket, number> = {
  none: 0,
  slight: 1,
  moderate: 2,
  strong: 3,
};

/**
 * Assemble the document.
 *
 * Pure, and the single place rounding and key order are decided. The
 * influence section arrives already built, because measuring it needs a
 * browser and this module must work without one.
 */
export function buildDocument(input: BuildDocumentInput): SkeletonDocument {
  const { root, influence } = input;
  const meta: SkeletonMeta = readMeta(root);
  const geometry = readBoneGeometry(root);
  const boneNames = geometry.bones.map((bone) => bone.name);
  const slots = readSlots(root, new Set(geometry.summary.names));
  const { skins, attachments } = readSkinsAndAttachments(root, slots.names);
  const constraints = resolveConstraintsByBone(root);
  const declaredEvents = new Set(Object.keys(section(root, 'events')));

  const slotsOfBone = new Map<string, string[]>();
  for (const slot of slots.names) {
    const bone = slots.bones[slot] ?? null;
    if (bone === null) continue;
    const list = slotsOfBone.get(bone);
    if (list === undefined) slotsOfBone.set(bone, [slot]);
    else list.push(slot);
  }

  // One bucket per bone for the hierarchy table, aggregated across axes:
  // the strongest bucket any axis reached, and "no visible effect" only
  // when every probed axis of that bone moved nothing.
  const probeOfBone = new Map<
    string,
    { bucket: InfluenceBucket; noVisibleEffect: boolean }
  >();
  if (influence.available) {
    for (const entry of influence.bones) {
      const seen = probeOfBone.get(entry.bone);
      probeOfBone.set(entry.bone, {
        bucket:
          seen === undefined || BUCKET_RANK[entry.bucket] > BUCKET_RANK[seen.bucket]
            ? entry.bucket
            : seen.bucket,
        noVisibleEffect: (seen?.noVisibleEffect ?? true) && entry.noVisibleEffect,
      });
    }
  }

  const bones: BoneDoc[] = geometry.bones.map((bone) => ({
    name: bone.name,
    parent: bone.parent,
    depth: bone.depth,
    children: bone.children,
    local: bone.local,
    world: bone.world,
    mode: bone.mode,
    slots: [...(slotsOfBone.get(bone.name) ?? [])],
    constraints: (constraints.byBone[bone.name] ?? []).map(
      (ref) => `${ref.kind}:${ref.name}`,
    ),
    probe: probeOfBone.get(bone.name) ?? null,
  }));

  const deadBones = influence.available
    ? [...probeOfBone.entries()]
        .filter(([, probe]) => probe.noVisibleEffect)
        .map(([bone]) => bone)
        .sort(byCodeUnit)
    : [];
  const unprobedBones = influence.available
    ? boneNames.filter((name) => !probeOfBone.has(name)).sort(byCodeUnit)
    : [...boneNames].sort(byCodeUnit);

  const undeclaredEventRefs: string[] = [];
  const animations: AnimationDoc[] = Object.entries(section(root, 'animations'))
    .map(([name, animation]) => {
      const profile = motionProfile(name, animation, {
        summary: readAnimation(name, animation),
        rootBone: geometry.summary.rootCount === 1 ? (geometry.roots[0] ?? null) : null,
        declaredEvents,
        generatorIntendedLoop: generatorIntendedLoop(root, name),
      });
      undeclaredEventRefs.push(...profile.undeclaredEventRefs);
      return profile.doc;
    })
    // The one locale-sensitive sort in the document, and it is deliberate:
    // it matches inspectSkeleton, so skeleton_inspect and this tool list a
    // rig's animations in the same order. Animation names never enter the
    // fingerprint through this path, which is what bounds the trade.
    .sort((a, b) => a.name.localeCompare(b.name));

  const defects: DocumentDefects = {
    multipleRoots: geometry.summary.rootCount > 1,
    rootCount: geometry.summary.rootCount,
    missingParents: [...geometry.summary.missingParents].sort(byCodeUnit),
    cyclicBones: geometry.cyclicBones,
    duplicateBoneNames: [...new Set(geometry.summary.duplicateNames)].sort(byCodeUnit),
    duplicateSlotNames: [...new Set(slots.duplicateNames)].sort(byCodeUnit),
    danglingSlotBones: [...slots.danglingBoneRefs].sort(byCodeUnit),
    slotsWithoutAttachments: [...skins.slotsWithoutAttachments].sort(byCodeUnit),
    boneModeKeyMismatches: geometry.boneModeKeyMismatches,
    danglingConstraintRefs: constraints.danglingConstraintRefs,
    danglingPathTargets: constraints.danglingPathTargets,
    undeclaredEventRefs: [...new Set(undeclaredEventRefs)].sort(byCodeUnit),
  };

  const notes = [...UNCONDITIONAL_NOTES];
  if (defects.boneModeKeyMismatches.length > 0) {
    notes.push(
      `Bones declaring the legacy transform inheritance key: spine-core 4.2.120 reads only inherit, so those modes are ignored at runtime (${defects.boneModeKeyMismatches.join(', ')}).`,
    );
  }
  if (!influence.available) {
    notes.push(
      `Influence was not measured: ${influence.reason ?? 'no reason was recorded.'} No bone in this document is claimed to have no visible effect, because none was measured ${DASH} summary.unprobedBones lists every bone instead.`,
    );
  }
  if (defects.danglingPathTargets.length > 0) {
    notes.push(
      `A path constraint targets a slot this skeleton does not declare, so its target bone is unknown ${DASH} see defects.danglingPathTargets.`,
    );
  }
  if (influence.available) {
    notes.push(
      'Pixel fractions are relative to a camera framed from the union of the neutral pose and every pose in this plan, so they are comparable within this document but NOT against a document produced with a different probeMode or probeBones. Compare buckets and slot sets across plans, not fractions.',
    );
  }
  if (influence.warnings.length > 0) {
    notes.push(
      `Some attachment kinds are not drawn and have no slot box, so pixels they affect are counted in unattributedFraction rather than against a slot ${DASH} see the probe caveats in the influence section.`,
    );
  }

  return {
    schema: 1,
    kind: 'spine-skeleton-document',
    generatedAt: input.generatedAt,
    generator: { tool: DOCUMENT_GENERATOR_TOOL, version: DOCUMENT_GENERATOR_VERSION },
    source: {
      skeletonFile: input.skeletonFile,
      atlasFile: input.atlasFile,
      spineVersion: meta.spineVersion,
      skeletonHash: meta.hash,
      fingerprint: fingerprintSkeleton(root),
      hashNote: HASH_NOTE,
    },
    summary: {
      boneCount: geometry.summary.count,
      rootCount: geometry.summary.rootCount,
      maxDepth: geometry.summary.maxDepth,
      slotCount: slots.count,
      skinCount: skins.count,
      attachmentCount: attachments.total,
      constraintCount:
        constraints.ik.length +
        constraints.transform.length +
        constraints.path.length +
        constraints.physics.length,
      eventCount: declaredEvents.size,
      animationCount: animations.length,
      weightedMeshCount: attachments.meshes.filter((mesh) => mesh.weighted).length,
      deadBones,
      unprobedBones,
      nonessential: findNonessentialMarkers(root).length > 0,
    },
    defects,
    hierarchy: { roots: geometry.roots, bones },
    constraints,
    influence,
    animations,
    notes,
  };
}

// ------------------------------------------------------------
// Markdown rendering
// ------------------------------------------------------------

/**
 * Make a third-party name safe inside a Markdown table cell.
 *
 * Skeleton data is third-party content: a bone named a|b`c must not be
 * able to break the document's structure, and a name carrying a newline
 * must not be able to split a row.
 */
export function escapeCell(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\r?\n/g, ' ');
}

function code(value: string): string {
  return `\`${escapeCell(value)}\``;
}

function list(values: string[]): string {
  return values.length === 0 ? '(none)' : values.map((value) => code(value)).join(', ');
}

/** The bone tree, printed depth-first in declaration order. */
function renderTree(doc: SkeletonDocument): string[] {
  const byParent = new Map<string | null, BoneDoc[]>();
  const declared = new Set(doc.hierarchy.bones.map((bone) => bone.name));
  const cyclic = new Set(doc.defects.cyclicBones);
  const lines: string[] = [];

  for (const bone of doc.hierarchy.bones) {
    // A detached or cyclic bone is printed at top level with its declared
    // parent named, rather than being dropped from the tree.
    const key =
      bone.parent === null || !declared.has(bone.parent) || cyclic.has(bone.name)
        ? null
        : bone.parent;
    const siblings = byParent.get(key);
    if (siblings === undefined) byParent.set(key, [bone]);
    else siblings.push(bone);
  }

  const walk = (bone: BoneDoc, prefix: string, isLast: boolean, depth: number): void => {
    const marker = cyclic.has(bone.name)
      ? ' (cycle)'
      : bone.parent !== null && !declared.has(bone.parent)
        ? ` (missing parent: ${escapeCell(bone.parent)})`
        : '';
    const branch = depth === 0 ? '' : isLast ? TREE_LAST : TREE_MID;
    lines.push(`${prefix}${branch}${escapeCell(bone.name)}${marker}`);

    const children = (byParent.get(bone.name) ?? []).filter(
      (child) => !cyclic.has(child.name),
    );
    const nextPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : TREE_PIPE);
    for (const [index, child] of children.entries()) {
      walk(child, nextPrefix, index === children.length - 1, depth + 1);
    }
  };

  const top = byParent.get(null) ?? [];
  for (const [index, bone] of top.entries()) {
    walk(bone, '', index === top.length - 1, 0);
  }

  return lines;
}

/**
 * Render the finished document as Markdown.
 *
 * Pure, and it performs no analysis of its own: every fact here is already
 * in the document, so the two files cannot state different things. There
 * is no timestamp and no elapsed time anywhere in the body, which is what
 * makes two runs over one input produce byte-identical Markdown.
 */
export function renderDocumentMarkdown(doc: SkeletonDocument): string {
  const stem = doc.source.skeletonFile.split(/[\\/]/).pop() ?? doc.source.skeletonFile;
  const title = stem.replace(/\.json$/i, '');
  const lines: string[] = [];

  lines.push(`# ${escapeCell(title)} ${DASH} what this rig does`);
  lines.push('');
  lines.push(
    '<!-- Generated by kiro-spine2d-power/skeleton_document. Regenerate rather than editing by hand. -->',
  );
  lines.push('');
  lines.push(
    `**Source** ${code(stem)} ${DASH} exported by Spine ${doc.source.spineVersion ?? 'an unknown version'} ${DOT} ` +
      `\`skeleton.hash\` ${code(doc.source.skeletonHash ?? 'absent')} ${DOT} fingerprint ${code(doc.source.fingerprint)}`,
  );
  lines.push('');

  // --- At a glance ---
  lines.push('## At a glance');
  const s = doc.summary;
  lines.push(
    `${s.boneCount} bones (depth ${s.maxDepth}), ${s.slotCount} slots, ${s.skinCount} skin(s), ` +
      `${s.attachmentCount} attachments, ${s.constraintCount} constraints, ${s.animationCount} animations, ` +
      `${s.eventCount} events.`,
  );
  // Only when something was actually measured: an ungated "(none)" would
  // tell a reader the rig has no dead bones when nobody looked.
  if (doc.influence.available) {
    lines.push(`Bones with no visible effect: ${list(s.deadBones)}.`);
  }
  lines.push('');

  // --- Defects ---
  lines.push('## Defects');
  const defectRows: Array<[string, string]> = [];
  if (doc.defects.multipleRoots) {
    defectRows.push(['multipleRoots', `${doc.defects.rootCount} roots`]);
  }
  for (const [key, value] of Object.entries(doc.defects)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    defectRows.push([key, value.map((entry) => code(String(entry))).join(', ')]);
  }
  if (defectRows.length === 0) {
    lines.push('None found.');
  } else {
    lines.push('| Defect | Details |');
    lines.push('| --- | --- |');
    for (const [key, value] of defectRows) lines.push(`| ${key} | ${value} |`);
  }
  lines.push('');

  // --- Bone hierarchy ---
  lines.push('## Bone hierarchy');
  lines.push('```');
  lines.push(...renderTree(doc));
  lines.push('```');
  lines.push('');
  lines.push(
    '| Bone | Parent | Depth | Local x,y | Rotation | Scale | Shear | Length | Mode | World x,y | World rotation | Slots | Constraints | Influence |',
  );
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const bone of doc.hierarchy.bones) {
    const mode =
      bone.mode.declaredKey === 'transform'
        ? `${bone.mode.value} (legacy key, ignored at runtime)`
        : bone.mode.value;
    lines.push(
      `| ${code(bone.name)} | ${bone.parent === null ? DASH : code(bone.parent)} | ${bone.depth} ` +
        `| ${bone.local.x}, ${bone.local.y} | ${bone.local.rotation} ` +
        `| ${bone.local.scaleX}, ${bone.local.scaleY} | ${bone.local.shearX}, ${bone.local.shearY} ` +
        `| ${bone.local.length} | ${escapeCell(mode)} | ${bone.world.x}, ${bone.world.y} ` +
        `| ${bone.world.rotation} | ${bone.slots.length === 0 ? DASH : list(bone.slots)} ` +
        `| ${bone.constraints.length === 0 ? DASH : list(bone.constraints)} ` +
        `| ${bone.probe === null ? DASH : bone.probe.bucket} |`,
    );
  }
  lines.push('');

  // --- Constraints ---
  lines.push('## Constraints');
  lines.push('Read from the skeleton data, not inferred from pixels.');
  lines.push('');
  const c = doc.constraints;
  if (c.ik.length + c.transform.length + c.path.length + c.physics.length === 0) {
    lines.push('This skeleton declares no constraints.');
  } else {
    for (const entry of c.ik) {
      lines.push(
        `- **ik** ${code(entry.name)} (order ${entry.order}) ${DASH} bones ${list(entry.bones)}, ` +
          `target ${entry.target === null ? DASH : code(entry.target)}, mix ${entry.mix}, softness ${entry.softness}.`,
      );
    }
    for (const entry of c.transform) {
      lines.push(
        `- **transform** ${code(entry.name)} (order ${entry.order}) ${DASH} bones ${list(entry.bones)}, ` +
          `target ${entry.target === null ? DASH : code(entry.target)}, mixRotate ${entry.mixRotate}, ` +
          `mixX ${entry.mixX}, mixY ${entry.mixY}.`,
      );
    }
    for (const entry of c.path) {
      lines.push(
        `- **path** ${code(entry.name)} (order ${entry.order}) ${DASH} bones ${list(entry.bones)}, ` +
          `target slot ${entry.target === null ? DASH : code(entry.target)}, ` +
          `target bone ${entry.targetBone === null ? 'unresolved' : code(entry.targetBone)}, ` +
          `${escapeCell(entry.positionMode)}/${escapeCell(entry.spacingMode)}/${escapeCell(entry.rotateMode)}.`,
      );
    }
    for (const entry of c.physics) {
      lines.push(
        `- **physics** ${code(entry.name)} (order ${entry.order}) ${DASH} bone ` +
          `${entry.bone === null ? DASH : code(entry.bone)}, inertia ${entry.inertia}, ` +
          `strength ${entry.strength}, damping ${entry.damping}, mix ${entry.mix}.`,
      );
    }
    lines.push('');
    lines.push('### By bone');
    lines.push('| Bone | Constraint | Kind | Role |');
    lines.push('| --- | --- | --- | --- |');
    for (const [bone, refs] of Object.entries(c.byBone)) {
      for (const ref of refs) {
        lines.push(
          `| ${code(bone)} | ${code(ref.name)} | ${ref.kind} | ${ref.role}` +
            `${ref.targetSlot === null ? '' : ` via slot ${code(ref.targetSlot)}`} |`,
        );
      }
    }
  }
  lines.push('');

  // --- Influence ---
  lines.push('## Bone influence (measured)');
  if (!doc.influence.available) {
    lines.push(`> ${doc.influence.reason ?? 'Not measured.'}`);
  } else {
    const inf = doc.influence;
    lines.push(
      `Mode ${code(inf.mode)}, perturbation ${inf.perturbation.rotationDegrees}${DEGREE}, ` +
        `canvas ${inf.canvas?.width ?? 0}x${inf.canvas?.height ?? 0}, ` +
        `channel tolerance ${inf.thresholds.channelTolerance}, ${inf.probesPerformed} probe(s).`,
    );
    if (inf.framing !== null) {
      lines.push(
        `Framed from ${inf.framing.fromPoses} pose(s): ${inf.framing.width}x${inf.framing.height} ` +
          `at (${inf.framing.x}, ${inf.framing.y}), padding ${inf.framing.padding}. ` +
          'Fractions are relative to this framing.',
      );
    }
    lines.push('');
    lines.push(
      '| Bone | Axis | Delta | Changed pixels | Fraction | Bucket | Max channel delta | Influenced slots | Unattributed |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const entry of inf.bones) {
      const slotCell =
        entry.slots.length === 0
          ? DASH
          : entry.slots
              .map(
                (slot) =>
                  `${code(slot.slot)} ${ARROW} ${slot.attachments.length === 0 ? DASH : list(slot.attachments)} (${slot.changedFraction})`,
              )
              .join('; ');
      lines.push(
        `| ${code(entry.bone)} | ${entry.axis} | ${entry.delta} | ${entry.changedPixels} ` +
          `| ${entry.changedFraction} | ${entry.bucket} | ${entry.maxChannelDelta} ` +
          `| ${slotCell}${entry.slotsTruncated > 0 ? ` and ${entry.slotsTruncated} more` : ''} ` +
          `| ${entry.unattributedFraction} |`,
      );
    }
    if (inf.warnings.length > 0) {
      lines.push('');
      lines.push('### Probe caveats');
      for (const warning of inf.warnings) lines.push(`- ${warning}`);
    }
  }
  lines.push('');

  // --- Animations ---
  lines.push('## Animations');
  if (doc.animations.length === 0) {
    lines.push('This skeleton declares no animations.');
  }
  for (const animation of doc.animations) {
    lines.push('');
    lines.push(`### ${code(animation.name)}`);
    lines.push(
      `Duration ${animation.duration}s ${DOT} ${animation.loopable.value ? 'loops (inferred)' : 'one-shot (inferred)'}` +
        `${
          animation.generatorIntendedLoop === null
            ? ''
            : ` ${DOT} the generator intended ${animation.generatorIntendedLoop ? 'a loop' : 'a one-shot'}`
        } ${DOT} ` +
        `${animation.timelineCount} timeline(s), ${animation.keyframeCount} keyframe(s).`,
    );
    lines.push(`Loopability method: ${animation.loopable.method}.`);
    if (animation.loopable.mismatches.length > 0) {
      lines.push(`Timelines that do not return: ${list(animation.loopable.mismatches)}.`);
    }
    lines.push(
      `Root motion: ${animation.rootMotion.bone === null ? 'no single root bone' : code(animation.rootMotion.bone)} ` +
        `net (${animation.rootMotion.netTranslate.x}, ${animation.rootMotion.netTranslate.y}) ${DASH} ` +
        `${animation.rootMotion.locomotive ? 'travels' : 'in place'}.`,
    );
    lines.push(`Activity measure: ${animation.activityMeasure}.`);
    lines.push(
      `Most active bones: ${
        animation.mostActiveBones.length === 0
          ? '(none)'
          : animation.mostActiveBones
              .map((entry) => `${code(entry.bone)} ${entry.score}`)
              .join(', ')
      }.`,
    );
    lines.push(`Animated bones: ${list(animation.animatedBones)}.`);
    lines.push(`Animated slots: ${list(animation.animatedSlots)}.`);
    if (animation.attachmentSwitches.length > 0) {
      lines.push(
        `Attachment switches: ${animation.attachmentSwitches
          .map(
            (entry) =>
              `${code(entry.slot)} ${ARROW} ${entry.to === null ? 'hidden' : code(entry.to)} at ${entry.time}s`,
          )
          .join(', ')}${
          animation.attachmentSwitchesTruncated > 0
            ? ` and ${animation.attachmentSwitchesTruncated} more`
            : ''
        }.`,
      );
    }
    if (animation.events.length > 0) {
      lines.push(
        `Event keyframes: ${animation.events
          .map((entry) => `${code(entry.name)} at ${entry.time}s`)
          .join(', ')}${
          animation.eventsTruncated > 0 ? ` and ${animation.eventsTruncated} more` : ''
        }.`,
      );
    }
  }
  lines.push('');

  // --- Staleness ---
  lines.push('## Staleness');
  lines.push(
    `This document describes \`skeleton.hash\` ${code(doc.source.skeletonHash ?? 'absent')} and ` +
      `fingerprint ${code(doc.source.fingerprint)}.`,
  );
  lines.push(`Why the hash is not enough: ${doc.source.hashNote}`);
  lines.push(
    'Re-run `skeleton_document` on the same file: it reports whether the document it found was describing different data.',
  );
  lines.push('');

  // --- Limits ---
  lines.push('## Limits of this document');
  for (const note of doc.notes) lines.push(`- ${note}`);
  lines.push('');

  return lines.join('\n');
}
