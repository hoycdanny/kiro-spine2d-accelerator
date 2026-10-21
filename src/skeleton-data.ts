// ============================================================
// Exported skeleton data: parsing and inspection.
//
// Scope: the JSON export format (`.json`). Binary (`.skel`) is out of scope
// for now — see the backlog note in POWER.md.
//
// Format reference: Spine's documented JSON export format, cross-checked
// against the 4.2 runtime reader. Two deliberate design choices:
//
//  1. Omitted fields fall back to the documented defaults (`length` 0,
//     `scaleX/scaleY` 1, `transform` "normal", `fps` 30, and so on).
//  2. Animation inspection walks the timeline tree structurally instead of
//     hard-coding per-version key names. Spine renamed several timeline
//     keys between 3.8 and 4.x (`angle` to `value`, `rotateMix` to
//     `mixRotate`, `twoColor` to `rgba2`), and 4.2 added physics
//     constraints. Counting keyframe arrays and reading `time` fields works
//     across all of those without a version switch.
// ============================================================

import { SpineErrorCode, SpineResult, err, ok } from './types';

/** Default dopesheet framerate when `fps` is omitted (nonessential field). */
export const DEFAULT_FPS = 30;

/** Attachment types defined by the format. */
export const ATTACHMENT_TYPES = [
  'region',
  'mesh',
  'linkedmesh',
  'boundingbox',
  'path',
  'point',
  'clipping',
] as const;

export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/** Blend modes a slot can use. */
export const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen'] as const;

// ------------------------------------------------------------
// Report types
// ------------------------------------------------------------

export interface SkeletonMeta {
  /** Hash of all skeleton data; changes whenever the data changes. */
  hash: string | null;
  /** Spine version that exported the data (`spine` field). */
  spineVersion: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  /** Dopesheet FPS; 30 when omitted. */
  fps: number;
  images: string | null;
  audio: string | null;
}

export interface BoneSummary {
  count: number;
  /** Bones with no parent. A well-formed skeleton has exactly one. */
  rootCount: number;
  /** Longest parent chain, counting the root as depth 1. */
  maxDepth: number;
  /** The names along the deepest chain, root first. */
  deepestChain: string[];
  /** Bones referenced as a parent but never declared. */
  missingParents: string[];
  /** Names that appear more than once. */
  duplicateNames: string[];
  names: string[];
  /** Parent of each bone, null for a root. Used by the diff tool. */
  parents: Record<string, string | null>;
}

export interface SlotSummary {
  count: number;
  /** Slots that have an attachment in the setup pose. */
  withSetupAttachment: number;
  /** Slot names whose `bone` is not declared in `bones`. */
  danglingBoneRefs: string[];
  /** Count per blend mode; only non-default modes are listed. */
  blendModes: Record<string, number>;
  duplicateNames: string[];
  /** Slot names in setup-pose draw order. */
  names: string[];
  /** Bone each slot is attached to. Used by the diff tool. */
  bones: Record<string, string | null>;
  /** Blend mode per slot, omitted when normal. Used by the diff tool. */
  blend: Record<string, string>;
}

export interface MeshSummary {
  skin: string;
  slot: string;
  attachment: string;
  vertexCount: number;
  triangleCount: number;
  /** Weighted meshes bind vertices to bones; unweighted ones do not. */
  weighted: boolean;
}

/** One attachment, identified by the skin and slot that hold it. */
export interface AttachmentEntry {
  skin: string;
  slot: string;
  /** The key in the skin, which is the name timelines refer to. */
  key: string;
  type: string;
  /** The region this attachment looks up, after path/name resolution. */
  regionKey: string | null;
}

export interface AttachmentSummary {
  total: number;
  byType: Record<string, number>;
  /** Every attachment, for diffing. */
  entries: AttachmentEntry[];
  /** Attachment keys that resolve to a different region via `name`/`path`. */
  renamed: number;
  meshes: MeshSummary[];
  maxMeshVertices: number;
  totalMeshVertices: number;
  /** Region/mesh region keys used by attachments, for atlas cross-checks. */
  regionKeys: string[];
}

export interface SkinSummary {
  count: number;
  names: string[];
  hasDefault: boolean;
  /** Attachment count per skin name. */
  attachmentCounts: Record<string, number>;
  /** Slots that no skin provides an attachment for. */
  slotsWithoutAttachments: string[];
}

export interface ConstraintSummary {
  ik: string[];
  transform: string[];
  path: string[];
  /** Physics constraints, added in Spine 4.2. */
  physics: string[];
  total: number;
}

