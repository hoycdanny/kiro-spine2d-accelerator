// ============================================================
// Group C — `skeleton_animate`.
//
// Generates placeholder animations into an exported rig from five declared
// templates, and writes a second JSON file next to the first.
//
// Entirely TypeScript: no subprocess, no Python, no browser. The input is
// exported JSON and the output is exported JSON, so the work is table
// lookup and arithmetic, and it runs on a machine with no `uv` installed —
// which a test asserts structurally, by the absence of any reference to the
// Python bridge in this file.
//
// Two things this tool refuses to do, both deliberate:
//
//   * It never substitutes a bone. A template declares the bones it needs,
//     and a rig that lacks one fails with the names of what it has. The
//     "if there are no arm bones, rotate the last bone by 15 degrees"
//     fallback produces something that looks like success and is not.
//   * It never claims the motion is good. The one honesty sentence lives in
//     `PLACEHOLDER_MOTION_NOTE` and is used verbatim in the summary, the
//     written `_generator` record and this tool's own description.
//
// The lint gate is on the DELTA, not the absolute result: every
// error-severity rule describes the RIG, and adding animations triggers
// none of them, so an absolute gate would refuse a two-root rig with "this
// is a defect in the generator" — the tool blaming itself for a
// pre-existing input defect.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

import {
  EmitRequest,
  HASH_ALGORITHM,
  PLACEHOLDER_MOTION_NOTE,
  TEMPLATES,
  TEMPLATE_NAMES,
  TemplateName,
  emitAnimation,
  matchTemplate,
  recomputeSkeletonHash,
  validateEmittedAnimations,
} from '../animation-templates';
import { AtlasReport, inspectAtlasText } from '../atlas-data';
import { SpineHost } from '../host';
import { LintFinding, LintReport, lintSkeleton } from '../lint-rules';
import { resolveWriteTarget } from '../path-safety';
import { SkeletonReport, inspectSkeletonJson } from '../skeleton-data';
import { MAX_INLINE_DETAIL_CHARS, guardTool, nameList } from '../tool-result';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import { readTextFile } from './data-tools';

/** Animation names this tool accepts, so a name is never a path or a flag. */
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The three naming rules `psd_to_skeleton` disables, for the same reason:
 * generated rigs use underscores and the default kebab-case rules would
 * flag a convention the caller cannot change.
 */
const LINT_DISABLED = ['naming/bone', 'naming/slot', 'naming/attachment'];

/** What was generated for one requested animation. */
export interface AnimatedAnimation {
  template: string;
  name: string;
  duration: number;
  amplitude: number;
  intendedLoop: boolean;
  /** Bones with at least one emitted timeline, in declaration order. */
  usedBones: string[];
  /** Optional bones the rig lacks, whose tracks were dropped. */
  omittedOptional: string[];
  timelineCount: number;
  keyframeCount: number;
  /** True when an animation of this name already existed and was replaced. */
  replacedExisting: boolean;
  emittedEvents: string[];
}

/** Payload returned by `skeleton_animate`. */
export interface SkeletonAnimateData {
  skeletonFile: string;
  outPath: string;
  animations: AnimatedAnimation[];
  hashFrom: string | null;
  hashTo: string;
  /** Event declarations added to the root `events` object. */
  eventsDeclared: string[];
  /** Named weighted meshes, whose DEFORMATION was not generated. */
  weightedMeshWarning: string | null;
  /** Inspection of the written file. */
  skeleton: SkeletonReport;
  /** Lint of the written file, with the three naming rules disabled. */
  lint: LintReport;
  /** Error findings present in the INPUT too, so not caused by this tool. */
  lintPreexistingErrors: Array<{ id: string; subject: string | null; message: string }>;
  nextSteps: string[];
}

/** One requested animation. */
export interface AnimateRequest {
  template: TemplateName;
  name?: string | undefined;
  duration?: number | undefined;
  amplitude?: number | undefined;
}

