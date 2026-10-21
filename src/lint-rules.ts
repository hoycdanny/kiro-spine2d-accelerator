// ============================================================
// Skeleton and atlas linting.
//
// Rules fall into five families:
//   naming/*     team conventions on bone, slot, skin, animation names
//   structure/*  invariants the Spine data reader or runtimes rely on
//   skins/*      skin and attachment coverage
//   animation/*  empty animations, duration outliers
//   budget/*     team-chosen limits (bone count, mesh vertices, …)
//   atlas/*      atlas problems, including ones only visible when the
//                skeleton and atlas are checked together
//   export/*     export settings that break a Spine round trip
//
// Every finding carries a severity, the subject it is about, and a
// concrete fix. The report is gate-ready: `failOn` decides the exit status
// so CI can block on errors while still surfacing warnings.
// ============================================================

import { AtlasReport, crossCheckRegions } from './atlas-data';
import { SkeletonReport } from './skeleton-data';

/** Finding severity, ordered from most to least serious. */
export type Severity = 'error' | 'warning' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** A single rule violation. */
export interface LintFinding {
  /** Stable rule id, e.g. `naming/bone`. */
  id: string;
  severity: Severity;
  /** What is wrong. */
  message: string;
  /** What to do about it. */
  fix: string;
  /** The bone, slot, animation or page the finding is about. */
  subject?: string;
}

/** A naming convention for one kind of entity. */
export interface NamingRule {
  /** Regular expression the name must match. */
  pattern: string;
  severity: Severity;
  /** Names exempt from the rule, e.g. `root` or `default`. */
  exempt?: string[];
}

/** Numeric limits a team chooses to enforce. */
export interface LintBudgets {
  maxBones: number;
  maxBoneDepth: number;
  maxSlots: number;
  maxMeshVertices: number;
  maxTotalMeshVertices: number;
  maxAnimationDuration: number;
  maxTimelinesPerAnimation: number;
  maxAtlasPages: number;
  minPackingEfficiency: number;
}

/** Full lint configuration. */
export interface LintConfig {
  naming: {
    bone: NamingRule;
    slot: NamingRule;
    skin: NamingRule;
    animation: NamingRule;
    event: NamingRule;
    attachment: NamingRule;
  };
  budgets: LintBudgets;
  /** Rule ids to skip entirely. */
  disabled: string[];
  /**
   * What the runtime expects for premultiplied alpha. When set, atlas pages
   * that disagree are reported: PMA has to match how the runtime blends, or
   * edges render wrong.
   */
  expectPremultipliedAlpha: boolean | null;
  /**
   * An animation is an outlier when its duration exceeds the median by this
   * factor. Catches a stray 60-second animation among 1-second loops.
   */
  durationOutlierFactor: number;
}

/**
 * Defaults mirror `templates/lint-rules/naming.json` and
 * `templates/lint-rules/budgets.json`, which are the editable copies.
 *
 * The naming pattern is kebab-case with optional slash-separated
 * namespaces, which is the convention Spine's own example projects follow
 * (`head`, `front-upper-arm`, `blue/pelvis`).
 */
export const DEFAULT_LINT_CONFIG: LintConfig = {
  naming: {
    bone: {
      pattern: '^[a-z0-9]+(?:[-_][a-z0-9]+)*$',
      severity: 'warning',
      exempt: ['root'],
    },
    slot: {
      pattern: '^[a-z0-9]+(?:[-_][a-z0-9]+)*$',
      severity: 'warning',
      exempt: [],
    },
    skin: {
      pattern: '^[a-z0-9]+(?:[-_/][a-z0-9]+)*$',
      severity: 'warning',
      exempt: ['default'],
    },
    animation: {
      pattern: '^[a-z0-9]+(?:[-_][a-z0-9]+)*$',
      severity: 'warning',
      exempt: [],
    },
    event: { pattern: '^[a-z0-9]+(?:[-_][a-z0-9]+)*$', severity: 'info', exempt: [] },
    attachment: {
      pattern: '^[a-z0-9]+(?:[-_/][a-z0-9]+)*$',
      severity: 'info',
      exempt: [],
    },
  },
  budgets: {
    maxBones: 150,
    maxBoneDepth: 12,
    maxSlots: 120,
    maxMeshVertices: 200,
    maxTotalMeshVertices: 2000,
    maxAnimationDuration: 30,
    maxTimelinesPerAnimation: 400,
    maxAtlasPages: 4,
    minPackingEfficiency: 0.6,
  },
  disabled: [],
  expectPremultipliedAlpha: null,
  durationOutlierFactor: 4,
};