export interface AnimationSummary {
  name: string;
  /** Duration in seconds: the largest keyframe time in the animation. */
  duration: number;
  /** Number of keyframe arrays (timelines) in the animation. */
  timelineCount: number;
  /** Total keyframes across all timelines. */
  keyframeCount: number;
  /** Timeline count per top-level group, e.g. `{ bones: 12, slots: 3 }`. */
  groups: Record<string, number>;
  /** Bone names animated by this animation. */
  animatedBones: string[];
  /** Event keyframes fired by this animation. */
  eventCount: number;
}

export interface SkeletonReport {
  meta: SkeletonMeta;
  /**
   * True when nonessential data is present. Nonessential data is required
   * to import the file back into Spine without losing information.
   */
  nonessential: boolean;
  /** Which nonessential markers were found. */
  nonessentialMarkers: string[];
  bones: BoneSummary;
  slots: SlotSummary;
  skins: SkinSummary;
  attachments: AttachmentSummary;
  constraints: ConstraintSummary;
  events: { count: number; names: string[]; withAudio: number };
  animations: AnimationSummary[];
  totals: {
    animationCount: number;
    longestAnimation: string | null;
    longestDuration: number;
    totalDuration: number;
    timelineCount: number;
    keyframeCount: number;
  };
}

// ------------------------------------------------------------
// Parsing helpers
// ------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Parse exported skeleton JSON.
 *
 * Spine can write "JavaScript" and "Minimal" variants where names are not
 * quoted; those need a lenient parser and are rejected here with a hint
 * rather than silently mis-parsed.
 */
export function parseSkeletonJson(text: string): SpineResult<Json> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(
      SpineErrorCode.ParseFailed,
      `Skeleton data is not valid JSON: ${message}`,
      'Re-export with the export Format set to "JSON". The "JavaScript" and "Minimal" formats omit quotes and need a lenient parser.',
    );
  }

  if (!isObject(parsed)) {
    return err(
      SpineErrorCode.ParseFailed,
      'Skeleton data must be a JSON object.',
      'Point this tool at a skeleton data file exported by Spine, not at an atlas or settings file.',
    );
  }

  if (!isObject(parsed['skeleton']) && !Array.isArray(parsed['bones'])) {
    return err(
      SpineErrorCode.ValidationFailed,
      'This JSON has neither a "skeleton" section nor a "bones" array, so it is not skeleton data.',
      'Check the file: export settings JSON and pack settings JSON look similar but are different formats.',
    );
  }

  return ok(parsed, 'Skeleton JSON parsed.');
}

/** Read the `skeleton` metadata section, applying documented defaults. */
export function readMeta(root: Json): SkeletonMeta {
  const section = isObject(root['skeleton']) ? root['skeleton'] : {};
  return {
    hash: asString(section['hash']),
    spineVersion: asString(section['spine']) ?? asString(section['version']),
    x: asOptionalNumber(section['x']),
    y: asOptionalNumber(section['y']),
    width: asOptionalNumber(section['width']),
    height: asOptionalNumber(section['height']),
    fps: asNumber(section['fps'], DEFAULT_FPS),
    images: asString(section['images']),
    audio: asString(section['audio']),
  };
}

/** Summarize the bone hierarchy. */
export function readBones(root: Json): BoneSummary {
  const bones = asArray(root['bones']).filter(isObject);
  const names: string[] = [];
  const parents = new Map<string, string | null>();
  const seen = new Set<string>();
  const duplicateNames: string[] = [];

  for (const bone of bones) {
    const name = asString(bone['name']);
    if (name === null) continue;
    if (seen.has(name)) duplicateNames.push(name);
    seen.add(name);
    names.push(name);
    parents.set(name, asString(bone['parent']));
  }

  const missingParents = [
    ...new Set(
      [...parents.values()].filter(
        (parent): parent is string => parent !== null && !seen.has(parent),
      ),
    ),
  ];

  let maxDepth = 0;
  let deepestChain: string[] = [];

  for (const name of names) {
    const chain: string[] = [];
    let cursor: string | null = name;
    const guard = new Set<string>();
    while (cursor !== null && !guard.has(cursor)) {
      guard.add(cursor);
      chain.unshift(cursor);
      cursor = parents.get(cursor) ?? null;
    }
    if (chain.length > maxDepth) {
      maxDepth = chain.length;
      deepestChain = chain;
    }
  }

  return {
    count: names.length,
    rootCount: [...parents.values()].filter((parent) => parent === null).length,
    maxDepth,
    deepestChain,
    missingParents,
    duplicateNames,
    names,
    parents: Object.fromEntries(parents),
  };
}

