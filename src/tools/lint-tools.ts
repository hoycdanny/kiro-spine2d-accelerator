// ============================================================
// Group B — `skeleton_lint`.
//
// Runs the rule engine over exported data and returns a gate-ready report.
// Rules come from the built-in defaults, overlaid with any rules files the
// caller supplies (the editable copies live in `templates/lint-rules/`).
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AtlasReport, inspectAtlasText } from '../atlas-data';
import { SpineHost } from '../host';
import {
  LintConfig,
  LintReport,
  Severity,
  lintSkeleton,
  mergeLintConfig,
  summarizeLint,
} from '../lint-rules';
import { SkeletonReport, inspectSkeletonJson } from '../skeleton-data';
import { guardTool } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import { readTextFile } from './data-tools';

/**
 * Pull a lint config out of a rules file.
 *
 * The template files are split by concern (`naming.json`, `budgets.json`)
 * and each carries only the keys it owns, so unknown keys are ignored
 * rather than rejected.
 */
export function extractConfig(parsed: unknown): Partial<LintConfig> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const source = parsed as Record<string, unknown>;
  const result: Partial<LintConfig> = {};

  if (typeof source['naming'] === 'object' && source['naming'] !== null) {
    result.naming = source['naming'] as LintConfig['naming'];
  }
  if (typeof source['budgets'] === 'object' && source['budgets'] !== null) {
    result.budgets = source['budgets'] as LintConfig['budgets'];
  }
  if (Array.isArray(source['disabled'])) {
    result.disabled = source['disabled'].filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  if (typeof source['durationOutlierFactor'] === 'number') {
    result.durationOutlierFactor = source['durationOutlierFactor'];
  }
  if (
    typeof source['expectPremultipliedAlpha'] === 'boolean' ||
    source['expectPremultipliedAlpha'] === null
  ) {
    result.expectPremultipliedAlpha = source['expectPremultipliedAlpha'] as boolean | null;
  }

  return result;
}

/** Load and merge zero or more rules files over the defaults. */
export function loadLintConfig(
  host: SpineHost,
  paths: string[],
): SpineResult<LintConfig> {
  let config: LintConfig = mergeLintConfig(null);

  for (const path of paths) {
    const file = readTextFile(host, path, 'lint rules');
    if (!file.ok) return file;

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.data.text);
    } catch (cause) {
      return err(
        SpineErrorCode.ParseFailed,
        `Lint rules file is not valid JSON: ${file.data.absolute}`,
        `Fix the JSON syntax. ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    config = mergeLintConfig(extractConfig(parsed), config);
  }

  return ok(config, `Loaded ${paths.length} rules file(s).`);
}

/** Payload returned by `skeleton_lint`. */
export interface LintToolData {
  skeletonFile: string;
  atlasFile: string | null;
  lint: LintReport;
  skeleton: SkeletonReport;
  atlas: AtlasReport | null;
}

/** Lint an exported skeleton, optionally together with its atlas. */
export function skeletonLint(
  host: SpineHost,
  args: {
    input: string;
    atlas?: string | undefined;
    rules?: string[] | undefined;
    failOn?: Severity | undefined;
    expectPremultipliedAlpha?: boolean | undefined;
  },
): SpineResult<LintToolData> {
  const skeletonFile = readTextFile(host, args.input, 'skeleton data');
  if (!skeletonFile.ok) return skeletonFile;

  const skeleton = inspectSkeletonJson(skeletonFile.data.text);
  if (!skeleton.ok) return skeleton;

  const loaded = loadLintConfig(host, args.rules ?? []);
  if (!loaded.ok) return loaded;

  const config: Partial<LintConfig> = { ...loaded.data };
  if (args.expectPremultipliedAlpha !== undefined) {
    config.expectPremultipliedAlpha = args.expectPremultipliedAlpha;
  }

  let atlas: AtlasReport | null = null;
  let atlasFile: string | null = null;

  if (args.atlas) {
    const file = readTextFile(host, args.atlas, 'texture atlas');
    if (!file.ok) return file;
    const inspected = inspectAtlasText(file.data.text);
    if (!inspected.ok) return inspected;
    atlas = inspected.data;
    atlasFile = file.data.absolute;
  }

  const lint = lintSkeleton(skeleton.data, {
    config,
    atlas,
    ...(args.failOn === undefined ? {} : { failOn: args.failOn }),
  });

  const data: LintToolData = {
    skeletonFile: skeletonFile.data.absolute,
    atlasFile,
    lint,
    skeleton: skeleton.data,
    atlas,
  };

  const summary = [
    summarizeLint(lint),
    atlasFile === null
      ? 'Atlas rules were skipped: pass `atlas` to check region coverage, premultiplied alpha and packing efficiency.'
      : `Atlas checked: ${atlasFile}`,
  ].join('\n');

  // A failed gate is reported as an error result so a caller (or CI shim)
  // can branch on it without parsing the summary text.
  if (!lint.passed) {
    return err(
      SpineErrorCode.GateFailed,
      `Lint gate failed: ${lint.counts.error} error(s), ${lint.counts.warning} warning(s) at failOn=${lint.failOn}.`,
      'Fix the findings below, or relax the rules in templates/lint-rules/ and pass them via `rules`.',
      { summary, findings: lint.findings, skeletonFile: data.skeletonFile },
    );
  }

  return ok(data, summary);
}

/** Register the lint tool. */
export function registerLintTools(server: McpServer, host: SpineHost): void {
  server.registerTool(
    'skeleton_lint',
    {
      title: 'Lint exported skeleton and atlas data',
      description: [
        'Check exported skeleton data (and optionally its atlas) against structural invariants, naming conventions, complexity budgets and export settings.',
        'Reports naming violations, multiple root bones, duplicate or dangling references, slots without attachments, empty animations, duration outliers,',
        'bone/slot/mesh budget overruns, missing nonessential data, missing atlas regions, mixed premultiplied alpha, duplicate regions and low packing efficiency.',
        'Every finding carries a severity and a concrete fix. The result fails as GATE_FAILED when any finding reaches `failOn`, which makes it usable as a CI gate.',
        'Reads files directly — no Spine installation or license required.',
      ].join(' '),
      inputSchema: {
        input: z.string().describe('Path to an exported skeleton JSON file.'),
        atlas: z
          .string()
          .optional()
          .describe('Optional path to the matching .atlas file, which enables the atlas rules.'),
        rules: z
          .array(z.string())
          .optional()
          .describe(
            'Rules files to overlay on the defaults, applied in order. See templates/lint-rules/naming.json and budgets.json.',
          ),
        failOn: z
          .enum(['error', 'warning', 'info'])
          .optional()
          .describe('Severity at or above which the gate fails. Defaults to error.'),
        expectPremultipliedAlpha: z
          .boolean()
          .optional()
          .describe(
            'What the runtime expects for premultiplied alpha. Atlas pages that disagree are reported as errors.',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guardTool(() => skeletonLint(host, args)),
  );
}