/** Arguments `skeleton_animate` accepts. */
export interface SkeletonAnimateRequest {
  skeleton: string;
  animations: AnimateRequest[];
  outPath?: string | undefined;
  overwriteAnimations?: boolean | undefined;
  overwriteFile?: boolean | undefined;
  emitEvents?: boolean | undefined;
  atlas?: string | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Identity of a lint finding for the delta gate. */
function findingKey(finding: LintFinding): string {
  return `${finding.id}\u0000${finding.subject ?? ''}`;
}

/** Everything the summary is assembled from, before the budget is applied. */
interface SummaryParts {
  head: string;
  perAnimation: Array<{ line: string; note: string }>;
  preserved: string[];
  hash: string;
  honesty: string;
  lint: string;
  preexisting: string | null;
  weighted: string | null;
  events: string | null;
  next: string;
}

/**
 * Assemble the summary, dropping the per-template notes if sixteen
 * animations' worth of them would not fit the inline budget.
 */
export function summariseAnimate(parts: SummaryParts): string {
  const render = (withNotes: boolean): string => {
    const lines = [parts.head];
    for (const entry of parts.perAnimation) {
      lines.push(withNotes ? `  ${entry.line} ${entry.note}` : `  ${entry.line}`);
    }
    if (parts.preserved.length > 0) {
      lines.push(`Existing animations preserved: ${nameList(parts.preserved)}.`);
    }
    if (parts.events !== null) lines.push(parts.events);
    lines.push(parts.hash);
    lines.push(parts.honesty);
    lines.push(parts.lint);
    if (parts.preexisting !== null) lines.push(parts.preexisting);
    if (parts.weighted !== null) lines.push(parts.weighted);
    lines.push(parts.next);
    return lines.join('\n');
  };

  const full = render(true);
  if (full.length <= MAX_INLINE_DETAIL_CHARS) return full;
  const compact = render(false);
  return compact.length <= MAX_INLINE_DETAIL_CHARS
    ? compact
    : `${compact.slice(0, MAX_INLINE_DETAIL_CHARS - 3)}...`;
}

/** Generate template animations into a copy of an exported rig. */
export function skeletonAnimate(
  host: SpineHost,
  args: SkeletonAnimateRequest,
): SpineResult<SkeletonAnimateData> {
  const emitEvents = args.emitEvents ?? false;

  const skeletonFile = readTextFile(host, args.skeleton, 'skeleton data');
  if (!skeletonFile.ok) return skeletonFile;

  const inputReport = inspectSkeletonJson(skeletonFile.data.text);
  if (!inputReport.ok) return inputReport;

  // Re-parsed rather than shared with the report, because the report is a
  // summary: the emitter needs the raw tree it is going to write back.
  const root = JSON.parse(skeletonFile.data.text) as Record<string, unknown>;

  let atlas: AtlasReport | null = null;
  if (args.atlas !== undefined) {
    const atlasFile = readTextFile(host, args.atlas, 'texture atlas');
    if (!atlasFile.ok) return atlasFile;
    const inspected = inspectAtlasText(atlasFile.data.text);
    if (!inspected.ok) return inspected;
    atlas = inspected.data;
  }

  // --- resolve every request before emitting anything ---
  const existingAnimations = isObject(root['animations']) ? root['animations'] : {};
  const requested: Array<{ template: TemplateName; request: EmitRequest }> = [];
  const seen = new Set<string>();

  for (const entry of args.animations) {
    const template = TEMPLATES[entry.template];
    const name = entry.name ?? template.name;

    if (!NAME_PATTERN.test(name)) {
      return err(
        SpineErrorCode.InvalidArgument,
        `"${name}" is not a usable animation name.`,
        'Animation names must match /^[A-Za-z0-9_-]{1,64}$/: letters, digits, underscore and hyphen only.',
      );
    }
    if (seen.has(name)) {
      return err(
        SpineErrorCode.InvalidArgument,
        `Two requested animations resolve to the same name "${name}".`,
        'Give each request its own `name`; the default name is the template name, so two requests for one template need at least one explicit name.',
      );
    }
    seen.add(name);

    if (name in existingAnimations && args.overwriteAnimations !== true) {
      return err(
        SpineErrorCode.InvalidArgument,
        `This skeleton already has an animation called "${name}".`,
        'Pass `overwriteAnimations` true to replace it, or give the request another `name`.',
      );
    }

    requested.push({
      template: entry.template,
      request: {
        name,
        duration: entry.duration ?? template.defaultDuration,
        amplitude: entry.amplitude ?? 1,
        emitEvents,
      },
    });
  }

  // --- fit the templates to the rig, honestly ---
  const emitted: Record<string, unknown> = {};
  const eventDeclarations: Record<string, unknown> = {};
  const emittedKeys: string[] = [];
  const records: Array<{
    template: TemplateName;
    request: EmitRequest;
    usedBones: string[];
    omittedOptional: string[];
    replacedExisting: boolean;
    emittedEvents: string[];
  }> = [];

  for (const { template: templateName, request } of requested) {
    const template = TEMPLATES[templateName];
    const match = matchTemplate(template, inputReport.data.bones.names);

    if (!match.ok) {
      const hints = [
        `Template "${template.name}" needs ${match.missingRequired.join(', ')}, which this rig does not have.`,
        `The rig's bones are: ${nameList(inputReport.data.bones.names)}.`,
      ];
      for (const suggestion of match.suggestions) {
        // Advisory only. The generator will not animate `upper_arm_left` as
        // if it were `arm_left`; it says so and stops.
        hints.push(
          `The rig has \`${suggestion.candidate}\`, which this generator would call \`${suggestion.missing}\` — rename the bone, or rig the motion in the editor.`,
        );
      }
      hints.push(
        'No animation was generated and nothing was written: a renamed or substituted bone would produce motion that looks like success.',
      );

      return err(
        SpineErrorCode.ValidationFailed,
        `Template "${template.name}" does not fit this rig: missing required bone(s) ${match.missingRequired.join(', ')}.`,
        hints.join(' '),
        {
          template: template.name,
          missingRequired: match.missingRequired,
          requiredBones: template.requiredBones,
          optionalBones: template.optionalBones,
          availableBones: inputReport.data.bones.names,
          suggestions: match.suggestions,
        },
      );
    }

    const result = emitAnimation(template, request, match);
    emitted[request.name] = result.animation;
    for (const key of result.emittedKeys) {
      if (!emittedKeys.includes(key)) emittedKeys.push(key);
    }
    for (const [name, declaration] of Object.entries(result.eventDeclarations)) {
      eventDeclarations[name] = declaration;
    }

    records.push({
      template: templateName,
      request,
      usedBones: match.usedBones,
      omittedOptional: match.omittedOptional,
      replacedExisting: request.name in existingAnimations,
      emittedEvents: Object.keys(result.eventDeclarations),
    });
  }

  // --- assemble the output, in memory ---
  const output = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;

  // `setup` and every pre-existing animation survive untouched; a name only
  // disappears when `overwriteAnimations` allowed it above.
  output['animations'] = { ...existingAnimations, ...emitted };

  const eventsDeclared: string[] = [];
  if (emitEvents && Object.keys(eventDeclarations).length > 0) {
    const events = isObject(output['events'])
      ? { ...(output['events'] as Record<string, unknown>) }
      : {};
    for (const [name, declaration] of Object.entries(eventDeclarations)) {
      // Never overwrite an existing declaration: a pre-existing `footstep`
      // keeps its own int/float/string/audio and the keyframe references it.
      if (name in events) continue;
      events[name] = declaration;
      eventsDeclared.push(name);
    }
    output['events'] = events;
  }

  const hashFrom = inputReport.data.meta.hash;
  const hashTo = recomputeSkeletonHash(output);
  const skeletonMeta = isObject(output['skeleton'])
    ? (output['skeleton'] as Record<string, unknown>)
    : {};
  skeletonMeta['hash'] = hashTo;
  output['skeleton'] = skeletonMeta;

  // One level of provenance, projected. Copying the whole previous
  // `_generator` would nest without bound across repeated runs; the depth
  // counter is the only thing the discarded tail was telling anyone.
  const previousGenerator = isObject(root['_generator']) ? root['_generator'] : null;
  const previous =
    previousGenerator === null
      ? null
      : {
          tool:
            typeof previousGenerator['tool'] === 'string'
              ? previousGenerator['tool']
              : 'unknown',
          note:
            typeof previousGenerator['note'] === 'string' ? previousGenerator['note'] : '',
          ...(typeof previousGenerator['hashAlgorithm'] === 'string'
            ? { hashAlgorithm: previousGenerator['hashAlgorithm'] }
            : {}),
        };
  const previousDepth =
    previousGenerator === null
      ? 0
      : typeof previousGenerator['previousDepth'] === 'number'
        ? previousGenerator['previousDepth'] + 1
        : 1;

  output['_generator'] = {
    tool: 'kiro-spine2d-power/skeleton_animate',
    schema: 1,
    note: PLACEHOLDER_MOTION_NOTE,
    templates: records.map((record) => ({
      template: record.template,
      animation: record.request.name,
      duration: record.request.duration,
      amplitude: record.request.amplitude,
      intendedLoop: TEMPLATES[record.template].intendedLoop,
      usedBones: record.usedBones,
      omittedOptional: record.omittedOptional,
      note: TEMPLATES[record.template].note,
    })),
    hashAlgorithm: HASH_ALGORITHM,
    ...(previous === null ? {} : { previous }),
    previousDepth,
  };

  // --- validate before the first byte is written ---
  const validated = validateEmittedAnimations(
    output,
    emittedKeys,
    records.map((record) => record.request.name),
  );
  if (!validated.ok) return validated;

  const outputText = JSON.stringify(output);
  const outputReport = inspectSkeletonJson(outputText);
  if (!outputReport.ok) {
    return err(
      SpineErrorCode.ValidationFailed,
      `The generated skeleton could not be re-inspected: ${outputReport.message}`,
      'This is a defect in the generator; report it with the skeleton that triggered it.',
    );
  }

  const lintOptions = {
    config: { disabled: LINT_DISABLED },
    ...(atlas === null ? {} : { atlas }),
  };
  const inputLint = lintSkeleton(inputReport.data, lintOptions);
  const outputLint = lintSkeleton(outputReport.data, lintOptions);

  const inputErrors = new Set(
    inputLint.findings.filter((f) => f.severity === 'error').map(findingKey),
  );
  const outputErrors = outputLint.findings.filter((f) => f.severity === 'error');
  const newErrors = outputErrors.filter((f) => !inputErrors.has(findingKey(f)));
  const preexisting = outputErrors
    .filter((f) => inputErrors.has(findingKey(f)))
    .map((f) => ({ id: f.id, subject: f.subject ?? null, message: f.message }));

  if (newErrors.length > 0) {
    return err(
      SpineErrorCode.ValidationFailed,
      `Generating these animations introduced ${newErrors.length} new lint error(s): ${nameList(
        newErrors.map((f) => (f.subject ? `${f.id} [${f.subject}]` : f.id)),
      )}.`,
      'This is a defect in the generator; report it with the skeleton that triggered it. Nothing was written.',
      { newFindings: newErrors },
    );
  }

  // --- only now is a path resolved and a byte written ---
  const defaultOut = join(
    dirname(skeletonFile.data.absolute),
    `${basename(skeletonFile.data.absolute).replace(/\.json$/i, '')}-animated.json`,
  );
  const outTarget = resolveWriteTarget(args.outPath ?? defaultOut, host.workspaceRoot);
  if (!outTarget.ok) {
    // `resolveWriteTarget`'s own hint states the rule without naming the
    // parameter to change, and a Spine project living outside the workspace
    // makes this the expected first failure.
    return outTarget.code === SpineErrorCode.PathNotAllowed
      ? err(
          outTarget.code,
          outTarget.message,
          `Pass \`outPath\` inside ${host.workspaceRoot}; the skeleton itself may live anywhere.`,
          outTarget.details,
        )
      : outTarget;
  }
  const outPath = outTarget.data;

  if (host.exists(outPath) && args.overwriteFile !== true) {
    return err(
      SpineErrorCode.InvalidArgument,
      `A file already exists at ${outPath}.`,
      'Pass `overwriteFile` true to replace it, or choose another `outPath`. Two runs with different parameters would otherwise silently destroy the first result.',
    );
  }

  // Pretty-printed and newline-terminated, matching `dump_skeleton_json`.
  host.writeText(outPath, `${JSON.stringify(output, null, 2)}\n`);

  // --- report ---
  const weightedMeshes = [
    ...new Set(
      outputReport.data.attachments.meshes
        .filter((mesh) => mesh.weighted)
        .map((mesh) => mesh.attachment),
    ),
  ];
  const weightedMeshWarning =
    weightedMeshes.length === 0
      ? null
      : `${weightedMeshes.length} weighted mesh(es) follow their bones correctly, but their DEFORMATION was not generated: ${nameList(
          weightedMeshes,
        )}. Mesh deformation needs \`deform\` timelines, which this tool does not write.`;

  const animationByName = new Map(
    outputReport.data.animations.map((animation) => [animation.name, animation]),
  );
  const animations: AnimatedAnimation[] = records.map((record) => {
    const summary = animationByName.get(record.request.name);
    return {
      template: record.template,
      name: record.request.name,
      duration: record.request.duration,
      amplitude: record.request.amplitude,
      intendedLoop: TEMPLATES[record.template].intendedLoop,
      usedBones: record.usedBones,
      omittedOptional: record.omittedOptional,
      timelineCount: summary?.timelineCount ?? 0,
      keyframeCount: summary?.keyframeCount ?? 0,
      replacedExisting: record.replacedExisting,
      emittedEvents: record.emittedEvents,
    };
  });

  const generatedNames = new Set(animations.map((animation) => animation.name));
  const preserved = Object.keys(existingAnimations).filter(
    (name) => !generatedNames.has(name),
  );

  const inputName = basename(skeletonFile.data.absolute);
  const outputName = basename(outPath);
  const firstName = animations[0]?.name ?? '';
  const nextSteps = [
    `skeleton_diff from "${inputName}" to "${outputName}" to see exactly what was added`,
    `render_preview with animation "${firstName}" to see it move`,
  ];

  const data: SkeletonAnimateData = {
    skeletonFile: skeletonFile.data.absolute,
    outPath,
    animations,
    hashFrom,
    hashTo,
    eventsDeclared,
    weightedMeshWarning,
    skeleton: outputReport.data,
    lint: outputLint,
    lintPreexistingErrors: preexisting,
    nextSteps,
  };

  return ok(
    data,
    summariseAnimate({
      head: `Wrote ${animations.length} template-generated animation(s) to ${outPath}.`,
      perAnimation: animations.map((animation) => ({
        line:
          `${animation.name} (${animation.duration.toFixed(2)}s, ${
            animation.intendedLoop ? 'intended to loop' : 'one-shot'
          }) on ${nameList(animation.usedBones)}.` +
          (animation.omittedOptional.length > 0
            ? ` Omitted optional bones the rig lacks: ${nameList(animation.omittedOptional)}.`
            : '') +
          (animation.replacedExisting
            ? ` Replaced the existing animation of the same name, as overwriteAnimations allowed.`
            : ''),
        note: TEMPLATES[animation.template as TemplateName].note,
      })),
      preserved,
      hash: `skeleton.hash recomputed: ${hashFrom ?? '(none)'} -> ${hashTo} (algorithm ${HASH_ALGORITHM}, not the editor's).`,
      honesty: `This is ${PLACEHOLDER_MOTION_NOTE}`,
      lint: `Lint added no new errors (0 new, ${outputLint.counts.warning} warning(s)) with the generator's naming rules disabled.`,
      preexisting:
        preexisting.length === 0
          ? null
          : `Pre-existing lint errors in the input, not caused by this tool: ${nameList(
              preexisting.map((f) => (f.subject ? `${f.id} [${f.subject}]` : f.id)),
            )}.`,
      weighted: weightedMeshWarning,
      events:
        eventsDeclared.length === 0
          ? null
          : `Event declarations added to the root events object: ${nameList(eventsDeclared)}.`,
      next: `Next: ${nextSteps.join('; ')}.`,
    }),
  );
}

/** Register the animation generator. */
export function registerAnimateTools(server: McpServer, host: SpineHost): void {
  server.registerTool(
    'skeleton_animate',
    {
      title: 'Generate placeholder animations for a rig',
      description: [
        'Generate idle, walk, wave, jump and turn_head animations into an exported Spine 4.2 skeleton and write the result as a second JSON file.',
        'Each template declares the bones it needs: a rig missing a required bone fails with the names of the bones it does have, and nothing is written —',
        'no bone is ever substituted, because substituted motion looks like success.',
        'A missing optional bone drops only its own timelines and is reported.',
        'Existing animations, including an empty setup, are preserved; skeleton.hash is recomputed and the algorithm is named in the file.',
        `This is ${PLACEHOLDER_MOTION_NOTE}`,
        'Reads and writes the data files directly — no Spine installation, no license and no Python needed.',
      ].join(' '),
      inputSchema: {
        skeleton: z.string().describe('Path to the exported skeleton JSON file.'),
        animations: z
          .array(
            z.object({
              template: z
                .enum([...TEMPLATE_NAMES] as [TemplateName, ...TemplateName[]])
                .describe(
                  'Which template to generate: idle (2.0s loop), walk (1.0s loop, in place), wave (1.0s one-shot), jump (0.8s one-shot) or turn_head (1.2s one-shot).',
                ),
              name: z
                .string()
                .optional()
                .describe(
                  'Name for the generated animation. Defaults to the template name; must match /^[A-Za-z0-9_-]{1,64}$/ and be unique within the request.',
                ),
              duration: z
                .number()
                .min(0.1)
                .max(60)
                .optional()
                .describe("Duration in seconds. Defaults to the template's own duration."),
              amplitude: z
                .number()
                .min(0.1)
                .max(3)
                .optional()
                .describe(
                  'How far the motion deviates from the setup pose. Defaults to 1; scales the deviation, so a scale track stays positive.',
                ),
            }),
          )
          .min(1)
          .max(16)
          .describe('One entry per animation to generate, 1 to 16 of them.'),
        outPath: z
          .string()
          .optional()
          .describe(
            'Where to write the result, inside the workspace. Defaults to <skeleton folder>/<stem>-animated.json.',
          ),
        overwriteAnimations: z
          .boolean()
          .optional()
          .describe(
            'Allow replacing an animation that already exists in the data. Defaults to false.',
          ),
        overwriteFile: z
          .boolean()
          .optional()
          .describe(
            'Allow overwriting the output file on disk. Defaults to false, so a second run with different parameters cannot silently destroy the first result.',
          ),
        emitEvents: z
          .boolean()
          .optional()
          .describe(
            'Emit the event keyframes a template declares, declaring any missing event in the root events object without overwriting an existing declaration. Defaults to false.',
          ),
        atlas: z
          .string()
          .optional()
          .describe(
            'Optional path to the matching .atlas file, which enables the atlas lint rules on the result.',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => skeletonAnimate(host, args)),
  );
}