/** Deep-merge a partial configuration over the defaults. */
export function mergeLintConfig(
  override: Partial<LintConfig> | null | undefined,
  base: LintConfig = DEFAULT_LINT_CONFIG,
): LintConfig {
  if (!override) return { ...base, naming: { ...base.naming }, budgets: { ...base.budgets } };

  const naming = { ...base.naming };
  for (const [key, rule] of Object.entries(override.naming ?? {})) {
    const typedKey = key as keyof LintConfig['naming'];
    if (base.naming[typedKey]) {
      naming[typedKey] = { ...base.naming[typedKey], ...rule };
    }
  }

  return {
    naming,
    budgets: { ...base.budgets, ...(override.budgets ?? {}) },
    disabled: override.disabled ?? base.disabled,
    expectPremultipliedAlpha:
      override.expectPremultipliedAlpha === undefined
        ? base.expectPremultipliedAlpha
        : override.expectPremultipliedAlpha,
    durationOutlierFactor: override.durationOutlierFactor ?? base.durationOutlierFactor,
  };
}

const MAX_PATTERN_LENGTH = 200;

/** A group followed by a quantifier, e.g. `(a+)+` or `(?:x|y)*`. */
const QUANTIFIED_GROUP = /\((\?:)?([^()]*)\)\s*(?:[*+]|\{\d+(?:,\d*)?\})/g;

/** A group body that is one quantified atom, e.g. `a+`, `[a-z]*`, `\w+`. */
const SINGLE_QUANTIFIED_ATOM =
  /^(?:\\.|\[[^\]]*\]|[^\\[\]|])(?:[*+]|\{\d+(?:,\d*)?\})$/;

