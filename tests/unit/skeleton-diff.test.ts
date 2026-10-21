import { inspectSkeleton } from '../../src/skeleton-data';
import { diffSkeletons, summarizeDiff } from '../../src/skeleton-diff';
import { skeletonDiff } from '../../src/tools/data-tools';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';
import { RICH_SKELETON, clone, toJsonText } from '../helpers/fixtures';

type Mutable = Record<string, any>;

function report(mutate: (data: Mutable) => void = () => {}) {
  const data = clone(RICH_SKELETON) as Mutable;
  mutate(data);
  return inspectSkeleton(data);
}

const baseline = report();

describe('identical skeletons', () => {
  it('reports no differences', () => {
    const diff = diffSkeletons(baseline, report());
    expect(diff.semanticallyIdentical).toBe(true);
    expect(diff.changeCount).toBe(0);
    expect(diff.hashChanged).toBe(false);
    expect(summarizeDiff(diff)).toContain('Identical');
  });

  it('separates a hash change from a data change', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['skeleton'].hash = 'different-hash';
      }),
    );
    expect(diff.hashChanged).toBe(true);
    expect(diff.semanticallyIdentical).toBe(true);
    expect(summarizeDiff(diff)).toContain('the data is equivalent');
  });
});

describe('bone changes', () => {
  it('reports added and removed bones', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['bones'] = data['bones'].filter((bone: Mutable) => bone.name !== 'neck');
        data['bones'].push({ name: 'tail', parent: 'hip' });
      }),
    );
    expect(diff.bones.added).toEqual(['tail']);
    expect(diff.bones.removed).toEqual(['neck']);
  });

  it('reports a reparented bone', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        const head = data['bones'].find((bone: Mutable) => bone.name === 'head');
        head.parent = 'chest';
      }),
    );
    expect(diff.bones.reparented).toEqual([
      { name: 'head', from: 'neck', to: 'chest' },
    ]);
    expect(summarizeDiff(diff)).toContain('reparented: neck -> chest');
  });

  it('describes a new root bone as (root)', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        const hip = data['bones'].find((bone: Mutable) => bone.name === 'hip');
        delete hip.parent;
      }),
    );
    expect(summarizeDiff(diff)).toContain('root -> (root)');
  });
});

describe('slot changes', () => {
  it('reports added and removed slots', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['slots'].push({ name: 'cape', bone: 'chest' });
      }),
    );
    expect(diff.slots.added).toEqual(['cape']);
  });

  it('reports a slot rebound to another bone', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['slots'].find((slot: Mutable) => slot.name === 'head').bone = 'chest';
      }),
    );
    expect(diff.slots.changed).toEqual([
      { name: 'head', boneFrom: 'head', boneTo: 'chest' },
    ]);
  });

  it('reports a blend mode change', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['slots'].find((slot: Mutable) => slot.name === 'glow').blend = 'screen';
      }),
    );
    expect(diff.slots.changed[0]).toEqual({
      name: 'glow',
      blendFrom: 'additive',
      blendTo: 'screen',
    });
  });

  it('reports a draw order change', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        const slots = data['slots'];
        [slots[0], slots[1]] = [slots[1], slots[0]];
      }),
    );
    expect(diff.slots.orderChanged).toBe(true);
    expect(summarizeDiff(diff)).toContain('renders on top');
  });

  it('does not treat an added slot as a reorder', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['slots'].unshift({ name: 'backdrop', bone: 'root' });
      }),
    );
    expect(diff.slots.orderChanged).toBe(false);
    expect(diff.slots.added).toEqual(['backdrop']);
  });
});

describe('attachment changes', () => {
  it('reports an added attachment with its skin and slot', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['skins'][0].attachments['head']['helmet'] = { width: 10, height: 10 };
      }),
    );
    expect(diff.attachments.added).toEqual(['default/head/helmet']);
  });

  it('reports a changed attachment type', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['skins'][0].attachments['glow']['glow'] = {
          type: 'point',
          x: 0,
          y: 0,
        };
      }),
    );
    expect(diff.attachments.changed[0]).toMatchObject({
      id: 'default/glow/glow',
      typeFrom: 'region',
      typeTo: 'point',
    });
  });

  it('reports a changed region path', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['skins'][0].attachments['glow']['glow'].path = 'fx/glow2';
      }),
    );
    expect(diff.attachments.changed[0]).toMatchObject({
      regionFrom: 'fx/glow',
      regionTo: 'fx/glow2',
    });
    expect(summarizeDiff(diff)).toContain('region fx/glow -> fx/glow2');
  });
});

