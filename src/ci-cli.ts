#!/usr/bin/env node
// ============================================================
// CI entry point.
//
// The MCP server is driven by an AI; a pipeline needs the same gates
// without one. This exposes them as subcommands with process exit codes,
// which is the interface CI actually consumes.
//
//   lint        exported data (and atlases) against the lint rules
//   regression  rendered frames against stored baselines
//   export      batch export through the Spine CLI (needs a license)
//   diff        semantic diff between two exported skeletons
//
// Exit codes: 0 pass, 1 gate failed, 2 bad usage or an operational error.
// ============================================================

import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { createNodeSpawn } from './cli-runner';
import { SpineHost, createNodeHost } from './host';
import { Severity } from './lint-rules';
import { createPlaywrightLauncher } from './preview-renderer';
import { skeletonDiff } from './tools/data-tools';
import { spineBatch } from './tools/export-tools';
import { skeletonLint } from './tools/lint-tools';
import { visualRegression } from './tools/regression-tools';
import { CommandDescriptor } from './tools/export-tools';
import { SpineResult } from './types';

/** Exit codes this CLI uses. */
export const EXIT_OK = 0;
export const EXIT_GATE_FAILED = 1;
export const EXIT_ERROR = 2;

/** Parsed arguments: repeatable flags collect into arrays. */
export function parseArgs(argv: string[]): {
  command: string | undefined;
  flags: Record<string, string[]>;
} {
  const [command, ...rest] = argv;
  const flags: Record<string, string[]> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith('--')) continue;

    const [name, inlineValue] = token.slice(2).split('=', 2);
    const key = name!;
    let value: string;

    if (inlineValue !== undefined) {
      value = inlineValue;
    } else {
      const next = rest[index + 1];
      if (next === undefined || next.startsWith('--')) {
        value = 'true';
      } else {
        value = next;
        index += 1;
      }
    }

    flags[key] = [...(flags[key] ?? []), value];
  }

  return { command, flags };
}

function flag(flags: Record<string, string[]>, name: string): string | undefined {
  return flags[name]?.[0];
}

function flagAll(flags: Record<string, string[]>, name: string): string[] {
  return flags[name] ?? [];
}

/** Recursively list files under a directory. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];

  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) walk(path);
      else out.push(path);
    }
  };

  walk(dir);
  return out.sort();
}

/** An exported skeleton paired with its atlas, when one is alongside it. */
export interface ExportPair {
  skeleton: string;
  atlas: string | null;
  name: string;
}

/**
 * Pair exported skeleton data with its atlas.
 *
 * Both `.atlas` and `.atlas.txt` are accepted, because a Unity-targeted
 * export writes the latter.
 */
export function findExportPairs(exportDir: string): ExportPair[] {
  const files = listFiles(exportDir);
  const atlases = new Map<string, string>();

  for (const file of files) {
    if (file.endsWith('.atlas') || file.endsWith('.atlas.txt')) {
      const stem = basename(file).replace(/\.atlas(\.txt)?$/i, '');
      atlases.set(join(file, '..', stem), file);
    }
  }

  const pairs: ExportPair[] = [];
  for (const file of files) {
    if (extname(file).toLowerCase() !== '.json') continue;
    // Settings files live next to artifacts; skip the obvious ones.
    if (/\.(export|pack)\.json$/i.test(file)) continue;
    if (basename(file) === 'baseline.json') continue;

    const stem = basename(file, '.json');
    pairs.push({
      skeleton: file,
      atlas: atlases.get(join(file, '..', stem)) ?? null,
      name: stem,
    });
  }

  return pairs;
}

