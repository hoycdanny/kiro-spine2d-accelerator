// ============================================================
// Semantic diff between two exported skeletons.
//
// Why not a text diff: exported JSON changes constantly in ways that do not
// matter (float formatting, key order, the hash). What a reviewer needs to
// know is whether a bone was removed, an animation got longer, or a slot
// changed draw order.
//
// The skeleton `hash` is a fast "did anything change at all" signal, but it
// is not a semantic one: re-exporting can change the hash while the data
// stays equivalent. This module reports both, and says so when they
// disagree.
// ============================================================

import { AnimationSummary, SkeletonReport } from './skeleton-data';

/** Added and removed names for one kind of entity. */
export interface NameDiff {
  added: string[];
  removed: string[];
}

/** A bone whose parent changed. */
export interface ReparentedBone {
  name: string;
  from: string | null;
  to: string | null;
}

/** A slot whose bone or blend mode changed. */
export interface ChangedSlot {
  name: string;
  boneFrom?: string | null;
  boneTo?: string | null;
  blendFrom?: string;
  blendTo?: string;
}

/** An attachment whose type or target region changed. */
export interface ChangedAttachment {
  id: string;
  typeFrom?: string;
  typeTo?: string;
  regionFrom?: string | null;
  regionTo?: string | null;
}

/** How one animation changed. */
export interface AnimationChange {
  name: string;
  durationFrom: number;
  durationTo: number;
  timelinesFrom: number;
  timelinesTo: number;
  keyframesFrom: number;
  keyframesTo: number;
  /** Bones animated in one version but not the other. */
  bones: NameDiff;
}

/** The full diff between two skeleton reports. */
export interface SkeletonDiff {
  hashFrom: string | null;
  hashTo: string | null
  hashChanged: boolean;
  versionFrom: string | null;
  versionTo: string | null;
  bones: NameDiff & { reparented: ReparentedBone[] };
  slots: NameDiff & { changed: ChangedSlot[]; orderChanged: boolean };
  skins: NameDiff;
  attachments: NameDiff & { changed: ChangedAttachment[] };
  constraints: {
    ik: NameDiff;
    transform: NameDiff;
    path: NameDiff;
    physics: NameDiff;
  };
  events: NameDiff;
  animations: NameDiff & { changed: AnimationChange[] };
  /** True when nothing in the structured comparison differs. */
  semanticallyIdentical: boolean;
  /** Total number of differences found. */
  changeCount: number;
}

function diffNames(from: string[], to: string[]): NameDiff {
  const before = new Set(from);
  const after = new Set(to);
  return {
    added: to.filter((name) => !before.has(name)).sort(),
    removed: from.filter((name) => !after.has(name)).sort(),
  };
}

function attachmentId(entry: { skin: string; slot: string; key: string }): string {
  return `${entry.skin}/${entry.slot}/${entry.key}`;
}

function animationByName(
  animations: AnimationSummary[],
): Map<string, AnimationSummary> {
  return new Map(animations.map((animation) => [animation.name, animation]));
}

