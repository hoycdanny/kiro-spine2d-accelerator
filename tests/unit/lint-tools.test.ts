import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractConfig, loadLintConfig, skeletonLint } from '../../src/tools/lint-tools';
import { DEFAULT_LINT_CONFIG } from '../../src/lint-rules';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';
import {
  BROKEN_SKELETON,
  MISMATCHED_ATLAS,
  RICH_SKELETON,
  toJsonText,
} from '../helpers/fixtures';

const REPO_ROOT = join(__dirname, '..', '..');
const NAMING_TEMPLATE = readFileSync(
  join(REPO_ROOT, 'templates', 'lint-rules', 'naming.json'),
  'utf8',
);
const BUDGETS_TEMPLATE = readFileSync(
  join(REPO_ROOT, 'templates', 'lint-rules', 'budgets.json'),
  'utf8',
);

const host = createFakeHost({
  files: {
    'C:\\work\\project\\export\\hero.json': toJsonText(RICH_SKELETON),
    'C:\\work\\project\\export\\broken.json': toJsonText(BROKEN_SKELETON),
    'C:\\work\\project\\export\\hero.atlas': MISMATCHED_ATLAS,
    'C:\\work\\project\\rules\\naming.json': NAMING_TEMPLATE,
    'C:\\work\\project\\rules\\budgets.json': BUDGETS_TEMPLATE,
    'C:\\work\\project\\rules\\tight.json': toJsonText({
      budgets: { maxBones: 2 },
      disabled: ['naming/bone'],
    }),
    'C:\\work\\project\\rules\\bad.json': '{ oops',
  },
});

describe('extractConfig', () => {
  it('picks up the keys the template files own', () => {
    const naming = extractConfig(JSON.parse(NAMING_TEMPLATE));
    expect(naming.naming?.bone.pattern).toBe(DEFAULT_LINT_CONFIG.naming.bone.pattern);
    expect(naming.budgets).toBeUndefined();

    const budgets = extractConfig(JSON.parse(BUDGETS_TEMPLATE));
    expect(budgets.budgets?.maxBones).toBe(DEFAULT_LINT_CONFIG.budgets.maxBones);
    expect(budgets.durationOutlierFactor).toBe(
      DEFAULT_LINT_CONFIG.durationOutlierFactor,
    );
    expect(budgets.expectPremultipliedAlpha).toBeNull();
  });

  it('ignores non-object input', () => {
    expect(extractConfig(null)).toEqual({});
    expect(extractConfig([1, 2])).toEqual({});
    expect(extractConfig('x')).toEqual({});
  });

  it('keeps only string entries in disabled', () => {
    expect(extractConfig({ disabled: ['a', 2, null] }).disabled).toEqual(['a']);
  });
});

describe('the shipped rule templates match the built-in defaults', () => {
  it('naming.json equals DEFAULT_LINT_CONFIG.naming', () => {
    const parsed = JSON.parse(NAMING_TEMPLATE) as { naming: unknown };
    expect(parsed.naming).toEqual(DEFAULT_LINT_CONFIG.naming);
  });

  it('budgets.json equals DEFAULT_LINT_CONFIG.budgets', () => {
    const parsed = JSON.parse(BUDGETS_TEMPLATE) as { budgets: unknown };
    expect(parsed.budgets).toEqual(DEFAULT_LINT_CONFIG.budgets);
  });
});

describe('loadLintConfig', () => {
  it('returns the defaults when no files are given', () => {
    const result = loadLintConfig(host, []);
    expect(result.ok && result.data.budgets).toEqual(DEFAULT_LINT_CONFIG.budgets);
  });

  it('merges several files in order', () => {
    const result = loadLintConfig(host, [
      'rules/naming.json',
      'rules/budgets.json',
      'rules/tight.json',
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.budgets.maxBones).toBe(2);
    expect(result.data.budgets.maxSlots).toBe(DEFAULT_LINT_CONFIG.budgets.maxSlots);
    expect(result.data.disabled).toEqual(['naming/bone']);
  });

  it('reports a missing rules file', () => {
    const result = loadLintConfig(host, ['rules/nope.json']);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('reports invalid JSON in a rules file', () => {
    const result = loadLintConfig(host, ['rules/bad.json']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ParseFailed);
    expect(result.hint).toContain('JSON');
  });
});

describe('skeletonLint', () => {
  it('passes a clean skeleton and reports the atlas rules were skipped', () => {
    const result = skeletonLint(host, { input: 'export/hero.json' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lint.passed).toBe(true);
    expect(result.data.atlasFile).toBeNull();
    expect(result.summary).toContain('Atlas rules were skipped');
  });

  it('fails as GATE_FAILED on a broken skeleton', () => {
    const result = skeletonLint(host, { input: 'export/broken.json' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.GateFailed);
    expect(result.message).toContain('error(s)');
    expect(Array.isArray(result.details?.['findings'])).toBe(true);
  });

  it('runs the atlas rules when an atlas is given', () => {
    const result = skeletonLint(host, {
      input: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    // Missing regions are errors, so the gate fails.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const findings = result.details?.['findings'] as Array<{ id: string }>;
    expect(findings.some((finding) => finding.id === 'atlas/missing-region')).toBe(true);
  });

  it('applies rules files', () => {
    const result = skeletonLint(host, {
      input: 'export/hero.json',
      rules: ['rules/tight.json'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.data.lint.findings.some((finding) => finding.id === 'budget/bone-count'),
    ).toBe(true);
    expect(
      result.data.lint.findings.some((finding) => finding.id === 'naming/bone'),
    ).toBe(false);
  });

  it('honours failOn', () => {
    const result = skeletonLint(host, { input: 'export/hero.json', failOn: 'info' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('failOn=info');
  });

  it('lets the caller state the expected premultiply setting', () => {
    const result = skeletonLint(host, {
      input: 'export/hero.json',
      atlas: 'export/hero.atlas',
      expectPremultipliedAlpha: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const findings = result.details?.['findings'] as Array<{ id: string }>;
    expect(findings.some((finding) => finding.id === 'atlas/premultiply-mismatch')).toBe(
      true,
    );
  });

  it('reports a missing skeleton file', () => {
    const result = skeletonLint(host, { input: 'export/nope.json' });
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });
});
