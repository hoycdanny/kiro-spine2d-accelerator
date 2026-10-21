import { inspectAtlasText } from '../../src/atlas-data';
import {
  DEFAULT_LINT_CONFIG,
  LintFinding,
  compilePattern,
  isSafePattern,
  lintSkeleton,
  median,
  mergeLintConfig,
  summarizeLint,
} from '../../src/lint-rules';
import { inspectSkeleton } from '../../src/skeleton-data';
import {
  BROKEN_SKELETON,
  LEAN_SKELETON,
  MISMATCHED_ATLAS,
  MODERN_ATLAS,
  RICH_SKELETON,
  clone,
} from '../helpers/fixtures';

const brokenReport = inspectSkeleton(clone(BROKEN_SKELETON) as Record<string, unknown>);
const richReport = inspectSkeleton(clone(RICH_SKELETON) as Record<string, unknown>);

function ids(findings: LintFinding[]): string[] {
  return [...new Set(findings.map((finding) => finding.id))].sort();
}

function find(findings: LintFinding[], id: string): LintFinding[] {
  return findings.filter((finding) => finding.id === id);
}

describe('helpers', () => {
  it('rejects patterns with nested quantifiers', () => {
    expect(isSafePattern('^(a+)+$')).toBe(false);
    expect(isSafePattern('^[a-z-]+$')).toBe(true);
    expect(isSafePattern('a'.repeat(201))).toBe(false);
  });

  it('returns null for an invalid pattern', () => {
    expect(compilePattern('[')).toBeNull();
    expect(compilePattern('^(a+)+$')).toBeNull();
    expect(compilePattern('^ok$')).not.toBeNull();
  });

  it('computes the median for odd and even counts', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('mergeLintConfig', () => {
  it('returns the defaults for an empty override', () => {
    expect(mergeLintConfig(null).budgets).toEqual(DEFAULT_LINT_CONFIG.budgets);
  });

  it('overrides a single budget while keeping the rest', () => {
    const merged = mergeLintConfig({ budgets: { maxBones: 10 } as never });
    expect(merged.budgets.maxBones).toBe(10);
    expect(merged.budgets.maxSlots).toBe(DEFAULT_LINT_CONFIG.budgets.maxSlots);
  });

  it('merges one naming rule without dropping the others', () => {
    const merged = mergeLintConfig({
      naming: { bone: { pattern: '^.*$', severity: 'info' } } as never,
    });
    expect(merged.naming.bone.pattern).toBe('^.*$');
    expect(merged.naming.bone.severity).toBe('info');
    expect(merged.naming.slot).toEqual(DEFAULT_LINT_CONFIG.naming.slot);
  });

  it('ignores unknown naming kinds', () => {
    const merged = mergeLintConfig({
      naming: { nonsense: { pattern: 'x', severity: 'info' } } as never,
    });
    expect(Object.keys(merged.naming).sort()).toEqual(
      Object.keys(DEFAULT_LINT_CONFIG.naming).sort(),
    );
  });

  it('allows expectPremultipliedAlpha to be set to false', () => {
    expect(mergeLintConfig({ expectPremultipliedAlpha: false }).expectPremultipliedAlpha).toBe(
      false,
    );
  });

  it('applies overrides on top of a previous merge', () => {
    const first = mergeLintConfig({ budgets: { maxBones: 10 } as never });
    const second = mergeLintConfig({ budgets: { maxSlots: 5 } as never }, first);
    expect(second.budgets.maxBones).toBe(10);
    expect(second.budgets.maxSlots).toBe(5);
  });
});

describe('a clean skeleton', () => {
  const report = lintSkeleton(richReport);

  it('reports no errors', () => {
    expect(report.counts.error).toBe(0);
    expect(report.passed).toBe(true);
  });

  it('still reports the informational slot-without-attachment finding', () => {
    expect(find(report.findings, 'skins/slot-without-attachment')).toHaveLength(1);
  });

  it('sorts findings by severity', () => {
    const severities = report.findings.map((finding) => finding.severity);
    const sorted = [...severities].sort(
      (a, b) =>
        ({ error: 0, warning: 1, info: 2 })[a] - ({ error: 0, warning: 1, info: 2 })[b],
    );
    expect(severities).toEqual(sorted);
  });
});

describe('structure rules', () => {
  const report = lintSkeleton(brokenReport);

  it('flags more than one root bone', () => {
    const findings = find(report.findings, 'structure/root-bone');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.message).toContain('found 2');
  });

  it('flags a parent that was never declared', () => {
    expect(find(report.findings, 'structure/missing-parent')[0]!.subject).toBe('ghost');
  });

  it('flags duplicate bone and slot names', () => {
    expect(find(report.findings, 'structure/duplicate-bone')[0]!.subject).toBe('dup');
    expect(find(report.findings, 'structure/duplicate-slot')[0]!.subject).toBe('dupslot');
  });

  it('flags a slot bound to a missing bone', () => {
    expect(find(report.findings, 'structure/dangling-slot-bone')[0]!.message).toContain(
      'missing-bone',
    );
  });

  it('accepts a well-formed hierarchy', () => {
    expect(find(lintSkeleton(richReport).findings, 'structure/root-bone')).toHaveLength(0);
  });
});

describe('naming rules', () => {
  const report = lintSkeleton(brokenReport);

  it('flags CamelCase and spaced names across entity kinds', () => {
    expect(find(report.findings, 'naming/bone')[0]!.subject).toBe('SecondRoot');
    expect(find(report.findings, 'naming/slot')[0]!.subject).toBe('Head_Slot');
    expect(find(report.findings, 'naming/skin')[0]!.subject).toBe('Blue Skin');
    expect(find(report.findings, 'naming/animation')[0]!.subject).toBe('Walk');
    expect(find(report.findings, 'naming/event')[0]!.subject).toBe('Foot Step');
    expect(find(report.findings, 'naming/attachment')[0]!.subject).toBe('Weird Name');
  });

  it('exempts root and default by default', () => {
    expect(
      find(report.findings, 'naming/bone').some((finding) => finding.subject === 'root'),
    ).toBe(false);
    expect(
      find(lintSkeleton(richReport).findings, 'naming/skin').some(
        (finding) => finding.subject === 'default',
      ),
    ).toBe(false);
  });

  it('honours a custom pattern', () => {
    const report = lintSkeleton(brokenReport, {
      config: { naming: { bone: { pattern: '^.*$', severity: 'warning' } } as never },
    });
    expect(find(report.findings, 'naming/bone')).toHaveLength(0);
  });

  it('reports an unusable pattern instead of silently passing', () => {
    const report = lintSkeleton(richReport, {
      config: { naming: { bone: { pattern: '^(a+)+$', severity: 'warning' } } as never },
    });
    expect(find(report.findings, 'naming/bone')[0]!.message).toContain(
      'not a usable regular expression',
    );
  });
});

describe('skin rules', () => {
  it('flags a missing default skin', () => {
    expect(find(lintSkeleton(brokenReport).findings, 'skins/missing-default')).toHaveLength(
      1,
    );
  });

  it('flags a skeleton with slots but no attachments', () => {
    const report = lintSkeleton(
      inspectSkeleton({ bones: [{ name: 'root' }], slots: [{ name: 'a', bone: 'root' }] }),
    );
    expect(find(report.findings, 'skins/no-attachments')).toHaveLength(1);
  });
});

describe('animation rules', () => {
  const report = lintSkeleton(brokenReport);

  it('flags an animation with no timelines', () => {
    expect(find(report.findings, 'animation/empty')[0]!.subject).toBe('empty');
  });

  it('flags a duration outlier against the median', () => {
    const finding = find(report.findings, 'animation/duration-outlier')[0]!;
    expect(finding.subject).toBe('very-long');
    expect(finding.message).toContain('median');
  });

  it('flags an animation over the duration budget', () => {
    expect(find(report.findings, 'budget/animation-duration')[0]!.subject).toBe(
      'very-long',
    );
  });

  it('flags timelines with a zero duration', () => {
    const report = lintSkeleton(
      inspectSkeleton({
        bones: [{ name: 'root' }],
        animations: { pose: { bones: { root: { rotate: [{ time: 0, value: 1 }] } } } },
      }),
    );
    expect(find(report.findings, 'animation/zero-duration')[0]!.subject).toBe('pose');
  });

  it('flags animations over the timeline budget', () => {
    const report = lintSkeleton(richReport, {
      config: { budgets: { maxTimelinesPerAnimation: 2 } as never },
    });
    expect(find(report.findings, 'budget/timeline-count').length).toBeGreaterThan(0);
  });
});

describe('budget rules', () => {
  it('flags bone, slot and mesh budgets', () => {
    const report = lintSkeleton(richReport, {
      config: {
        budgets: {
          maxBones: 2,
          maxBoneDepth: 2,
          maxSlots: 2,
          maxMeshVertices: 1,
          maxTotalMeshVertices: 2,
        } as never,
      },
    });
    expect(ids(report.findings)).toEqual(
      expect.arrayContaining([
        'budget/bone-count',
        'budget/bone-depth',
        'budget/slot-count',
        'budget/mesh-vertices',
        'budget/total-mesh-vertices',
      ]),
    );
  });

  it('names the deepest chain so the problem is locatable', () => {
    const report = lintSkeleton(richReport, {
      config: { budgets: { maxBoneDepth: 2 } as never },
    });
    expect(find(report.findings, 'budget/bone-depth')[0]!.subject).toContain(
      'root > hip > torso',
    );
  });

  it('stays quiet when within budget', () => {
    const report = lintSkeleton(richReport);
    expect(
      report.findings.filter((finding) => finding.id.startsWith('budget/')),
    ).toHaveLength(0);
  });
});

describe('export rules', () => {
  it('flags missing nonessential data', () => {
    const report = lintSkeleton(inspectSkeleton(clone(LEAN_SKELETON) as never));
    expect(find(report.findings, 'export/nonessential-missing')).toHaveLength(1);
  });

  it('flags a missing hash and version', () => {
    const report = lintSkeleton(inspectSkeleton({ bones: [{ name: 'root' }] }));
    expect(find(report.findings, 'export/missing-hash')).toHaveLength(1);
    expect(find(report.findings, 'export/missing-version')).toHaveLength(1);
  });

  it('stays quiet for a full export', () => {
    expect(find(lintSkeleton(richReport).findings, 'export/nonessential-missing')).toHaveLength(
      0,
    );
  });
});

describe('atlas rules', () => {
  const mismatched = inspectAtlasText(MISMATCHED_ATLAS);
  const modern = inspectAtlasText(MODERN_ATLAS);
  if (!mismatched.ok || !modern.ok) throw new Error('fixture atlas failed to parse');

  it('skips atlas rules when no atlas is supplied', () => {
    const report = lintSkeleton(richReport);
    expect(report.findings.filter((finding) => finding.id.startsWith('atlas/'))).toHaveLength(
      0,
    );
  });

  it('flags regions the skeleton needs but the atlas lacks', () => {
    const report = lintSkeleton(richReport, { atlas: mismatched.data });
    const missing = find(report.findings, 'atlas/missing-region');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.severity).toBe('error');
  });

  it('flags duplicate region names', () => {
    const report = lintSkeleton(richReport, { atlas: mismatched.data });
    expect(find(report.findings, 'atlas/duplicate-region')[0]!.subject).toBe('twin');
  });

  it('flags unused atlas regions as info', () => {
    const report = lintSkeleton(richReport, { atlas: mismatched.data });
    expect(find(report.findings, 'atlas/unused-region')[0]!.severity).toBe('info');
  });

  it('flags mixed premultiplied alpha', () => {
    const report = lintSkeleton(richReport, { atlas: modern.data });
    expect(find(report.findings, 'atlas/mixed-premultiply')).toHaveLength(1);
  });

  it('flags pages disagreeing with the expected premultiply setting', () => {
    const report = lintSkeleton(richReport, {
      atlas: mismatched.data,
      config: { expectPremultipliedAlpha: true },
    });
    const finding = find(report.findings, 'atlas/premultiply-mismatch')[0]!;
    expect(finding.subject).toBe('page.png');
    expect(finding.message).toContain('expects true');
  });

  it('flags low packing efficiency and non power-of-two pages', () => {
    const report = lintSkeleton(richReport, { atlas: mismatched.data });
    expect(find(report.findings, 'budget/packing-efficiency')).toHaveLength(1);
    expect(find(report.findings, 'atlas/non-power-of-two')[0]!.subject).toBe('page.png');
  });

  it('flags too many atlas pages', () => {
    const report = lintSkeleton(richReport, {
      atlas: modern.data,
      config: { budgets: { maxAtlasPages: 1 } as never },
    });
    expect(find(report.findings, 'budget/atlas-pages')).toHaveLength(1);
  });
});

describe('gating and disabling', () => {
  it('fails on errors by default', () => {
    expect(lintSkeleton(brokenReport).passed).toBe(false);
  });

  it('passes a warning-only skeleton by default', () => {
    expect(lintSkeleton(inspectSkeleton(clone(LEAN_SKELETON) as never)).passed).toBe(true);
  });

  it('can fail on warnings', () => {
    const report = lintSkeleton(inspectSkeleton(clone(LEAN_SKELETON) as never), {
      failOn: 'warning',
    });
    expect(report.passed).toBe(false);
    expect(report.failOn).toBe('warning');
  });

  it('can fail on info', () => {
    expect(lintSkeleton(richReport, { failOn: 'info' }).passed).toBe(false);
  });

  it('skips disabled rules', () => {
    const report = lintSkeleton(brokenReport, {
      config: { disabled: ['structure/root-bone', 'naming/bone'] },
    });
    expect(find(report.findings, 'structure/root-bone')).toHaveLength(0);
    expect(find(report.findings, 'naming/bone')).toHaveLength(0);
    // Other rules still fire.
    expect(find(report.findings, 'structure/duplicate-bone')).toHaveLength(1);
  });

  it('lists the rules that triggered', () => {
    expect(lintSkeleton(brokenReport).triggeredRules).toEqual(
      ids(lintSkeleton(brokenReport).findings),
    );
  });
});

describe('summarizeLint', () => {
  it('reports a clean run', () => {
    const report = lintSkeleton(
      inspectSkeleton({
        // fps and images are nonessential markers, so the round-trip rule
        // stays quiet and this skeleton is genuinely finding-free.
        skeleton: { hash: 'h', spine: '4.2.37', fps: 30, images: './images/' },
        bones: [{ name: 'root' }],
      }),
    );
    expect(summarizeLint(report)).toContain('no findings');
  });

  it('groups findings by severity with fixes', () => {
    const summary = summarizeLint(lintSkeleton(brokenReport));
    expect(summary).toContain('ERROR:');
    expect(summary).toContain('WARNING:');
    expect(summary).toContain('fix:');
    expect(summary).toContain('gate failed');
  });
});