/** Compare two skeleton reports. */
export function diffSkeletons(from: SkeletonReport, to: SkeletonReport): SkeletonDiff {
  const bones = diffNames(from.bones.names, to.bones.names);
  const reparented: ReparentedBone[] = [];
  for (const name of to.bones.names) {
    if (!(name in from.bones.parents)) continue;
    const before = from.bones.parents[name] ?? null;
    const after = to.bones.parents[name] ?? null;
    if (before !== after) reparented.push({ name, from: before, to: after });
  }

  const slots = diffNames(from.slots.names, to.slots.names);
  const changedSlots: ChangedSlot[] = [];
  for (const name of to.slots.names) {
    if (!from.slots.names.includes(name)) continue;
    const change: ChangedSlot = { name };
    let touched = false;

    const boneFrom = from.slots.bones[name] ?? null;
    const boneTo = to.slots.bones[name] ?? null;
    if (boneFrom !== boneTo) {
      change.boneFrom = boneFrom;
      change.boneTo = boneTo;
      touched = true;
    }

    const blendFrom = from.slots.blend[name] ?? 'normal';
    const blendTo = to.slots.blend[name] ?? 'normal';
    if (blendFrom !== blendTo) {
      change.blendFrom = blendFrom;
      change.blendTo = blendTo;
      touched = true;
    }

    if (touched) changedSlots.push(change);
  }

  // Draw order is the slot order itself, so compare the surviving slots in
  // sequence rather than the raw arrays.
  const survivingFrom = from.slots.names.filter((name) => to.slots.names.includes(name));
  const survivingTo = to.slots.names.filter((name) => from.slots.names.includes(name));
  const orderChanged = survivingFrom.join('\u0000') !== survivingTo.join('\u0000');

  const fromAttachments = new Map(
    from.attachments.entries.map((entry) => [attachmentId(entry), entry]),
  );
  const toAttachments = new Map(
    to.attachments.entries.map((entry) => [attachmentId(entry), entry]),
  );
  const attachments: NameDiff & { changed: ChangedAttachment[] } = {
    added: [...toAttachments.keys()].filter((id) => !fromAttachments.has(id)).sort(),
    removed: [...fromAttachments.keys()].filter((id) => !toAttachments.has(id)).sort(),
    changed: [],
  };
  for (const [id, after] of toAttachments) {
    const before = fromAttachments.get(id);
    if (!before) continue;
    const change: ChangedAttachment = { id };
    let touched = false;
    if (before.type !== after.type) {
      change.typeFrom = before.type;
      change.typeTo = after.type;
      touched = true;
    }
    if (before.regionKey !== after.regionKey) {
      change.regionFrom = before.regionKey;
      change.regionTo = after.regionKey;
      touched = true;
    }
    if (touched) attachments.changed.push(change);
  }
  attachments.changed.sort((a, b) => a.id.localeCompare(b.id));

  const fromAnimations = animationByName(from.animations);
  const toAnimations = animationByName(to.animations);
  const animations: NameDiff & { changed: AnimationChange[] } = {
    ...diffNames(
      from.animations.map((animation) => animation.name),
      to.animations.map((animation) => animation.name),
    ),
    changed: [],
  };

  for (const [name, after] of toAnimations) {
    const before = fromAnimations.get(name);
    if (!before) continue;
    const boneDiff = diffNames(before.animatedBones, after.animatedBones);
    const changed =
      before.duration !== after.duration ||
      before.timelineCount !== after.timelineCount ||
      before.keyframeCount !== after.keyframeCount ||
      boneDiff.added.length > 0 ||
      boneDiff.removed.length > 0;

    if (changed) {
      animations.changed.push({
        name,
        durationFrom: before.duration,
        durationTo: after.duration,
        timelinesFrom: before.timelineCount,
        timelinesTo: after.timelineCount,
        keyframesFrom: before.keyframeCount,
        keyframesTo: after.keyframeCount,
        bones: boneDiff,
      });
    }
  }
  animations.changed.sort((a, b) => a.name.localeCompare(b.name));

  const constraints = {
    ik: diffNames(from.constraints.ik, to.constraints.ik),
    transform: diffNames(from.constraints.transform, to.constraints.transform),
    path: diffNames(from.constraints.path, to.constraints.path),
    physics: diffNames(from.constraints.physics, to.constraints.physics),
  };

  const events = diffNames(from.events.names, to.events.names);
  const skins = diffNames(from.skins.names, to.skins.names);

  const changeCount =
    bones.added.length +
    bones.removed.length +
    reparented.length +
    slots.added.length +
    slots.removed.length +
    changedSlots.length +
    (orderChanged ? 1 : 0) +
    skins.added.length +
    skins.removed.length +
    attachments.added.length +
    attachments.removed.length +
    attachments.changed.length +
    Object.values(constraints).reduce(
      (sum, diff) => sum + diff.added.length + diff.removed.length,
      0,
    ) +
    events.added.length +
    events.removed.length +
    animations.added.length +
    animations.removed.length +
    animations.changed.length;

  return {
    hashFrom: from.meta.hash,
    hashTo: to.meta.hash,
    hashChanged: from.meta.hash !== to.meta.hash,
    versionFrom: from.meta.spineVersion,
    versionTo: to.meta.spineVersion,
    bones: { ...bones, reparented },
    slots: { ...slots, changed: changedSlots, orderChanged },
    skins,
    attachments,
    constraints,
    events,
    animations,
    semanticallyIdentical: changeCount === 0,
    changeCount,
  };
}

