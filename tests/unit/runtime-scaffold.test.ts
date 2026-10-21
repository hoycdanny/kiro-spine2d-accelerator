import { inspectAtlasText } from '../../src/atlas-data';
import {
  DEFAULT_MIX_SECONDS,
  RUNTIME_TARGETS,
  checkCompatibility,
  planScaffold,
  suggestMixTable,
} from '../../src/runtime-scaffold';
import { inspectSkeleton } from '../../src/skeleton-data';
import { runtimeScaffold } from '../../src/tools/scaffold-tools';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';
import {
  MODERN_ATLAS,
  RENDERABLE_ATLAS,
  RICH_SKELETON,
  clone,
  toJsonText,
} from '../helpers/fixtures';

const report = inspectSkeleton(clone(RICH_SKELETON) as Record<string, unknown>);
const atlasReport = (() => {
  const parsed = inspectAtlasText(RENDERABLE_ATLAS);
  if (!parsed.ok) throw new Error('fixture atlas failed to parse');
  return parsed.data;
})();

function planFor(target: (typeof RUNTIME_TARGETS)[number], overrides = {}) {
  return planScaffold({
    target,
    skeletonFileName: 'hero.json',
    atlasFileName: 'hero.atlas',
    pageFileNames: ['hero.png'],
    report,
    atlas: atlasReport,
    name: 'hero',
    ...overrides,
  });
}

describe('checkCompatibility', () => {
  it('derives the runtime branch from the exporting editor version', () => {
    const result = checkCompatibility(report, atlasReport, 'unity');
    expect(result.runtimeBranch).toBe('4.2');
    expect(result.blockers).toEqual([]);
    expect(result.warnings.join(' ')).toContain('spine-runtimes 4.2 branch');
  });

  it('blocks when the data records no Spine version', () => {
    const versionless = inspectSkeleton({ bones: [{ name: 'root' }] });
    const result = checkCompatibility(versionless, null, 'web');
    expect(result.blockers.join(' ')).toContain('no Spine version');
  });

  it('blocks on mixed premultiplied alpha', () => {
    const mixed = inspectAtlasText(MODERN_ATLAS);
    if (!mixed.ok) throw new Error('fixture atlas failed to parse');
    const result = checkCompatibility(report, mixed.data, 'unity');
    expect(result.blockers.join(' ')).toContain('premultiplied alpha');
  });

  it('warns about multi-page atlases', () => {
    const mixed = inspectAtlasText(MODERN_ATLAS);
    if (!mixed.ok) throw new Error('fixture atlas failed to parse');
    const result = checkCompatibility(report, mixed.data, 'unity');
    expect(result.warnings.join(' ')).toContain('SkeletonGraphic');
  });

  it('warns a Unity target about premultiplied pages and colour space', () => {
    const pma = inspectAtlasText(RENDERABLE_ATLAS.replace('pma: false', 'pma: true'));
    if (!pma.ok) throw new Error('fixture atlas failed to parse');
    const result = checkCompatibility(report, pma.data, 'unity');
    expect(result.warnings.join(' ')).toContain('Linear');
  });

  it('warns when there are no animations', () => {
    const still = inspectSkeleton({
      skeleton: { spine: '4.2.37' },
      bones: [{ name: 'root' }],
    });
    expect(checkCompatibility(still, null, 'web').warnings.join(' ')).toContain(
      'no animations',
    );
  });
});

