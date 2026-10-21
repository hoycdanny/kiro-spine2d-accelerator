// ============================================================
// Group B — data layer tools.
//
// These never shell out: they read exported skeleton/atlas files and
// answer deterministically. That matters because the alternative is an AI
// hand-editing skeleton JSON, which is exactly where silent corruption
// comes from.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AtlasReport, crossCheckRegions, inspectAtlasText } from '../atlas-data';
import { SpineHost } from '../host';
import { resolveReadTarget } from '../path-safety';
import { SkeletonReport, inspectSkeletonJson } from '../skeleton-data';
import { SkeletonDiff, diffSkeletons, summarizeDiff } from '../skeleton-diff';
import { guardTool } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';

/** Read a UTF-8 text file through the host, as a structured result. */
export function readTextFile(
  host: SpineHost,
  path: string,
  what: string,
): SpineResult<{ absolute: string; text: string }> {
  const resolved = resolveReadTarget(path, host.workspaceRoot, host.exists);
  if (!resolved.ok) return resolved;

  const text = host.readText(resolved.data);
  if (text === null) {
    return err(
      SpineErrorCode.ParseFailed,
      `Could not read ${what}: ${resolved.data}`,
      'Check file permissions and that the path points at a file rather than a directory.',
    );
  }

  return ok({ absolute: resolved.data, text }, `Read ${resolved.data}.`);
}

/** Inspection payload returned by `skeleton_inspect`. */
export interface SkeletonInspectData {
  file: string;
  report: SkeletonReport;
  /** Present when an atlas was supplied for cross-checking. */
  atlasCrossCheck?: {
    atlasFile: string;
    missingRegions: string[];
    unusedRegions: string[];
  };
}

/** Inspect an exported skeleton JSON file. */
export function skeletonInspect(
  host: SpineHost,
  args: { input: string; atlas?: string | undefined },
): SpineResult<SkeletonInspectData> {
  const file = readTextFile(host, args.input, 'skeleton data');
  if (!file.ok) return file;

  const inspected = inspectSkeletonJson(file.data.text);
  if (!inspected.ok) return inspected;

  const data: SkeletonInspectData = {
    file: file.data.absolute,
    report: inspected.data,
  };
  const summaryLines = [inspected.summary];

  if (args.atlas) {
    const atlasFile = readTextFile(host, args.atlas, 'texture atlas');
    if (!atlasFile.ok) return atlasFile;

    const atlas = inspectAtlasText(atlasFile.data.text);
    if (!atlas.ok) return atlas;

    const check = crossCheckRegions(inspected.data.attachments.regionKeys, atlas.data);
    data.atlasCrossCheck = {
      atlasFile: atlasFile.data.absolute,
      missingRegions: check.missing,
      unusedRegions: check.unused,
    };

    summaryLines.push(
      check.missing.length === 0
        ? `Atlas cross-check passed: every region the skeleton needs exists in ${atlasFile.data.absolute}.`
        : `Atlas is missing ${check.missing.length} region(s) the skeleton needs: ${check.missing.join(', ')}. Those attachments render as nothing at runtime.`,
    );
    if (check.unused.length > 0) {
      summaryLines.push(
        `${check.unused.length} atlas region(s) are not referenced by this skeleton: ${check.unused.slice(0, 10).join(', ')}${check.unused.length > 10 ? ' …' : ''}.`,
      );
    }
  }

  return ok(data, summaryLines.join('\n'));
}

/** Inspection payload returned by `atlas_inspect`. */
export interface AtlasInspectData {
  file: string;
  report: AtlasReport;
}

/** Inspect a texture atlas file. */
export function atlasInspect(
  host: SpineHost,
  args: { input: string },
): SpineResult<AtlasInspectData> {
  const file = readTextFile(host, args.input, 'texture atlas');
  if (!file.ok) return file;

  const inspected = inspectAtlasText(file.data.text);
  if (!inspected.ok) return inspected;

  return ok({ file: file.data.absolute, report: inspected.data }, inspected.summary);
}