function listLine(label: string, diff: NameDiff): string[] {
  const lines: string[] = [];
  if (diff.added.length > 0) lines.push(`  + ${label}: ${diff.added.join(', ')}`);
  if (diff.removed.length > 0) lines.push(`  - ${label}: ${diff.removed.join(', ')}`);
  return lines;
}

/** Human-readable diff summary. */
export function summarizeDiff(diff: SkeletonDiff): string {
  const lines: string[] = [];

  if (diff.versionFrom !== diff.versionTo) {
    lines.push(
      `Exported by different Spine versions: ${diff.versionFrom ?? 'unknown'} -> ${diff.versionTo ?? 'unknown'}. ` +
        'Runtime and editor versions must match, so a version change means the runtime needs updating too.',
    );
  }

  if (diff.semanticallyIdentical) {
    lines.push(
      diff.hashChanged
        ? 'No semantic differences, but the skeleton hash changed. A re-export can do that on its own; the data is equivalent for runtime purposes.'
        : 'Identical: same hash and no semantic differences.',
    );
    return lines.join('\n');
  }

  lines.push(
    `${diff.changeCount} difference(s). Hash ${diff.hashChanged ? 'changed' : 'unchanged'}.`,
  );

  lines.push(...listLine('bones', diff.bones));
  for (const bone of diff.bones.reparented) {
    lines.push(`  ~ bone ${bone.name} reparented: ${bone.from ?? '(root)'} -> ${bone.to ?? '(root)'}`);
  }

  lines.push(...listLine('slots', diff.slots));
  for (const slot of diff.slots.changed) {
    const parts: string[] = [];
    if (slot.boneTo !== undefined) parts.push(`bone ${slot.boneFrom ?? 'none'} -> ${slot.boneTo ?? 'none'}`);
    if (slot.blendTo !== undefined) parts.push(`blend ${slot.blendFrom} -> ${slot.blendTo}`);
    lines.push(`  ~ slot ${slot.name}: ${parts.join(', ')}`);
  }
  if (diff.slots.orderChanged) {
    lines.push('  ~ slot draw order changed, which changes what renders on top.');
  }

  lines.push(...listLine('skins', diff.skins));
  lines.push(...listLine('attachments', diff.attachments));
  for (const attachment of diff.attachments.changed) {
    const parts: string[] = [];
    if (attachment.typeTo !== undefined) {
      parts.push(`type ${attachment.typeFrom} -> ${attachment.typeTo}`);
    }
    if (attachment.regionTo !== undefined) {
      parts.push(`region ${attachment.regionFrom ?? 'none'} -> ${attachment.regionTo ?? 'none'}`);
    }
    lines.push(`  ~ attachment ${attachment.id}: ${parts.join(', ')}`);
  }

  for (const [kind, diffEntry] of Object.entries(diff.constraints)) {
    lines.push(...listLine(`${kind} constraints`, diffEntry));
  }

  lines.push(...listLine('events', diff.events));
  lines.push(...listLine('animations', diff.animations));
  for (const animation of diff.animations.changed) {
    const parts: string[] = [];
    if (animation.durationFrom !== animation.durationTo) {
      parts.push(
        `duration ${animation.durationFrom.toFixed(2)}s -> ${animation.durationTo.toFixed(2)}s`,
      );
    }
    if (animation.timelinesFrom !== animation.timelinesTo) {
      parts.push(`timelines ${animation.timelinesFrom} -> ${animation.timelinesTo}`);
    }
    if (animation.keyframesFrom !== animation.keyframesTo) {
      parts.push(`keyframes ${animation.keyframesFrom} -> ${animation.keyframesTo}`);
    }
    if (animation.bones.added.length > 0) {
      parts.push(`now animates ${animation.bones.added.join(', ')}`);
    }
    if (animation.bones.removed.length > 0) {
      parts.push(`no longer animates ${animation.bones.removed.join(', ')}`);
    }
    lines.push(`  ~ animation ${animation.name}: ${parts.join('; ')}`);
  }

  return lines.join('\n');
}