/** Summarize slots and their setup-pose state. */
export function readSlots(root: Json, boneNames: Set<string>): SlotSummary {
  const slots = asArray(root['slots']).filter(isObject);
  const names: string[] = [];
  const seen = new Set<string>();
  const duplicateNames: string[] = [];
  const blendModes: Record<string, number> = {};
  const danglingBoneRefs: string[] = [];
  const slotBones: Record<string, string | null> = {};
  const slotBlend: Record<string, string> = {};
  let withSetupAttachment = 0;

  for (const slot of slots) {
    const name = asString(slot['name']);
    if (name === null) continue;
    if (seen.has(name)) duplicateNames.push(name);
    seen.add(name);
    names.push(name);

    if (asString(slot['attachment']) !== null) withSetupAttachment += 1;

    const bone = asString(slot['bone']);
    slotBones[name] = bone;
    if (bone !== null && boneNames.size > 0 && !boneNames.has(bone)) {
      danglingBoneRefs.push(`${name} -> ${bone}`);
    }

    const blend = asString(slot['blend']);
    if (blend !== null && blend !== 'normal') {
      blendModes[blend] = (blendModes[blend] ?? 0) + 1;
      slotBlend[name] = blend;
    }
  }

  return {
    count: names.length,
    withSetupAttachment,
    danglingBoneRefs,
    blendModes,
    duplicateNames,
    names,
    bones: slotBones,
    blend: slotBlend,
  };
}

interface SkinAndAttachments {
  skins: SkinSummary;
  attachments: AttachmentSummary;
}

/**
 * Walk the skins section, collecting both skin and attachment statistics.
 *
 * A skin maps slot name to attachment key to attachment. The attachment's
 * own `name`/`path` may differ from the key, which is how skins swap
 * regions (`blue/pelvis` for the key `pelvis`).
 */
export function readSkinsAndAttachments(
  root: Json,
  slotNames: string[],
): SkinAndAttachments {
  const skins = asArray(root['skins']).filter(isObject);
  const skinNames: string[] = [];
  const attachmentCounts: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const meshes: MeshSummary[] = [];
  const entries: AttachmentEntry[] = [];
  const regionKeys = new Set<string>();
  const slotsCovered = new Set<string>();

  let total = 0;
  let renamed = 0;
  let maxMeshVertices = 0;
  let totalMeshVertices = 0;

  for (const skin of skins) {
    const skinName = asString(skin['name']) ?? 'default';
    skinNames.push(skinName);
    attachmentCounts[skinName] = 0;

    const bySlot = isObject(skin['attachments']) ? skin['attachments'] : {};
    for (const [slotName, slotAttachments] of Object.entries(bySlot)) {
      if (!isObject(slotAttachments)) continue;
      slotsCovered.add(slotName);

      for (const [key, attachment] of Object.entries(slotAttachments)) {
        if (!isObject(attachment)) continue;
        total += 1;
        attachmentCounts[skinName] = (attachmentCounts[skinName] ?? 0) + 1;

        const type = asString(attachment['type']) ?? 'region';
        byType[type] = (byType[type] ?? 0) + 1;

        const actualName = asString(attachment['name']);
        const path = asString(attachment['path']);
        if ((actualName !== null && actualName !== key) || path !== null) renamed += 1;

        let regionKey: string | null = null;
        if (type === 'region' || type === 'mesh' || type === 'linkedmesh') {
          regionKey = path ?? actualName ?? key;
          regionKeys.add(regionKey);
        }

        entries.push({ skin: skinName, slot: slotName, key, type, regionKey });

        if (type === 'mesh') {
          const uvs = asArray(attachment['uvs']);
          const vertices = asArray(attachment['vertices']);
          const triangles = asArray(attachment['triangles']);
          const vertexCount = Math.floor(uvs.length / 2);
          // Documented rule: a mesh is weighted when the vertices array is
          // longer than the UV array, because weighted vertices carry bone
          // indices and weights instead of a bare x,y pair.
          const weighted = vertices.length > uvs.length;

          meshes.push({
            skin: skinName,
            slot: slotName,
            attachment: key,
            vertexCount,
            triangleCount: Math.floor(triangles.length / 3),
            weighted,
          });
          totalMeshVertices += vertexCount;
          if (vertexCount > maxMeshVertices) maxMeshVertices = vertexCount;
        }
      }
    }
  }

  return {
    skins: {
      count: skinNames.length,
      names: skinNames,
      hasDefault: skinNames.includes('default'),
      attachmentCounts,
      slotsWithoutAttachments: slotNames.filter((name) => !slotsCovered.has(name)),
    },
    attachments: {
      total,
      byType,
      entries,
      renamed,
      meshes,
      maxMeshVertices,
      totalMeshVertices,
      regionKeys: [...regionKeys].sort(),
    },
  };
}