describe('suggestMixTable', () => {
  it('skips animations with no timelines and self-pairs', () => {
    const table = suggestMixTable(report);
    expect(table.every((entry) => entry.from !== entry.to)).toBe(true);
    expect(table.some((entry) => entry.from === 'empty' || entry.to === 'empty')).toBe(
      false,
    );
  });

  it('explains every suggestion', () => {
    for (const entry of suggestMixTable(report)) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.seconds).toBeGreaterThan(0);
    }
  });

  it('caps the mix at half of the shorter animation', () => {
    const shortReport = inspectSkeleton({
      skeleton: { spine: '4.2.37' },
      bones: [{ name: 'root' }],
      animations: {
        quick: { bones: { root: { rotate: [{ time: 0.2, value: 1 }] } } },
        slow: { bones: { root: { rotate: [{ time: 4, value: 1 }] } } },
      },
    });
    const table = suggestMixTable(shortReport);
    for (const entry of table) {
      expect(entry.seconds).toBeLessThanOrEqual(0.1);
      expect(entry.reason).toContain('capped');
    }
  });

  it('suggests a longer blend when the animations share bones', () => {
    const shared = inspectSkeleton({
      skeleton: { spine: '4.2.37' },
      bones: [{ name: 'root' }],
      animations: {
        walk: { bones: { root: { rotate: [{ time: 2, value: 1 }] } } },
        run: { bones: { root: { rotate: [{ time: 2, value: 2 }] } } },
      },
    });
    const table = suggestMixTable(shared);
    expect(table[0]!.seconds).toBe(0.3);
    expect(table[0]!.reason).toContain('shared');
  });

  it('caps the number of pairs', () => {
    const animations: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      animations[`a${i}`] = {
        bones: { root: { rotate: [{ time: 1 + i, value: i }] } },
      };
    }
    const many = inspectSkeleton({
      skeleton: { spine: '4.2.37' },
      bones: [{ name: 'root' }],
      animations,
    });
    expect(suggestMixTable(many).length).toBeLessThanOrEqual(24 + 10);
  });
});

describe('planScaffold — unity', () => {
  const plan = planFor('unity');

  it('requires the .atlas.txt rename', () => {
    const atlas = plan.placements.find((placement) => placement.from === 'hero.atlas')!;
    expect(atlas.to).toBe('hero.atlas.txt');
    expect(atlas.reason).toContain('.atlas.txt');
  });

  it('leaves a JSON skeleton alone', () => {
    const skeleton = plan.placements.find((placement) => placement.from === 'hero.json')!;
    expect(skeleton.to).toBe('hero.json');
    expect(skeleton.reason).toBeNull();
  });

  it('requires the .skel.bytes rename for binary data', () => {
    const binary = planFor('unity', { skeletonFileName: 'hero.skel' });
    const skeleton = binary.placements.find((placement) => placement.from === 'hero.skel')!;
    expect(skeleton.to).toBe('hero.skel.bytes');
    expect(skeleton.reason).toContain('.skel.bytes');
  });

  it('does not re-flag an already correct name', () => {
    const binary = planFor('unity', { skeletonFileName: 'hero.skel.bytes' });
    const skeleton = binary.placements.find(
      (placement) => placement.from === 'hero.skel.bytes',
    )!;
    expect(skeleton.reason).toBeNull();
  });

  it('generates a C# controller with the mix table', () => {
    const code = plan.files.find((file) => file.path.endsWith('.cs'))!;
    expect(code.path).toBe('HeroController.cs');
    expect(code.content).toContain('using Spine.Unity;');
    expect(code.content).toContain('SetAnimation(0,');
    expect(code.content).toContain('data.SetMix(');
    expect(code.content).toContain(`data.DefaultMix = ${DEFAULT_MIX_SECONDS}f;`);
  });

  it('documents the generated Unity assets in the steps', () => {
    expect(plan.steps.join(' ')).toContain('_SkeletonData');
  });

  it('writes a README with the rename table and animations', () => {
    const readme = plan.files.find((file) => file.path === 'README.md')!;
    expect(readme.content).toContain('# hero — unity integration');
    expect(readme.content).toContain('hero.atlas.txt');
    expect(readme.content).toContain('| walk | 1.25s |');
    expect(readme.content).toContain('## Suggested mixes');
  });
});