/** Register the data layer tools. */
export function registerDataTools(server: McpServer, host: SpineHost): void {
  server.registerTool(
    'skeleton_inspect',
    {
      title: 'Inspect exported skeleton data',
      description: [
        'Parse an exported Spine skeleton JSON file and report its structure:',
        'bones and hierarchy depth, slots and blend modes, skins, attachment types, mesh vertex counts,',
        'IK/transform/path/physics constraints, events, and every animation with its duration and timeline counts.',
        'Also reports whether nonessential data is present, which determines if the file can be imported back into Spine.',
        'Optionally cross-checks the regions the skeleton needs against a texture atlas.',
        'Reads the file directly — no Spine installation or license required.',
      ].join(' '),
      inputSchema: {
        input: z
          .string()
          .describe('Path to an exported skeleton JSON file (.json). Binary .skel is not supported yet.'),
        atlas: z
          .string()
          .optional()
          .describe(
            'Optional path to the matching .atlas file. When given, every region the skeleton references is checked for existence.',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guardTool(() => skeletonInspect(host, args)),
  );

  server.registerTool(
    'atlas_inspect',
    {
      title: 'Inspect a texture atlas',
      description: [
        'Parse a Spine/libgdx .atlas file and report pages (size, format, filters, premultiplied alpha),',
        'region counts, rotated and whitespace-stripped regions, packing efficiency, duplicate region names,',
        'and non power-of-two pages. Handles both the 4.0+ bounds/offsets format and the legacy xy/size/orig/offset format.',
        'Reads the file directly — no Spine installation or license required.',
      ].join(' '),
      inputSchema: {
        input: z.string().describe('Path to a .atlas file.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guardTool(() => atlasInspect(host, args)),
  );
}

// ------------------------------------------------------------
// skeleton_diff
// ------------------------------------------------------------

/** Payload returned by `skeleton_diff`. */
export interface SkeletonDiffData {
  fromFile: string;
  toFile: string;
  diff: SkeletonDiff;
}

/** Compare two exported skeleton files semantically. */
export function skeletonDiff(
  host: SpineHost,
  args: { from: string; to: string },
): SpineResult<SkeletonDiffData> {
  const fromFile = readTextFile(host, args.from, 'skeleton data (from)');
  if (!fromFile.ok) return fromFile;
  const toFile = readTextFile(host, args.to, 'skeleton data (to)');
  if (!toFile.ok) return toFile;

  const before = inspectSkeletonJson(fromFile.data.text);
  if (!before.ok) return before;
  const after = inspectSkeletonJson(toFile.data.text);
  if (!after.ok) return after;

  const diff = diffSkeletons(before.data, after.data);

  return ok(
    { fromFile: fromFile.data.absolute, toFile: toFile.data.absolute, diff },
    summarizeDiff(diff),
  );
}

/** Register the diff tool. */
export function registerDiffTools(server: McpServer, host: SpineHost): void {
  server.registerTool(
    'skeleton_diff',
    {
      title: 'Compare two exported skeletons',
      description: [
        'Semantic diff between two exported skeleton JSON files: bones added, removed or reparented; slots added, removed, rebound or reordered;',
        'skins; attachments whose type or target region changed; IK/transform/path/physics constraints; events; and animations with their duration,',
        'timeline and keyframe counts.',
        'Also compares the skeleton hash, and distinguishes "the hash changed" from "the data actually changed" — a re-export can change the hash on its own.',
        'Use this to review what an artist actually changed, or as the first step of a visual regression run.',
      ].join(' '),
      inputSchema: {
        from: z.string().describe('Path to the baseline skeleton JSON file.'),
        to: z.string().describe('Path to the new skeleton JSON file.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guardTool(() => skeletonDiff(host, args)),
  );
}