function constraintNames(value: unknown): string[] {
  return asArray(value)
    .filter(isObject)
    .map((entry) => asString(entry['name']))
    .filter((name): name is string => name !== null);
}

/** Summarize IK, transform, path and physics constraints. */
export function readConstraints(root: Json): ConstraintSummary {
  const ik = constraintNames(root['ik']);
  const transform = constraintNames(root['transform']);
  const path = constraintNames(root['path']);
  const physics = constraintNames(root['physics']);
  return {
    ik,
    transform,
    path,
    physics,
    total: ik.length + transform.length + path.length + physics.length,
  };
}

/** Summarize the events section. */
export function readEvents(root: Json): {
  count: number;
  names: string[];
  withAudio: number;
} {
  const section = isObject(root['events']) ? root['events'] : {};
  const names = Object.keys(section);
  const withAudio = names.filter((name) => {
    const event = section[name];
    return isObject(event) && asString(event['audio']) !== null;
  }).length;
  return { count: names.length, names, withAudio };
}

/** A keyframe array: an array whose entries are objects. */
function isKeyframeArray(value: unknown): value is Json[] {
  return Array.isArray(value) && value.length > 0 && value.every(isObject);
}

interface TimelineStats {
  timelineCount: number;
  keyframeCount: number;
  duration: number;
}

/**
 * Walk a timeline subtree, counting keyframe arrays and tracking the
 * largest `time` value found.
 *
 * Structure-based rather than key-based on purpose: this is what makes the
 * inspector survive the timeline renames between Spine versions.
 */
function walkTimelines(node: unknown): TimelineStats {
  if (isKeyframeArray(node)) {
    let duration = 0;
    for (const frame of node) {
      const time = asNumber(frame['time'], 0);
      if (time > duration) duration = time;
    }
    return { timelineCount: 1, keyframeCount: node.length, duration };
  }

  if (Array.isArray(node)) {
    // An empty array, or an array of primitives (e.g. a `vertices` list).
    return { timelineCount: 0, keyframeCount: 0, duration: 0 };
  }

  if (isObject(node)) {
    let timelineCount = 0;
    let keyframeCount = 0;
    let duration = 0;
    for (const child of Object.values(node)) {
      const stats = walkTimelines(child);
      timelineCount += stats.timelineCount;
      keyframeCount += stats.keyframeCount;
      if (stats.duration > duration) duration = stats.duration;
    }
    return { timelineCount, keyframeCount, duration };
  }

  return { timelineCount: 0, keyframeCount: 0, duration: 0 };
}

/** Summarize one animation. */
export function readAnimation(name: string, animation: unknown): AnimationSummary {
  const groups: Record<string, number> = {};
  let timelineCount = 0;
  let keyframeCount = 0;
  let duration = 0;
  let eventCount = 0;
  let animatedBones: string[] = [];

  if (isObject(animation)) {
    for (const [group, value] of Object.entries(animation)) {
      const stats = walkTimelines(value);
      if (stats.timelineCount > 0) groups[group] = stats.timelineCount;
      timelineCount += stats.timelineCount;
      keyframeCount += stats.keyframeCount;
      if (stats.duration > duration) duration = stats.duration;

      if (group === 'events' && isKeyframeArray(value)) {
        eventCount = value.length;
      }
      if (group === 'bones' && isObject(value)) {
        animatedBones = Object.keys(value);
      }
    }
  }

  return {
    name,
    duration,
    timelineCount,
    keyframeCount,
    groups,
    animatedBones,
    eventCount,
  };
}