describe('planScaffold — web', () => {
  const plan = planFor('web');

  it('needs no renames', () => {
    expect(plan.placements.every((placement) => placement.reason === null)).toBe(true);
  });

  it('pins the runtime package to the matching branch', () => {
    const code = plan.files.find((file) => file.path.endsWith('.ts'))!;
    expect(code.content).toContain('@esotericsoftware/spine-webgl@4.2');
    expect(plan.steps.join(' ')).toContain('spine-webgl@4.2');
  });

  it('uses the 4.2 physics argument', () => {
    const code = plan.files.find((file) => file.path.endsWith('.ts'))!;
    expect(code.content).toContain('updateWorldTransform(spine.Physics.update)');
  });

  it('warns that file:// will not work', () => {
    expect(plan.steps.join(' ')).toContain('file://');
  });
});

describe('planScaffold — godot', () => {
  const plan = planFor('godot');

  it('requires the .spine-json rename', () => {
    const skeleton = plan.placements.find((placement) => placement.from === 'hero.json')!;
    expect(skeleton.to).toBe('hero.spine-json');
    expect(skeleton.reason).toContain('.spine-json');
  });

  it('leaves binary data alone', () => {
    const binary = planFor('godot', { skeletonFileName: 'hero.skel' });
    const skeleton = binary.placements.find((placement) => placement.from === 'hero.skel')!;
    expect(skeleton.reason).toBeNull();
  });

  it('generates a GDScript controller', () => {
    const code = plan.files.find((file) => file.path.endsWith('.gd'))!;
    expect(code.content).toContain('extends SpineSprite');
    expect(code.content).toContain('set_mix_by_name');
  });

  it('explains the two integration options', () => {
    expect(plan.steps.join(' ')).toContain('GDExtension');
    expect(plan.steps.join(' ')).toContain('custom C++ engine module');
  });
});

describe('runtimeScaffold tool', () => {
  const SKELETON = 'C:\\work\\project\\export\\hero.json';
  const ATLAS = 'C:\\work\\project\\export\\hero.atlas';

  function host() {
    return createFakeHost({
      files: {
        [SKELETON]: toJsonText(RICH_SKELETON),
        [ATLAS]: RENDERABLE_ATLAS,
        'C:\\work\\project\\export\\mixed.atlas': MODERN_ATLAS,
      },
    });
  }

  it('previews without writing', () => {
    const fake = host();
    const result = runtimeScaffold(fake, {
      target: 'unity',
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outputDir).toBeNull();
    expect(Object.keys(fake.writes)).toEqual([]);
    expect(result.summary).toContain('Not written to disk');
    expect(result.summary).toContain('hero.atlas -> hero.atlas.txt');
  });

  it('writes the scaffold files', () => {
    const fake = host();
    const result = runtimeScaffold(fake, {
      target: 'unity',
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      outputDir: 'integration/unity',
      name: 'Hero',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.written).toEqual([
      'C:\\work\\project\\integration\\unity\\HeroController.cs',
      'C:\\work\\project\\integration\\unity\\README.md',
    ]);
    expect(fake.writes[result.data.written[0]!]).toContain('class HeroController');
  });

  it('works without an atlas but skips the atlas checks', () => {
    const result = runtimeScaffold(host(), {
      target: 'web',
      skeleton: 'export/hero.json',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.atlasFile).toBeNull();
    expect(result.data.plan.warnings.join(' ')).not.toContain('SkeletonGraphic');
  });

  it('fails on a blocker and says what to fix', () => {
    const result = runtimeScaffold(host(), {
      target: 'unity',
      skeleton: 'export/hero.json',
      atlas: 'export/mixed.atlas',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
    expect(result.message).toContain('premultiplied alpha');
    expect(result.hint).toContain('Fix the blockers');
  });

  it('refuses an output directory outside the workspace', () => {
    const result = runtimeScaffold(host(), {
      target: 'web',
      skeleton: 'export/hero.json',
      outputDir: '../escape',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });

  it('reports a missing skeleton', () => {
    const result = runtimeScaffold(host(), {
      target: 'web',
      skeleton: 'export/nope.json',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('mentions the Unity hand-off', () => {
    const result = runtimeScaffold(host(), {
      target: 'unity',
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    expect(result.ok && result.summary).toContain('Unity generates the _Atlas');
  });
});
