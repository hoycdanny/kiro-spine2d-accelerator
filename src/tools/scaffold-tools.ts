// ============================================================
// Group E — `runtime_scaffold`.
//
// Produces the glue for one runtime target: where each exported file has
// to go (including the renames each runtime requires), a controller script
// with a mix table derived from the skeleton, and a README with the steps.
//
// It stops short of touching the game project's own files: the output is a
// folder inside the workspace that a developer (or, for Unity, the
// kiro-unity-accelerator Power) copies in.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename, join } from 'node:path';
import { z } from 'zod';

import { AtlasReport, inspectAtlasText } from '../atlas-data';
import { SpineHost } from '../host';
import { resolveWriteTarget } from '../path-safety';
import {
  RUNTIME_TARGETS,
  RuntimeTarget,
  ScaffoldPlan,
  planScaffold,
} from '../runtime-scaffold';
import { inspectSkeletonJson } from '../skeleton-data';
import { guardTool } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import { readTextFile } from './data-tools';

/** Payload returned by `runtime_scaffold`. */
export interface RuntimeScaffoldData {
  target: RuntimeTarget;
  skeletonFile: string;
  atlasFile: string | null;
  outputDir: string | null;
  plan: ScaffoldPlan;
  /** Files written, when an output directory was given. */
  written: string[];
}

/** Plan (and optionally write) the integration for one target. */
export function runtimeScaffold(
  host: SpineHost,
  args: {
    target: RuntimeTarget;
    skeleton: string;
    atlas?: string | undefined;
    outputDir?: string | undefined;
    name?: string | undefined;
  },
): SpineResult<RuntimeScaffoldData> {
  const skeletonFile = readTextFile(host, args.skeleton, 'skeleton data');
  if (!skeletonFile.ok) return skeletonFile;

  const skeleton = inspectSkeletonJson(skeletonFile.data.text);
  if (!skeleton.ok) return skeleton;

  let atlas: AtlasReport | null = null;
  let atlasFile: string | null = null;
  let atlasFileName = '';
  let pageFileNames: string[] = [];

  if (args.atlas) {
    const file = readTextFile(host, args.atlas, 'texture atlas');
    if (!file.ok) return file;
    const inspected = inspectAtlasText(file.data.text);
    if (!inspected.ok) return inspected;
    atlas = inspected.data;
    atlasFile = file.data.absolute;
    atlasFileName = basename(file.data.absolute);
    pageFileNames = inspected.data.pages.map((page) => page.name);
  }

  const name =
    args.name ?? basename(skeletonFile.data.absolute).replace(/\.(json|skel)(\.bytes)?$/i, '');

  const plan = planScaffold({
    target: args.target,
    skeletonFileName: basename(skeletonFile.data.absolute),
    atlasFileName: atlasFileName || `${name}.atlas`,
    pageFileNames,
    report: skeleton.data,
    atlas,
    name,
  });

  let outputDir: string | null = null;
  const written: string[] = [];

  if (args.outputDir) {
    const target = resolveWriteTarget(args.outputDir, host.workspaceRoot);
    if (!target.ok) return target;
    outputDir = target.data;

    for (const file of plan.files) {
      const path = join(outputDir, file.path);
      host.writeText(path, file.content);
      written.push(path);
    }
  }

  const data: RuntimeScaffoldData = {
    target: args.target,
    skeletonFile: skeletonFile.data.absolute,
    atlasFile,
    outputDir,
    plan,
    written,
  };

  const renames = plan.placements.filter((placement) => placement.reason !== null);
  const summaryLines = [
    `${args.target} integration plan for ${name}: runtime branch ${plan.runtimeBranch ?? 'unknown'}.`,
  ];

  if (renames.length > 0) {
    summaryLines.push('Required renames:');
    for (const rename of renames) {
      summaryLines.push(`  ${rename.from} -> ${rename.to} (${rename.reason})`);
    }
  } else {
    summaryLines.push('No file renames are required for this target.');
  }

  summaryLines.push(
    `Mix table: ${plan.mixTable.length} suggested pair(s), default ${plan.defaultMix}s.`,
  );
  summaryLines.push(...plan.warnings);
  summaryLines.push(
    outputDir === null
      ? 'Not written to disk: pass `outputDir` to save the scaffold.'
      : `Written to ${outputDir}: ${plan.files.map((file) => file.path).join(', ')}.`,
  );

  if (args.target === 'unity') {
    summaryLines.push(
      'Once the files are in Assets/, Unity generates the _Atlas, _Material and _SkeletonData assets; scene assembly can then be handed to a Unity-side tool.',
    );
  }

  if (plan.blockers.length > 0) {
    return err(
      SpineErrorCode.ValidationFailed,
      `This data cannot be integrated yet: ${plan.blockers.join(' ')}`,
      [...summaryLines, 'Fix the blockers above, re-export, and run this again.'].join('\n'),
      { plan: plan as unknown as Record<string, unknown> },
    );
  }

  return ok(data, summaryLines.join('\n'));
}

/** Register the integration tool. */
export function registerScaffoldTools(server: McpServer, host: SpineHost): void {
  server.registerTool(
    'runtime_scaffold',
    {
      title: 'Scaffold a runtime integration',
      description: [
        'Produce the integration glue for spine-unity, spine-ts (web) or spine-godot: the exact file names each runtime requires,',
        'a controller script with a mix table derived from this skeleton, and a README with the steps.',
        'Encodes the naming rules that silently break imports — spine-unity needs .atlas.txt and .skel.bytes, spine-godot needs .spine-json —',
        'and checks the exporting editor version against the runtime branch, since a mismatched runtime refuses to load the data.',
        'Also flags multi-page atlases and premultiplied-alpha/colour-space mismatches, which are the usual causes of wrong-looking colours.',
      ].join(' '),
      inputSchema: {
        target: z
          .enum(RUNTIME_TARGETS)
          .describe('Integration target: unity (spine-unity), web (spine-ts), or godot (spine-godot).'),
        skeleton: z.string().describe('Path to the exported skeleton data file.'),
        atlas: z
          .string()
          .optional()
          .describe(
            'Path to the matching .atlas file. Without it, the page images and atlas checks are skipped.',
          ),
        outputDir: z
          .string()
          .optional()
          .describe('Folder to write the scaffold into, inside the workspace. Omit to preview.'),
        name: z
          .string()
          .optional()
          .describe('Name used for the generated class and files. Defaults to the skeleton file name.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => runtimeScaffold(host, args)),
  );
}