/** List the immediate subdirectories of a directory. */
export function listSubdirectories(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((entry) => join(dir, entry))
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function report<T>(label: string, result: SpineResult<T>): boolean {
  if (result.ok) {
    process.stdout.write(`PASS ${label}\n${indent(result.summary)}\n\n`);
    return true;
  }
  process.stdout.write(
    `FAIL ${label}\n${indent(`${result.code}: ${result.message}`)}\n${indent(result.hint)}\n\n`,
  );
  return false;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

async function runLint(host: SpineHost, flags: Record<string, string[]>): Promise<number> {
  const exportDir = flag(flags, 'export-dir') ?? 'export';
  const rules = flagAll(flags, 'rules');
  const failOn = (flag(flags, 'fail-on') ?? 'error') as Severity;

  const pairs = findExportPairs(join(host.workspaceRoot, exportDir));
  if (pairs.length === 0) {
    process.stderr.write(
      `No exported skeleton JSON found under ${exportDir}. Nothing to lint.\n`,
    );
    return EXIT_ERROR;
  }

  let passed = true;
  for (const pair of pairs) {
    const result = skeletonLint(host, {
      input: pair.skeleton,
      ...(pair.atlas ? { atlas: pair.atlas } : {}),
      ...(rules.length > 0 ? { rules } : {}),
      failOn,
    });
    if (!report(`lint ${relative(host.workspaceRoot, pair.skeleton)}`, result)) {
      passed = false;
    }
    if (!pair.atlas) {
      process.stdout.write(
        `    note: no atlas found beside ${pair.name}; atlas rules were skipped\n\n`,
      );
    }
  }

  return passed ? EXIT_OK : EXIT_GATE_FAILED;
}

async function runRegression(
  host: SpineHost,
  flags: Record<string, string[]>,
): Promise<number> {
  const exportDir = flag(flags, 'export-dir') ?? 'export';
  const baselineDir = flag(flags, 'baseline-dir') ?? 'baseline';
  const diffDir = flag(flags, 'diff-dir');
  const mode = (flag(flags, 'mode') ?? 'check') as 'check' | 'update';

  const pairs = findExportPairs(join(host.workspaceRoot, exportDir)).filter(
    (pair) => pair.atlas !== null,
  );
  if (pairs.length === 0) {
    process.stderr.write(
      `No skeleton/atlas pairs found under ${exportDir}. Visual regression needs both.\n`,
    );
    return EXIT_ERROR;
  }

  const baselineRoot = join(host.workspaceRoot, baselineDir);
  const animationDirs = listSubdirectories(baselineRoot);

  if (animationDirs.length === 0 && mode === 'check') {
    process.stderr.write(
      `No baselines found under ${baselineDir}. Create them with --mode update.\n`,
    );
    return EXIT_ERROR;
  }

  const launcher = createPlaywrightLauncher();
  let passed = true;

  for (const pair of pairs) {
    const animations =
      animationDirs.length > 0
        ? animationDirs.map((dir) => basename(dir))
        : // In update mode with no baselines yet, cover every animation.
          [undefined];

    for (const animation of animations) {
      const label = `regression ${pair.name}${animation ? `/${animation}` : ''}`;
      const result = await visualRegression(host, launcher, {
        skeleton: pair.skeleton,
        atlas: pair.atlas!,
        baselineDir: join(baselineDir, animation ?? pair.name),
        ...(diffDir ? { diffDir: join(diffDir, animation ?? pair.name) } : {}),
        ...(animation ? { animation } : {}),
        mode,
      });
      if (!report(label, result)) passed = false;
    }
  }

  return passed ? EXIT_OK : EXIT_GATE_FAILED;
}

async function runExport(host: SpineHost, flags: Record<string, string[]>): Promise<number> {
  const projectsDir = flag(flags, 'projects-dir') ?? 'art';
  const outDir = flag(flags, 'out-dir') ?? 'export';
  const settings = flag(flags, 'settings');
  const update = flag(flags, 'update');

  const projects = listFiles(join(host.workspaceRoot, projectsDir)).filter(
    (file) => extname(file).toLowerCase() === '.spine',
  );

  if (projects.length === 0) {
    process.stderr.write(`No .spine projects found under ${projectsDir}.\n`);
    return EXIT_ERROR;
  }

  const commands: CommandDescriptor[] = projects.map((project) => ({
    kind: 'export',
    input: project,
    output: outDir,
    exportSpec: settings ?? 'binary',
  }));

  process.stdout.write(`Exporting ${projects.length} project(s) in one invocation.\n`);

  const result = await spineBatch(host, createNodeSpawn(), {
    commands,
    ...(update ? { update } : {}),
  });

  return report('export', result) ? EXIT_OK : EXIT_GATE_FAILED;
}

async function runDiff(host: SpineHost, flags: Record<string, string[]>): Promise<number> {
  const from = flag(flags, 'from');
  const to = flag(flags, 'to');

  if (!from || !to) {
    process.stderr.write('Usage: diff --from <baseline.json> --to <new.json>\n');
    return EXIT_ERROR;
  }

  const result = skeletonDiff(host, { from, to });
  if (!result.ok) {
    report('diff', result);
    return EXIT_ERROR;
  }

  process.stdout.write(`${result.summary}\n`);
  // A diff is informational: it reports, it does not gate.
  return EXIT_OK;
}

const USAGE = `spine-ci — Spine asset gates for CI

Usage:
  node dist/ci-cli.js lint        --export-dir <dir> [--rules <file>]... [--fail-on error|warning|info]
  node dist/ci-cli.js regression  --export-dir <dir> --baseline-dir <dir> [--diff-dir <dir>] [--mode check|update]
  node dist/ci-cli.js export      --projects-dir <dir> --out-dir <dir> [--settings <file>] [--update <version>]
  node dist/ci-cli.js diff        --from <file> --to <file>

Notes:
  * export needs a licensed Spine editor, and no Spine editor window open.
  * regression needs playwright-core and a Chromium build.
  * Exit codes: 0 pass, 1 gate failed, 2 usage or operational error.
`;

/** Run one subcommand. Exported for tests. */
export async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  const host = createNodeHost();

  switch (command) {
    case 'lint':
      return runLint(host, flags);
    case 'regression':
      return runRegression(host, flags);
    case 'export':
      return runExport(host, flags);
    case 'diff':
      return runDiff(host, flags);
    case 'help':
    case '--help':
    case undefined:
      process.stdout.write(USAGE);
      return command === undefined ? EXIT_ERROR : EXIT_OK;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return EXIT_ERROR;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((cause: unknown) => {
      process.stderr.write(
        `spine-ci failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      process.exit(EXIT_ERROR);
    });
}