describe('constraint, skin and event changes', () => {
  it('reports constraint changes per kind', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['ik'] = [];
        data['physics'].push({ name: 'cape-physics', bone: 'chest' });
      }),
    );
    expect(diff.constraints.ik.removed).toEqual(['leg-left-ik']);
    expect(diff.constraints.physics.added).toEqual(['cape-physics']);
    expect(summarizeDiff(diff)).toContain('physics constraints');
  });

  it('reports a removed skin', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['skins'] = data['skins'].filter((skin: Mutable) => skin.name !== 'blue');
      }),
    );
    expect(diff.skins.removed).toEqual(['blue']);
  });

  it('reports event changes', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        delete data['events']['swing'];
        data['events']['land'] = { int: 0 };
      }),
    );
    expect(diff.events.added).toEqual(['land']);
    expect(diff.events.removed).toEqual(['swing']);
  });
});

describe('animation changes', () => {
  it('reports added and removed animations', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        delete data['animations']['idle'];
        data['animations']['run'] = {
          bones: { hip: { rotate: [{ time: 0.5, value: 5 }] } },
        };
      }),
    );
    expect(diff.animations.added).toEqual(['run']);
    expect(diff.animations.removed).toEqual(['idle']);
  });

  it('reports a duration change', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['animations']['idle'].bones.head.rotate[1].time = 5;
      }),
    );
    const change = diff.animations.changed[0]!;
    expect(change.name).toBe('idle');
    expect(change.durationFrom).toBeCloseTo(2);
    expect(change.durationTo).toBeCloseTo(5);
    expect(summarizeDiff(diff)).toContain('duration 2.00s -> 5.00s');
  });

  it('reports timeline and keyframe count changes', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['animations']['idle'].bones.head.translate = [{ time: 1, x: 2, y: 3 }];
      }),
    );
    const change = diff.animations.changed[0]!;
    expect(change.timelinesFrom).toBe(1);
    expect(change.timelinesTo).toBe(2);
    expect(change.keyframesTo).toBe(3);
  });

  it('reports which bones an animation gained or lost', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['animations']['idle'].bones['arm-left'] = {
          rotate: [{ time: 1, value: 4 }],
        };
      }),
    );
    expect(diff.animations.changed[0]!.bones.added).toEqual(['arm-left']);
    expect(summarizeDiff(diff)).toContain('now animates arm-left');
  });

  it('ignores a reordering of the same animations', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        const animations = data['animations'];
        data['animations'] = {
          idle: animations.idle,
          walk: animations.walk,
          empty: animations.empty,
        };
      }),
    );
    expect(diff.animations.changed).toEqual([]);
    expect(diff.semanticallyIdentical).toBe(true);
  });
});

describe('version changes', () => {
  it('warns when the exporting Spine version differs', () => {
    const diff = diffSkeletons(
      baseline,
      report((data) => {
        data['skeleton'].spine = '4.3.26';
      }),
    );
    expect(summarizeDiff(diff)).toContain('different Spine versions');
    expect(summarizeDiff(diff)).toContain('runtime needs updating');
  });
});

describe('skeletonDiff tool', () => {
  const host = createFakeHost({
    files: {
      'C:\\work\\project\\a.json': toJsonText(RICH_SKELETON),
      'C:\\work\\project\\b.json': toJsonText(
        (() => {
          const data = clone(RICH_SKELETON) as Mutable;
          delete data['animations']['idle'];
          return data;
        })(),
      ),
      'C:\\work\\project\\bad.json': 'not json',
    },
  });

  it('diffs two files', () => {
    const result = skeletonDiff(host, { from: 'a.json', to: 'b.json' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.diff.animations.removed).toEqual(['idle']);
    expect(result.data.fromFile).toBe('C:\\work\\project\\a.json');
    expect(result.summary).toContain('animations: idle');
  });

  it('reports a missing baseline', () => {
    const result = skeletonDiff(host, { from: 'missing.json', to: 'b.json' });
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('reports a parse failure in either file', () => {
    expect(skeletonDiff(host, { from: 'a.json', to: 'bad.json' }).ok).toBe(false);
    expect(skeletonDiff(host, { from: 'bad.json', to: 'a.json' }).ok).toBe(false);
  });
});