/** Nonessential markers, which decide whether the data can round-trip. */
export function findNonessentialMarkers(root: Json): string[] {
  const markers: string[] = [];
  const skeleton = isObject(root['skeleton']) ? root['skeleton'] : {};

  if (asOptionalNumber(skeleton['fps']) !== null) markers.push('skeleton.fps');
  if (asString(skeleton['images']) !== null) markers.push('skeleton.images');
  if (asString(skeleton['audio']) !== null) markers.push('skeleton.audio');

  const bonesWithColor = asArray(root['bones'])
    .filter(isObject)
    .filter((bone) => asString(bone['color']) !== null).length;
  if (bonesWithColor > 0) markers.push('bones[].color');

  for (const skin of asArray(root['skins']).filter(isObject)) {
    const bySlot = isObject(skin['attachments']) ? skin['attachments'] : {};
    for (const slotAttachments of Object.values(bySlot)) {
      if (!isObject(slotAttachments)) continue;
      for (const attachment of Object.values(slotAttachments)) {
        if (!isObject(attachment)) continue;
        if (Array.isArray(attachment['edges'])) {
          markers.push('mesh.edges');
          return [...new Set(markers)];
        }
      }
    }
  }

  return [...new Set(markers)];
}

/** Build the full inspection report for parsed skeleton data. */
export function inspectSkeleton(root: Json): SkeletonReport {
  const meta = readMeta(root);
  const bones = readBones(root);
  const slots = readSlots(root, new Set(bones.names));
  const { skins, attachments } = readSkinsAndAttachments(root, slots.names);
  const constraints = readConstraints(root);
  const events = readEvents(root);

  const animationsSection = isObject(root['animations']) ? root['animations'] : {};
  const animations = Object.entries(animationsSection)
    .map(([name, animation]) => readAnimation(name, animation))
    .sort((a, b) => a.name.localeCompare(b.name));

  const longest = animations.reduce<AnimationSummary | null>(
    (best, current) => (best === null || current.duration > best.duration ? current : best),
    null,
  );

  const nonessentialMarkers = findNonessentialMarkers(root);

  return {
    meta,
    nonessential: nonessentialMarkers.length > 0,
    nonessentialMarkers,
    bones,
    slots,
    skins,
    attachments,
    constraints,
    events,
    animations,
    totals: {
      animationCount: animations.length,
      longestAnimation: longest?.name ?? null,
      longestDuration: longest?.duration ?? 0,
      totalDuration: animations.reduce((sum, animation) => sum + animation.duration, 0),
      timelineCount: animations.reduce((sum, animation) => sum + animation.timelineCount, 0),
      keyframeCount: animations.reduce((sum, animation) => sum + animation.keyframeCount, 0),
    },
  };
}

/** Parse and inspect in one step. */
export function inspectSkeletonJson(text: string): SpineResult<SkeletonReport> {
  const parsed = parseSkeletonJson(text);
  if (!parsed.ok) return parsed;
  const report = inspectSkeleton(parsed.data);
  return ok(report, summarizeSkeleton(report));
}

/** Human-readable summary of a skeleton report. */
export function summarizeSkeleton(report: SkeletonReport): string {
  const lines: string[] = [];
  const version = report.meta.spineVersion ?? 'unknown version';

  lines.push(
    `Exported by Spine ${version}: ${report.bones.count} bones (depth ${report.bones.maxDepth}), ` +
      `${report.slots.count} slots, ${report.skins.count} skin(s), ${report.attachments.total} attachments, ` +
      `${report.totals.animationCount} animation(s).`,
  );

  if (report.constraints.total > 0) {
    const parts: string[] = [];
    if (report.constraints.ik.length) parts.push(`${report.constraints.ik.length} IK`);
    if (report.constraints.transform.length)
      parts.push(`${report.constraints.transform.length} transform`);
    if (report.constraints.path.length)
      parts.push(`${report.constraints.path.length} path`);
    if (report.constraints.physics.length)
      parts.push(`${report.constraints.physics.length} physics`);
    lines.push(`Constraints: ${parts.join(', ')}.`);
  }

  if (report.attachments.meshes.length > 0) {
    const weighted = report.attachments.meshes.filter((mesh) => mesh.weighted).length;
    lines.push(
      `Meshes: ${report.attachments.meshes.length} (${weighted} weighted), ` +
        `largest ${report.attachments.maxMeshVertices} vertices.`,
    );
  }

  if (report.animations.length > 0) {
    const listed = report.animations
      .slice(0, 12)
      .map((animation) => `${animation.name} (${animation.duration.toFixed(2)}s)`)
      .join(', ');
    const more =
      report.animations.length > 12 ? ` …and ${report.animations.length - 12} more` : '';
    lines.push(`Animations: ${listed}${more}.`);
  }

  lines.push(
    report.nonessential
      ? `Nonessential data present (${report.nonessentialMarkers.join(', ')}), so this file can be imported back into Spine.`
      : 'Nonessential data missing: importing this file back into Spine would lose information. Re-export with "Nonessential data" checked if a round trip is needed.',
  );

  return lines.join('\n');
}