/**
 * Reject patterns that are too long, or that nest a quantifier directly
 * around a single quantified atom — the `(a+)+` shape behind catastrophic
 * backtracking. Rules files are developer-supplied, but a typo should not
 * hang the linter.
 *
 * `(?:[-_][a-z0-9]+)*` is deliberately allowed: each repetition must start
 * with a separator, so the alternatives cannot overlap the way `(a+)+` does.
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;

  QUANTIFIED_GROUP.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUANTIFIED_GROUP.exec(pattern)) !== null) {
    const body = match[2] ?? '';
    if (SINGLE_QUANTIFIED_ATOM.test(body)) return false;
  }

  return true;
}

/** Compile a naming pattern, returning null when it is unusable. */
export function compilePattern(pattern: string): RegExp | null {
  if (!isSafePattern(pattern)) return null;
  try {
    // nosemgrep: detect-non-literal-regexp -- validated by isSafePattern
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Median of a numeric list; 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/** Options for a lint run. */
export interface LintOptions {
  config?: Partial<LintConfig> | null;
  /** Atlas report, enabling the `atlas/*` rules. */
  atlas?: AtlasReport | null;
  /** Severity at or above which the run is considered failed. */
  failOn?: Severity;
}

/** The outcome of a lint run. */
export interface LintReport {
  findings: LintFinding[];
  counts: Record<Severity, number>;
  /** Rule ids that produced at least one finding. */
  triggeredRules: string[];
  failOn: Severity;
  /** False when any finding is at or above `failOn`. CI gates on this. */
  passed: boolean;
  config: LintConfig;
}

class FindingCollector {
  readonly findings: LintFinding[] = [];

  constructor(private readonly disabled: Set<string>) {}

  add(finding: LintFinding): void {
    if (this.disabled.has(finding.id)) return;
    this.findings.push(finding);
  }
}

function lintNames(
  collector: FindingCollector,
  kind: keyof LintConfig['naming'],
  names: string[],
  rule: NamingRule,
): void {
  const regex = compilePattern(rule.pattern);
  const id = `naming/${kind}`;

  if (regex === null) {
    collector.add({
      id,
      severity: 'warning',
      message: `The ${kind} naming pattern "${rule.pattern}" is not a usable regular expression.`,
      fix: 'Fix the pattern in the lint rules file. Patterns are rejected when longer than 200 characters or when they contain nested quantifiers.',
    });
    return;
  }

  const exempt = new Set(rule.exempt ?? []);
  for (const name of names) {
    if (exempt.has(name)) continue;
    if (regex.test(name)) continue;
    collector.add({
      id,
      severity: rule.severity,
      subject: name,
      message: `${kind} "${name}" does not match the naming convention ${rule.pattern}.`,
      fix: `Rename it to match, or add it to the "exempt" list for ${kind} names in the lint rules file.`,
    });
  }
}

function lintStructure(collector: FindingCollector, report: SkeletonReport): void {
  if (report.bones.count > 0 && report.bones.rootCount !== 1) {
    collector.add({
      id: 'structure/root-bone',
      severity: 'error',
      message: `Expected exactly one root bone, found ${report.bones.rootCount}.`,
      fix: 'A skeleton must have a single root. Re-parent the extra roots in Spine, or check that the export was not truncated.',
    });
  }

  for (const parent of report.bones.missingParents) {
    collector.add({
      id: 'structure/missing-parent',
      severity: 'error',
      subject: parent,
      message: `Bone parent "${parent}" is referenced but never declared.`,
      fix: 'Re-export the skeleton. A missing parent means the data is incomplete and runtimes will fail to load it.',
    });
  }

  for (const name of report.bones.duplicateNames) {
    collector.add({
      id: 'structure/duplicate-bone',
      severity: 'error',
      subject: name,
      message: `Bone name "${name}" appears more than once; bone names must be unique.`,
      fix: 'Rename one of them in Spine and re-export.',
    });
  }

  for (const name of report.slots.duplicateNames) {
    collector.add({
      id: 'structure/duplicate-slot',
      severity: 'error',
      subject: name,
      message: `Slot name "${name}" appears more than once; slot names must be unique.`,
      fix: 'Rename one of them in Spine and re-export.',
    });
  }

  for (const reference of report.slots.danglingBoneRefs) {
    collector.add({
      id: 'structure/dangling-slot-bone',
      severity: 'error',
      subject: reference,
      message: `Slot is attached to a bone that does not exist (${reference}).`,
      fix: 'Re-export the skeleton; a slot pointing at a missing bone cannot be loaded.',
    });
  }
}

function lintSkins(collector: FindingCollector, report: SkeletonReport): void {
  if (report.skins.count > 0 && !report.skins.hasDefault) {
    collector.add({
      id: 'skins/missing-default',
      severity: 'warning',
      message: 'No "default" skin was exported.',
      fix: 'Attachments outside a named skin live in the default skin. Its absence usually means attachments were excluded from export.',
    });
  }

  for (const slot of report.skins.slotsWithoutAttachments) {
    collector.add({
      id: 'skins/slot-without-attachment',
      severity: 'info',
      subject: slot,
      message: `Slot "${slot}" has no attachment in any skin.`,
      fix: 'Remove the slot if it is unused, or confirm it is driven by an attachment timeline at runtime.',
    });
  }

  if (report.slots.count > 0 && report.attachments.total === 0) {
    collector.add({
      id: 'skins/no-attachments',
      severity: 'error',
      message: 'The skeleton has slots but no attachments at all.',
      fix: 'Check the export settings: attachments excluded from export produce a skeleton that renders nothing.',
    });
  }
}

function lintAnimations(
  collector: FindingCollector,
  report: SkeletonReport,
  config: LintConfig,
): void {
  const durations = report.animations
    .filter((animation) => animation.timelineCount > 0)
    .map((animation) => animation.duration);
  const medianDuration = median(durations);

  for (const animation of report.animations) {
    if (animation.timelineCount === 0) {
      collector.add({
        id: 'animation/empty',
        severity: 'warning',
        subject: animation.name,
        message: `Animation "${animation.name}" has no timelines.`,
        fix: 'Delete it, or confirm it exists on purpose as an empty animation used to clear a track.',
      });
      continue;
    }

    if (animation.duration === 0) {
      collector.add({
        id: 'animation/zero-duration',
        severity: 'info',
        subject: animation.name,
        message: `Animation "${animation.name}" has timelines but a duration of 0 seconds.`,
        fix: 'A single keyframe at time 0 is a pose, not an animation. That is fine for setup poses; otherwise add keyframes.',
      });
    }

    if (animation.duration > config.budgets.maxAnimationDuration) {
      collector.add({
        id: 'budget/animation-duration',
        severity: 'warning',
        subject: animation.name,
        message: `Animation "${animation.name}" is ${animation.duration.toFixed(2)}s, over the ${config.budgets.maxAnimationDuration}s budget.`,
        fix: 'Split it into shorter animations, or raise maxAnimationDuration in the budgets file.',
      });
    }

    if (
      medianDuration > 0 &&
      animation.duration > medianDuration * config.durationOutlierFactor
    ) {
      collector.add({
        id: 'animation/duration-outlier',
        severity: 'info',
        subject: animation.name,
        message: `Animation "${animation.name}" lasts ${animation.duration.toFixed(2)}s, more than ${config.durationOutlierFactor}x the median of ${medianDuration.toFixed(2)}s.`,
        fix: 'Check for a stray keyframe far out on the timeline, which is the usual cause.',
      });
    }

    if (animation.timelineCount > config.budgets.maxTimelinesPerAnimation) {
      collector.add({
        id: 'budget/timeline-count',
        severity: 'warning',
        subject: animation.name,
        message: `Animation "${animation.name}" has ${animation.timelineCount} timelines, over the ${config.budgets.maxTimelinesPerAnimation} budget.`,
        fix: 'Large animations cost CPU per frame at runtime. Split it, or raise maxTimelinesPerAnimation.',
      });
    }
  }
}

function lintBudgets(
  collector: FindingCollector,
  report: SkeletonReport,
  config: LintConfig,
): void {
  const { budgets } = config;

  if (report.bones.count > budgets.maxBones) {
    collector.add({
      id: 'budget/bone-count',
      severity: 'warning',
      message: `${report.bones.count} bones exceeds the budget of ${budgets.maxBones}.`,
      fix: 'Bone count drives per-frame transform work. Merge or remove bones, or raise maxBones.',
    });
  }

  if (report.bones.maxDepth > budgets.maxBoneDepth) {
    collector.add({
      id: 'budget/bone-depth',
      severity: 'warning',
      subject: report.bones.deepestChain.join(' > '),
      message: `Bone hierarchy is ${report.bones.maxDepth} deep, over the budget of ${budgets.maxBoneDepth}.`,
      fix: 'Deep chains compound floating-point error and cost more to update. Flatten the hierarchy, or raise maxBoneDepth.',
    });
  }

  if (report.slots.count > budgets.maxSlots) {
    collector.add({
      id: 'budget/slot-count',
      severity: 'warning',
      message: `${report.slots.count} slots exceeds the budget of ${budgets.maxSlots}.`,
      fix: 'Each slot is a potential draw call boundary. Remove unused slots, or raise maxSlots.',
    });
  }

  for (const mesh of report.attachments.meshes) {
    if (mesh.vertexCount > budgets.maxMeshVertices) {
      collector.add({
        id: 'budget/mesh-vertices',
        severity: 'warning',
        subject: `${mesh.skin}/${mesh.slot}/${mesh.attachment}`,
        message: `Mesh "${mesh.attachment}" has ${mesh.vertexCount} vertices, over the budget of ${budgets.maxMeshVertices}.`,
        fix: 'Simplify the mesh in Spine, or raise maxMeshVertices.',
      });
    }
  }

  if (report.attachments.totalMeshVertices > budgets.maxTotalMeshVertices) {
    collector.add({
      id: 'budget/total-mesh-vertices',
      severity: 'warning',
      message: `${report.attachments.totalMeshVertices} mesh vertices in total, over the budget of ${budgets.maxTotalMeshVertices}.`,
      fix: 'Deformed vertices are recomputed every frame. Reduce mesh density, or raise maxTotalMeshVertices.',
    });
  }
}

function lintExport(collector: FindingCollector, report: SkeletonReport): void {
  if (!report.nonessential) {
    collector.add({
      id: 'export/nonessential-missing',
      severity: 'warning',
      message:
        'Nonessential data is missing, so this file cannot be imported back into Spine without losing information.',
      fix: 'Re-export with "Nonessential data" checked when the data needs to round-trip. Leave it off for shipping builds to save size.',
    });
  }

  if (report.meta.hash === null) {
    collector.add({
      id: 'export/missing-hash',
      severity: 'info',
      message: 'The skeleton section has no hash.',
      fix: 'The hash is how tools detect whether data changed. Its absence suggests hand-edited or generated data rather than a Spine export.',
    });
  }

  if (report.meta.spineVersion === null) {
    collector.add({
      id: 'export/missing-version',
      severity: 'warning',
      message: 'The skeleton section records no Spine version.',
      fix: 'Runtime and editor versions must match. Without a version, that cannot be verified before loading.',
    });
  }
}

function lintAtlas(
  collector: FindingCollector,
  report: SkeletonReport,
  atlas: AtlasReport,
  config: LintConfig,
): void {
  const check = crossCheckRegions(report.attachments.regionKeys, atlas);

  for (const region of check.missing) {
    collector.add({
      id: 'atlas/missing-region',
      severity: 'error',
      subject: region,
      message: `The skeleton needs region "${region}" but the atlas does not contain it.`,
      fix: 'Re-pack the atlas including that image, or fix the attachment path. A missing region renders as nothing at runtime.',
    });
  }

  for (const region of check.unused) {
    collector.add({
      id: 'atlas/unused-region',
      severity: 'info',
      subject: region,
      message: `Atlas region "${region}" is not referenced by this skeleton.`,
      fix: 'Harmless if the atlas is shared between skeletons; otherwise it is wasted texture space.',
    });
  }

  for (const name of atlas.totals.duplicateNames) {
    collector.add({
      id: 'atlas/duplicate-region',
      severity: 'error',
      subject: name,
      message: `Atlas contains more than one region named "${name}" with the same index.`,
      fix: 'Region lookups become ambiguous. Give the images distinct names, or use indexes for frame sequences.',
    });
  }

  if (atlas.totals.mixedPremultiply) {
    collector.add({
      id: 'atlas/mixed-premultiply',
      severity: 'error',
      message: 'Some atlas pages use premultiplied alpha and others do not.',
      fix: 'Re-pack with a single premultiplyAlpha setting. Runtimes choose a blend function per page, so mixed modes render incorrectly.',
    });
  }

  if (config.expectPremultipliedAlpha !== null) {
    const expected = config.expectPremultipliedAlpha;
    for (const page of atlas.pages) {
      if (page.pma !== expected) {
        collector.add({
          id: 'atlas/premultiply-mismatch',
          severity: 'error',
          subject: page.name,
          message: `Page "${page.name}" has pma ${page.pma}, but the runtime expects ${expected}.`,
          fix: `Re-pack with premultiplyAlpha ${expected}, or change the runtime blend setting to match the atlas.`,
        });
      }
    }
  }

  if (atlas.totals.pageCount > config.budgets.maxAtlasPages) {
    collector.add({
      id: 'budget/atlas-pages',
      severity: 'warning',
      message: `${atlas.totals.pageCount} atlas pages exceeds the budget of ${config.budgets.maxAtlasPages}.`,
      fix: 'Each page is a texture bind. Raise the max page size when packing, or raise maxAtlasPages.',
    });
  }

  if (
    atlas.totals.pagePixels > 0 &&
    atlas.totals.packingEfficiency < config.budgets.minPackingEfficiency
  ) {
    collector.add({
      id: 'budget/packing-efficiency',
      severity: 'warning',
      message: `Packing efficiency is ${(atlas.totals.packingEfficiency * 100).toFixed(1)}%, below the ${(config.budgets.minPackingEfficiency * 100).toFixed(0)}% target.`,
      fix: 'Enable whitespace stripping and rotation, try polygon packing, or lower the max page size so pages are better filled.',
    });
  }

  for (const page of atlas.totals.nonPowerOfTwoPages) {
    collector.add({
      id: 'atlas/non-power-of-two',
      severity: 'info',
      subject: page,
      message: `Atlas page "${page}" is not a power of two.`,
      fix: 'Enable the "Power of two" pack setting if the target toolkit or texture compression requires it.',
    });
  }
}

/** Run every enabled rule against a skeleton report. */
export function lintSkeleton(
  report: SkeletonReport,
  options: LintOptions = {},
): LintReport {
  const config = mergeLintConfig(options.config);
  const collector = new FindingCollector(new Set(config.disabled));

  lintNames(collector, 'bone', report.bones.names, config.naming.bone);
  lintNames(collector, 'slot', report.slots.names, config.naming.slot);
  lintNames(collector, 'skin', report.skins.names, config.naming.skin);
  lintNames(
    collector,
    'animation',
    report.animations.map((animation) => animation.name),
    config.naming.animation,
  );
  lintNames(collector, 'event', report.events.names, config.naming.event);
  lintNames(
    collector,
    'attachment',
    report.attachments.regionKeys,
    config.naming.attachment,
  );

  lintStructure(collector, report);
  lintSkins(collector, report);
  lintAnimations(collector, report, config);
  lintBudgets(collector, report, config);
  lintExport(collector, report);

  if (options.atlas) {
    lintAtlas(collector, report, options.atlas, config);
  }

  const findings = [...collector.findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.id.localeCompare(b.id);
  });

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const failOn = options.failOn ?? 'error';
  const passed = !findings.some(
    (finding) => SEVERITY_ORDER[finding.severity] <= SEVERITY_ORDER[failOn],
  );

  return {
    findings,
    counts,
    triggeredRules: [...new Set(findings.map((finding) => finding.id))].sort(),
    failOn,
    passed,
    config,
  };
}

/** Human-readable lint summary, grouped by severity. */
export function summarizeLint(report: LintReport): string {
  if (report.findings.length === 0) {
    return 'Lint passed with no findings.';
  }

  const lines: string[] = [
    `${report.counts.error} error(s), ${report.counts.warning} warning(s), ${report.counts.info} info — ` +
      `gate ${report.passed ? 'passed' : 'failed'} (failOn: ${report.failOn}).`,
  ];

  for (const severity of ['error', 'warning', 'info'] as const) {
    const group = report.findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push(`${severity.toUpperCase()}:`);
    for (const finding of group.slice(0, 25)) {
      const subject = finding.subject ? ` [${finding.subject}]` : '';
      lines.push(`  ${finding.id}${subject}: ${finding.message}`);
      lines.push(`    fix: ${finding.fix}`);
    }
    if (group.length > 25) {
      lines.push(`  …and ${group.length - 25} more ${severity} finding(s).`);
    }
  }

  return lines.join('\n');
}
