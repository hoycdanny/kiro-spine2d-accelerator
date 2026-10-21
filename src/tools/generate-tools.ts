// ============================================================
// Group C — generation.
//
// `psd_to_skeleton` turns a layered PSD into importable Spine data without
// touching the editor, which is what makes it usable on a trial license.
// The closing step — turning that data into a .spine project with
// `spine_import` — does need a license, because it writes a project file.
//
// The generated skeleton is linted before it is returned: data that cannot
// load is worse than no data, and a pass here is what makes the "open it in
// Spine" step trustworthy.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SpineHost } from '../host';
import { LintReport, lintSkeleton, summarizeLint } from '../lint-rules';
import { resolveReadTarget, resolveWriteTarget } from '../path-safety';
import { SidecarRunner, callSidecar, createUvSidecarRunner } from '../sidecar';
import { SkeletonReport, inspectSkeletonJson } from '../skeleton-data';
import { guardTool } from '../tool-result';
import { SpineResult, ok } from '../types';
import { readTextFile } from './data-tools';

/** What the sidecar returns for a generation run. */
export interface PsdToSkeletonResult {
  skeletonPath: string;
  atlasPath: string;
  pagePaths: string[];
  boneCount: number;
  slotCount: number;
  attachmentCount: number;
  regionNames: string[];
  /** Bones created because no layer provided them. */
  virtualBones: string[];
  /** Layers whose names matched no known body part. */
  unmappedLayers: string[];
  warnings: string[];
}

/** Payload returned by `psd_to_skeleton`. */
export interface PsdToSkeletonData {
  generated: PsdToSkeletonResult;
  /** Inspection of the generated skeleton. */
  skeleton: SkeletonReport | null;
  /** Lint of the generated skeleton against its own atlas. */
  lint: LintReport | null;
  /** The command that turns this into a .spine project. */
  nextStep: string;
}

/** Generate a Spine rig from a layered PSD. */
export async function psdToSkeleton(
  host: SpineHost,
  runner: SidecarRunner,
  args: {
    psd: string;
    outDir: string;
    name?: string | undefined;
    padding?: number | undefined;
    maxSize?: number | undefined;
    premultipliedAlpha?: boolean | undefined;
    timeoutSeconds?: number | undefined;
  },
): Promise<SpineResult<PsdToSkeletonData>> {
  const psd = resolveReadTarget(args.psd, host.workspaceRoot, host.exists);
  if (!psd.ok) return psd;

  const outDir = resolveWriteTarget(args.outDir, host.workspaceRoot);
  if (!outDir.ok) return outDir;

  const generated = await callSidecar<PsdToSkeletonResult>(
    runner,
    {
      command: 'psd_to_skeleton',
      psdPath: psd.data,
      outDir: outDir.data,
      ...(args.name === undefined ? {} : { name: args.name }),
      ...(args.padding === undefined ? {} : { padding: args.padding }),
      ...(args.maxSize === undefined ? {} : { maxSize: args.maxSize }),
      ...(args.premultipliedAlpha === undefined
        ? {}
        : { premultipliedAlpha: args.premultipliedAlpha }),
    },
    args.timeoutSeconds === undefined ? undefined : args.timeoutSeconds * 1000,
  );
  if (!generated.ok) return generated;

  // Inspect and lint what was produced, so the caller never has to take the
  // generator's word for it.
  let skeleton: SkeletonReport | null = null;
  let lint: LintReport | null = null;

  const skeletonFile = readTextFile(
    host,
    generated.data.skeletonPath,
    'generated skeleton data',
  );
  if (skeletonFile.ok) {
    const inspected = inspectSkeletonJson(skeletonFile.data.text);
    if (inspected.ok) {
      skeleton = inspected.data;
      // Generated rigs use underscores, which the default kebab-case naming
      // rules would flag. The convention is the generator's, so those rules
      // are off here rather than producing noise the developer cannot fix.
      lint = lintSkeleton(inspected.data, {
        config: {
          disabled: ['naming/bone', 'naming/slot', 'naming/attachment'],
        },
      });
    }
  }

  const nextStep = `spine_import with input "${generated.data.skeletonPath}" and output "<project>.spine" (needs a licensed Spine)`;

  const summaryLines = [
    `Generated a ${generated.data.boneCount}-bone rig with ${generated.data.attachmentCount} attachment(s) from ${psd.data}.`,
    `Skeleton: ${generated.data.skeletonPath}`,
    `Atlas: ${generated.data.atlasPath} (${generated.data.pagePaths.join(', ')})`,
  ];

  if (generated.data.virtualBones.length > 0) {
    summaryLines.push(
      `Virtual bones created because no layer provided them: ${generated.data.virtualBones.join(', ')}. They are positioned from the parts that do exist.`,
    );
  }

  if (generated.data.unmappedLayers.length > 0) {
    summaryLines.push(
      `Layers that matched no known body part and were skipped: ${generated.data.unmappedLayers.join(', ')}. Rename them to a recognised part, or add them in the editor.`,
    );
  }

  summaryLines.push(...generated.data.warnings);

  if (lint) {
    summaryLines.push(summarizeLint(lint));
  }

  summaryLines.push(
    `Next: ${nextStep}. Weights, meshes and animation belong in the editor — this generator produces region attachments and an empty setup animation.`,
  );

  return ok(
    { generated: generated.data, skeleton, lint, nextStep },
    summaryLines.join('\n'),
  );
}

/** Register the generation tools. */
export function registerGenerateTools(
  server: McpServer,
  host: SpineHost,
  runner: SidecarRunner = createUvSidecarRunner(host),
): void {
  server.registerTool(
    'psd_to_skeleton',
    {
      title: 'Generate a Spine rig from a layered PSD',
      description: [
        'Convert a layered PSD into Spine 4.2 skeleton JSON, a texture atlas and an atlas page image, then inspect and lint the result.',
        'Layer names drive the rig: head, torso/body, chest, neck, hip/pelvis, arm_left, forearm_right, hand_left, thigh_right, shin_left, foot_right and the usual side spellings.',
        'Missing intermediate bones are created as positioned virtual bones, and each part pivots at its joint edge rather than its image centre, so limbs rotate from the joint.',
        'A layer named "<part>[pivot]" places that bone origin explicitly. Unrecognised layers are reported rather than guessed at.',
        'This bypasses the Spine editor, so it works on a trial license. Importing the result into a .spine project with spine_import does need a license.',
        'Requires the Python sidecar: uv sync --project python.',
      ].join(' '),
      inputSchema: {
        psd: z.string().describe('Path to the layered PSD file.'),
        outDir: z
          .string()
          .describe('Directory to write the skeleton, atlas and page image to, inside the workspace.'),
        name: z
          .string()
          .optional()
          .describe('Base name for the generated files. Defaults to the PSD file name.'),
        padding: z
          .number()
          .int()
          .min(0)
          .max(32)
          .optional()
          .describe('Pixels of padding between packed regions. Defaults to 2.'),
        maxSize: z
          .number()
          .int()
          .min(64)
          .max(8192)
          .optional()
          .describe('Maximum atlas page size. Defaults to 4096.'),
        premultipliedAlpha: z
          .boolean()
          .optional()
          .describe(
            'Record premultiplied alpha in the atlas. Defaults to false; the page image is not premultiplied, so only set this if the runtime expects it.',
          ),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(3600)
          .optional()
          .describe('Timeout for the sidecar. Defaults to 300s.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => psdToSkeleton(host, runner, args)),
  );
}
