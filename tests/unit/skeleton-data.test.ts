import {
  DEFAULT_FPS,
  inspectSkeleton,
  inspectSkeletonJson,
  parseSkeletonJson,
  readAnimation,
  readBones,
  readConstraints,
  readEvents,
  readMeta,
  readSkinsAndAttachments,
  readSlots,
  summarizeSkeleton,
} from '../../src/skeleton-data';
import { SpineErrorCode } from '../../src/types';
import {
  LEAN_SKELETON,
  MINIMAL_SKELETON,
  RICH_SKELETON,
  clone,
  toJsonText,
} from '../helpers/fixtures';

const rich = inspectSkeleton(clone(RICH_SKELETON) as Record<string, unknown>);

describe('parseSkeletonJson', () => {
  it('accepts valid skeleton data', () => {
    const result = parseSkeletonJson(toJsonText(MINIMAL_SKELETON));
    expect(result.ok).toBe(true);
  });

  it('rejects malformed JSON with a hint about the export format', () => {
    const result = parseSkeletonJson('{ skeleton: { spine: 4.2 } }');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ParseFailed);
    expect(result.hint).toContain('Minimal');
  });

  it('rejects a JSON array', () => {
    const result = parseSkeletonJson('[]');
    expect(!result.ok && result.code).toBe(SpineErrorCode.ParseFailed);
  });

  it('rejects JSON that is not skeleton data', () => {
    const result = parseSkeletonJson(toJsonText({ paddingX: 2, paddingY: 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
    expect(result.message).toContain('not skeleton data');
  });

  it('accepts data with bones but no skeleton section', () => {
    expect(parseSkeletonJson(toJsonText({ bones: [{ name: 'root' }] })).ok).toBe(true);
  });
});

describe('readMeta', () => {
  it('reads every metadata field', () => {
    const meta = readMeta(clone(RICH_SKELETON) as Record<string, unknown>);
    expect(meta.hash).toBe('Qq9tZ1example');
    expect(meta.spineVersion).toBe('4.2.37');
    expect(meta.width).toBe(400);
    expect(meta.images).toBe('./images/');
    expect(meta.fps).toBe(30);
  });

  it('defaults fps to 30 when omitted', () => {
    expect(readMeta({ skeleton: { hash: 'x' } }).fps).toBe(DEFAULT_FPS);
  });

  it('falls back to the `version` field name', () => {
    expect(readMeta({ skeleton: { version: '3.8.99' } }).spineVersion).toBe('3.8.99');
  });

  it('survives a missing skeleton section', () => {
    const meta = readMeta({});
    expect(meta.hash).toBeNull();
    expect(meta.fps).toBe(DEFAULT_FPS);
  });
});

describe('readBones', () => {
  it('measures the hierarchy', () => {
    expect(rich.bones.count).toBe(9);
    expect(rich.bones.rootCount).toBe(1);
    // root -> hip -> torso -> chest -> neck -> head
    expect(rich.bones.maxDepth).toBe(6);
    expect(rich.bones.deepestChain).toEqual([
      'root',
      'hip',
      'torso',
      'chest',
      'neck',
      'head',
    ]);
  });

  it('reports parents that were never declared', () => {
    const summary = readBones({
      bones: [{ name: 'root' }, { name: 'orphan', parent: 'ghost' }],
    });
    expect(summary.missingParents).toEqual(['ghost']);
  });

  it('reports duplicate bone names', () => {
    const summary = readBones({ bones: [{ name: 'root' }, { name: 'root' }] });
    expect(summary.duplicateNames).toEqual(['root']);
  });

  it('does not loop forever on a cyclic parent chain', () => {
    const summary = readBones({
      bones: [
        { name: 'a', parent: 'b' },
        { name: 'b', parent: 'a' },
      ],
    });
    expect(summary.count).toBe(2);
    expect(summary.maxDepth).toBeLessThanOrEqual(2);
  });

  it('handles a missing bones array', () => {
    expect(readBones({}).count).toBe(0);
  });
});

describe('readSlots', () => {
  it('counts slots, setup attachments and non-default blend modes', () => {
    expect(rich.slots.count).toBe(6);
    expect(rich.slots.withSetupAttachment).toBe(4);
    expect(rich.slots.blendModes).toEqual({ additive: 1, multiply: 1 });
  });

  it('flags slots bound to bones that do not exist', () => {
    const summary = readSlots(
      { slots: [{ name: 'hand', bone: 'ghost' }] },
      new Set(['root']),
    );
    expect(summary.danglingBoneRefs).toEqual(['hand -> ghost']);
  });

  it('skips the dangling check when no bones are known', () => {
    const summary = readSlots({ slots: [{ name: 'hand', bone: 'ghost' }] }, new Set());
    expect(summary.danglingBoneRefs).toEqual([]);
  });
});

describe('readSkinsAndAttachments', () => {
  it('counts attachments per skin and per type', () => {
    expect(rich.skins.count).toBe(2);
    expect(rich.skins.hasDefault).toBe(true);
    expect(rich.skins.attachmentCounts).toEqual({ default: 8, blue: 2 });
    expect(rich.attachments.total).toBe(10);
    expect(rich.attachments.byType).toEqual({
      region: 3,
      mesh: 2,
      linkedmesh: 1,
      boundingbox: 1,
      path: 1,
      point: 1,
      clipping: 1,
    });
  });

  it('treats an attachment without a type as a region', () => {
    const { attachments } = readSkinsAndAttachments(
      { skins: [{ name: 'default', attachments: { s: { a: { width: 1 } } } }] },
      ['s'],
    );
    expect(attachments.byType).toEqual({ region: 1 });
  });

  it('identifies weighted meshes by vertices longer than uvs', () => {
    const head = rich.attachments.meshes.find((mesh) => mesh.attachment === 'head');
    const torso = rich.attachments.meshes.find((mesh) => mesh.attachment === 'torso');
    expect(head?.weighted).toBe(true);
    expect(torso?.weighted).toBe(false);
    expect(head?.vertexCount).toBe(4);
    expect(torso?.triangleCount).toBe(2);
    expect(rich.attachments.maxMeshVertices).toBe(4);
  });

  it('collects the region keys the skeleton needs, preferring path over name', () => {
    expect(rich.attachments.regionKeys).toContain('fx/glow');
    expect(rich.attachments.regionKeys).toContain('blue/head');
    expect(rich.attachments.regionKeys).toContain('blue/torso');
    expect(rich.attachments.regionKeys).toContain('leg-left');
  });

  it('counts renamed attachments', () => {
    // fx/glow (path), blue/head (path), blue/torso (name)
    expect(rich.attachments.renamed).toBe(3);
  });

  it('lists slots that no skin provides an attachment for', () => {
    expect(rich.skins.slotsWithoutAttachments).toEqual(['shadow']);
  });

  it('handles a missing skins section', () => {
    const { skins, attachments } = readSkinsAndAttachments({}, []);
    expect(skins.count).toBe(0);
    expect(attachments.total).toBe(0);
  });
});

describe('readConstraints', () => {
  it('reads all four constraint kinds', () => {
    expect(rich.constraints.ik).toEqual(['leg-left-ik']);
    expect(rich.constraints.transform).toEqual(['head-follow']);
    expect(rich.constraints.path).toEqual(['walk-path']);
    expect(rich.constraints.physics).toEqual(['hair-physics']);
    expect(rich.constraints.total).toBe(4);
  });

  it('returns empty lists when there are none', () => {
    expect(readConstraints({}).total).toBe(0);
  });
});

describe('readEvents', () => {
  it('counts events and those carrying audio', () => {
    expect(rich.events.count).toBe(2);
    expect(rich.events.names).toEqual(['footstep', 'swing']);
    expect(rich.events.withAudio).toBe(1);
  });

  it('handles a missing events section', () => {
    expect(readEvents({}).count).toBe(0);
  });
});

describe('readAnimation', () => {
  it('derives duration from the largest keyframe time', () => {
    const walk = rich.animations.find((animation) => animation.name === 'walk')!;
    // The deform timeline reaches 1.25s, later than any bone timeline.
    expect(walk.duration).toBeCloseTo(1.25);
  });

  it('counts timelines per group', () => {
    const walk = rich.animations.find((animation) => animation.name === 'walk')!;
    expect(walk.groups).toEqual({
      bones: 3,
      slots: 1,
      deform: 1,
      events: 1,
      drawOrder: 1,
      ik: 1,
    });
    expect(walk.timelineCount).toBe(8);
  });

  it('counts keyframes and events', () => {
    const walk = rich.animations.find((animation) => animation.name === 'walk')!;
    // 7 bone + 2 slot + 2 deform + 2 event + 1 draw order + 1 IK keyframes
    expect(walk.keyframeCount).toBe(15);
    expect(walk.eventCount).toBe(2);
    expect(walk.animatedBones).toEqual(['hip', 'leg-left']);
  });

  it('treats an empty animation as zero length', () => {
    const empty = rich.animations.find((animation) => animation.name === 'empty')!;
    expect(empty.duration).toBe(0);
    expect(empty.timelineCount).toBe(0);
  });

  it('is independent of version-specific timeline key names', () => {
    // 3.8 used `angle`; 4.x uses `value`. Duration must work for both.
    const legacy = readAnimation('old', {
      bones: { bone: { rotate: [{ time: 0.4, angle: 10 }] } },
    });
    const modern = readAnimation('new', {
      bones: { bone: { rotate: [{ time: 0.4, value: 10 }] } },
    });
    expect(legacy.duration).toBeCloseTo(0.4);
    expect(modern.duration).toBeCloseTo(0.4);
  });

  it('handles an animation that is not an object', () => {
    const summary = readAnimation('broken', 'nope');
    expect(summary.timelineCount).toBe(0);
  });
});

describe('inspectSkeleton totals', () => {
  it('aggregates animation statistics', () => {
    expect(rich.totals.animationCount).toBe(3);
    expect(rich.totals.longestAnimation).toBe('idle');
    expect(rich.totals.longestDuration).toBeCloseTo(2);
    expect(rich.totals.timelineCount).toBe(9);
  });

  it('sorts animations by name', () => {
    expect(rich.animations.map((animation) => animation.name)).toEqual([
      'empty',
      'idle',
      'walk',
    ]);
  });
});

describe('nonessential data detection', () => {
  it('detects nonessential markers in a full export', () => {
    expect(rich.nonessential).toBe(true);
    expect(rich.nonessentialMarkers).toContain('skeleton.fps');
    expect(rich.nonessentialMarkers).toContain('skeleton.images');
    expect(rich.nonessentialMarkers).toContain('bones[].color');
    expect(rich.nonessentialMarkers).toContain('mesh.edges');
  });

  it('reports a lean export as missing nonessential data', () => {
    const report = inspectSkeleton(clone(LEAN_SKELETON) as Record<string, unknown>);
    expect(report.nonessential).toBe(false);
    expect(report.nonessentialMarkers).toEqual([]);
  });
});

describe('inspectSkeletonJson', () => {
  it('parses and inspects in one step', () => {
    const result = inspectSkeletonJson(toJsonText(RICH_SKELETON));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bones.count).toBe(9);
    expect(result.summary).toContain('9 bones');
  });

  it('propagates parse failures', () => {
    expect(inspectSkeletonJson('not json').ok).toBe(false);
  });

  it('handles the minimal skeleton', () => {
    const result = inspectSkeletonJson(toJsonText(MINIMAL_SKELETON));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bones.count).toBe(1);
    expect(result.data.totals.animationCount).toBe(0);
  });
});

describe('summarizeSkeleton', () => {
  it('mentions constraints, meshes, animations and round-trip readiness', () => {
    const summary = summarizeSkeleton(rich);
    expect(summary).toContain('Exported by Spine 4.2.37');
    expect(summary).toContain('1 IK, 1 transform, 1 path, 1 physics');
    expect(summary).toContain('Meshes: 2 (1 weighted)');
    expect(summary).toContain('walk (1.25s)');
    expect(summary).toContain('can be imported back into Spine');
  });

  it('warns when nonessential data is missing', () => {
    const report = inspectSkeleton(clone(LEAN_SKELETON) as Record<string, unknown>);
    expect(summarizeSkeleton(report)).toContain('Nonessential data missing');
  });
});
