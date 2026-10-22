// ============================================================
// Group D — `skeleton_document`.
//
// Writes two files describing what a rig *does*: the bone hierarchy with
// setup-pose and derived world transforms, the constraints resolved per
// bone from the data, the per-bone influence measured by perturbing one
// bone and re-rendering, and a motion profile per animation.
//
// It sits with the Group D verification tools rather than the Group B data
// tools because it shares their injected `BrowserLauncher`. Three of its
// four sections need no browser at all, which is why losing Chromium
// degrades the document instead of failing the call.
//
// Nothing pixel-shaped leaves this file. `Buffer`, `RgbaImage`, PNG data
// URLs and the changed-pixel mask exist only inside `renderProbes` and the
// `onProbeFrame` reducer below; the payload carries paths and scalars,
// because `toToolResult` emits the payload a second time as a text block
// and a document crossing stdio twice per call is what killed the
// connection once already.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

import { inspectAtlasText } from '../atlas-data';
import { byCodeUnit, round } from '../canonical-json';
import { SpineHost } from '../host';
import { resolveReadTarget, resolveWriteTarget } from '../path-safety';
import { RgbaImage, decodePng } from '../png';
import {
  BrowserLauncher,
  CHROMIUM_LAUNCH_ARGS,
  ProbeFrame,
  createPlaywrightLauncher,
  renderProbes,
} from '../preview-renderer';
import {
  BUCKET_THRESHOLDS,
  InfluenceBoneDoc,
  InfluenceDoc,
  InfluenceSlotDoc,
  MAX_INFLUENCED_SLOTS,
  ProbeMode,
  SkeletonDocument,
  buildDocument,
  compareStaleness,
  fingerprintSkeleton,
  renderDocumentMarkdown,
  resolveConstraintsByBone,
} from '../skeleton-doc';
import {
  SlotBox,
  attributeChangedPixels,
  bucketOf,
  planProbes,
  resolveReachableSlots,
} from '../skeleton-probe';
import {
  parseSkeletonJson,
  readBones,
  readSkinsAndAttachments,
  readSlots,
} from '../skeleton-data';
import { MAX_INLINE_DETAIL_CHARS, MAX_NAMED_ITEMS, guardTool, nameList } from '../tool-result';
import { DEFAULT_THRESHOLDS, changedPixelMask } from '../visual-regression';
import { SpineErrorCode, SpineResult, err, ok } from '../types';
import { loadAtlasImages } from './preview-tools';
import { readTextFile } from './data-tools';

/**
 * Launch args the probe browser uses, recorded in every document. Read
 * from the launcher's own constant so the document cannot drift away from
 * the environment the probes actually ran in.
 */
const PROBE_LAUNCH_ARGS = [...CHROMIUM_LAUNCH_ARGS];

/** Suffix every file this tool writes shares. */
const DOC_SUFFIX = '.spine-doc.';

/** Other `*.spine-doc.*` files named in the payload, with the rest as a count. */
export const MAX_FOREIGN_DOCS_REPORTED = 20;

/** Reason recorded when the caller asked for no measurement. */
const PROBE_OFF_REASON =
  "Not measured: probeMode was 'off'. Re-run with probeMode 'rotate' and an atlas to measure influence.";

/** Payload returned by `skeleton_document`. Every array here is bounded. */
export interface SkeletonDocumentData {
  skeletonFile: string;
  atlasFile: string | null;
  outDir: string;
  markdownPath: string;
  jsonPath: string;
  counts: {
    bones: number;
    slots: number;
    skins: number;
    attachments: number;
    constraints: number;
    animations: number;
    events: number;
    maxDepth: number;
    rootCount: number;
    weightedMeshes: number;
  };
  /** Capped at {@link MAX_NAMED_ITEMS}; the full list is in the document. */
  deadBones: string[];
  deadBoneCount: number;
  /** One short line per non-empty defect list, capped at {@link MAX_NAMED_ITEMS}. */
  defectSummary: string[];
  /** Names, not paths. Everything else is left exactly where it was. */
  foreignDocsKept: string[];
  foreignDocsKeptTruncated: number;
  previousDocument: {
    existed: boolean;
    staleness: 'fresh' | 'hashChanged' | 'fingerprintChanged' | 'both' | 'absent';
    previousHash: string | null;
    previousFingerprint: string | null;
    /** Probes the previous document had measured that this run replaced. */
    influenceDiscarded: number;
  };
  probe: {
    mode: ProbeMode;
    available: boolean;
    reason: string | null;
    planned: number;
    performed: number;
    elapsedMs: number;
    canvas: { width: number; height: number } | null;
    probeWarnings: string[];
  };
}

/** Arguments `skeleton_document` accepts. */
export interface SkeletonDocumentRequest {
  skeleton: string;
  atlas?: string | undefined;
  imageDir?: string | undefined;
  outDir?: string | undefined;
  probeMode?: ProbeMode | undefined;
  probeRotationDegrees?: number | undefined;
  probeTranslateFraction?: number | undefined;
  probeBones?: string[] | undefined;
  maxProbes?: number | undefined;
  probeWidth?: number | undefined;
  probeHeight?: number | undefined;
  skin?: string | undefined;
}

/** What one probe frame reduced to. No pixels, by construction. */
interface ProbeAttribution {
  bone: string;
  axis: ProbeFrame['axis'];
  changedPixels: number;
  totalPixels: number;
  maxChannelDelta: number;
  unattributed: number;
  perSlot: Array<{ slot: string; changedPixels: number }>;
}

/** The empty influence section, shared by both recoverable degradations. */
function degradedInfluence(
  mode: ProbeMode,
  reason: string,
  planned: number,
  perturbation: { rotationDegrees: number; translateFraction: number },
): InfluenceDoc {
  return {
    available: false,
    reason,
    mode,
    canvas: null,
    perturbation: {
      rotationDegrees: perturbation.rotationDegrees,
      translateFraction: perturbation.translateFraction,
      translateUnits: 0,
    },
    thresholds: {
      channelTolerance: DEFAULT_THRESHOLDS.channelTolerance,
      slightFraction: BUCKET_THRESHOLDS.slightFraction,
      moderateFraction: BUCKET_THRESHOLDS.moderateFraction,
    },
    probesPlanned: planned,
    probesPerformed: 0,
    environment: { launchArgs: PROBE_LAUNCH_ARGS, useGl: null },
    framing: null,
    warnings: [],
    bones: [],
  };
}

/** What a previous document at the target path was describing, if anything. */
interface PreviousDocument {
  existed: boolean;
  skeletonHash: string | null;
  fingerprint: string | null;
  influenceAvailable: boolean;
  probesPerformed: number;
}

/**
 * Read the document already at the target path, defensively.
 *
 * A corrupt or foreign JSON is treated as "absent", never as an error:
 * this is a convenience report, not an input, and failing a documentation
 * run because of an unrelated file would be the wrong trade. Only string
 * and number values are read.
 */
function readPreviousDocument(host: SpineHost, jsonPath: string): PreviousDocument {
  const absent: PreviousDocument = {
    existed: false,
    skeletonHash: null,
    fingerprint: null,
    influenceAvailable: false,
    probesPerformed: 0,
  };

  const text = host.readText(jsonPath);
  if (text === null) return absent;

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const source = (parsed['source'] ?? {}) as Record<string, unknown>;
    const influence = (parsed['influence'] ?? {}) as Record<string, unknown>;
    return {
      existed: true,
      skeletonHash:
        typeof source['skeletonHash'] === 'string' ? source['skeletonHash'] : null,
      fingerprint: typeof source['fingerprint'] === 'string' ? source['fingerprint'] : null,
      influenceAvailable: influence['available'] === true,
      probesPerformed:
        typeof influence['probesPerformed'] === 'number' ? influence['probesPerformed'] : 0,
    };
  } catch {
    return absent;
  }
}

/** Human-readable defect lines, one per non-empty list. */
function defectLines(document: SkeletonDocument): string[] {
  const lines: string[] = [];
  if (document.defects.multipleRoots) {
    lines.push(`${document.defects.rootCount} root bones`);
  }
  for (const [key, value] of Object.entries(document.defects)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    lines.push(`${key}: ${nameList(value.map((entry) => String(entry)))}`);
  }
  return lines;
}

/** Everything the summary is assembled from, before it is trimmed. */
interface SummaryParts {
  head: string;
  markdownPath: string;
  jsonPath: string;
  influencePrefix: string;
  /** Dead-bone names, or null when nothing was measured (no clause at all). */
  deadBones: string[] | null;
  animations: string[];
  staleness: string;
  foreignDocs: string[];
  discarded: string | null;
  notes: string[];
}

/**
 * Assemble the summary, then shed the least useful text until it fits.
 *
 * The budget is a property of the code rather than of a path-length
 * argument: two of these lines are absolute paths, and a 200-character
 * Windows `outDir` plus five 64-character bone names can carry the total
 * past the budget on its own. So stage 3 drops to one path, and a terminal
 * truncation guarantees the bound for any input at all.
 */
export function summariseDocument(parts: SummaryParts): string {
  const render = (stage: number): string => {
    const compact = stage >= 2;
    const lines: string[] = [parts.head];

    if (stage >= 3) {
      lines.push(`JSON: ${parts.jsonPath}`);
    } else {
      lines.push(`Markdown: ${parts.markdownPath}`);
      lines.push(`JSON:     ${parts.jsonPath}`);
    }

    if (parts.deadBones === null) {
      lines.push(parts.influencePrefix);
    } else if (compact) {
      lines.push(
        `${parts.influencePrefix} Bones with no visible effect: ${parts.deadBones.length} name(s), see the document.`,
      );
    } else {
      lines.push(
        `${parts.influencePrefix} Bones with no visible effect: ${
          parts.deadBones.length === 0 ? 'none' : nameList(parts.deadBones)
        }.`,
      );
    }

    if (parts.animations.length > 0) {
      lines.push(
        compact
          ? `Animations: ${parts.animations.length} animation(s), see the document.`
          : `Animations: ${nameList(parts.animations)}.`,
      );
    }

    lines.push(parts.staleness);

    if (parts.foreignDocs.length > 0) {
      lines.push(
        compact
          ? `Other *.spine-doc.* files left untouched: ${parts.foreignDocs.length} name(s), see the document.`
          : `Other *.spine-doc.* files left untouched: ${nameList(parts.foreignDocs)}.`,
      );
    }

    // Inserted above the Note: lines, so it is shed only after they are.
    if (parts.discarded !== null) lines.push(parts.discarded);

    if (stage < 1) lines.push(...parts.notes.map((note) => `Note: ${note}`));

    return lines.join('\n');
  };

  for (let stage = 0; stage <= 3; stage++) {
    const text = render(stage);
    if (text.length <= MAX_INLINE_DETAIL_CHARS) return text;
  }

  const final = render(3);
  return final.length <= MAX_INLINE_DETAIL_CHARS
    ? final
    : `${final.slice(0, MAX_INLINE_DETAIL_CHARS - 3)}...`;
}

/** Document what a rig does, and write the two files. */
export async function skeletonDocument(
  host: SpineHost,
  launcher: BrowserLauncher,
  args: SkeletonDocumentRequest,
): Promise<SpineResult<SkeletonDocumentData>> {
  const probeMode: ProbeMode = args.probeMode ?? 'rotate';
  const rotationDegrees = args.probeRotationDegrees ?? 20;
  const translateFraction = args.probeTranslateFraction ?? 0.05;
  const maxProbes = args.maxProbes ?? 256;
  const probeWidth = args.probeWidth ?? 256;
  const probeHeight = args.probeHeight ?? 256;

  const skeletonFile = readTextFile(host, args.skeleton, 'skeleton data');
  if (!skeletonFile.ok) return skeletonFile;

  const parsed = parseSkeletonJson(skeletonFile.data.text);
  if (!parsed.ok) return parsed;
  const root = parsed.data;

  // --- the atlas, which probing cannot do without ---
  if (probeMode !== 'off' && args.atlas === undefined) {
    return err(
      SpineErrorCode.InvalidArgument,
      'Probing renders the rig, so it needs the atlas.',
      "Pass `atlas`, or set `probeMode` to 'off' for a data-only document.",
    );
  }

  let atlasPath: string | null = null;
  let atlasText: string | null = null;
  if (args.atlas !== undefined) {
    const atlasFile = readTextFile(host, args.atlas, 'texture atlas');
    if (!atlasFile.ok) return atlasFile;
    atlasPath = atlasFile.data.absolute;
    atlasText = atlasFile.data.text;
  }

  // --- validate the skin against the data, not against the renderer ---
  const skinNames = (Array.isArray(root['skins']) ? root['skins'] : [])
    .map((skin) =>
      typeof skin === 'object' && skin !== null
        ? ((skin as Record<string, unknown>)['name'] as string | undefined)
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
  if (args.skin !== undefined && !skinNames.includes(args.skin)) {
    return err(
      SpineErrorCode.InvalidArgument,
      `Skin "${args.skin}" is not in this skeleton.`,
      skinNames.length > 0
        ? `Available skins: ${skinNames.join(', ')}.`
        : 'This skeleton declares no skins; omit `skin`.',
    );
  }

  // --- the cost model, before the browser and before any write ---
  const bones = readBones(root);
  const plan = planProbes(bones.names, {
    probeMode,
    probeBones: args.probeBones,
    maxProbes,
  });
  if (!plan.ok) return plan;

  // --- where the two files go ---
  const defaultOutDir = dirname(skeletonFile.data.absolute);
  const outTarget = resolveWriteTarget(args.outDir ?? defaultOutDir, host.workspaceRoot);
  if (!outTarget.ok) {
    // `resolveWriteTarget`'s own hint states the rule without naming the
    // parameter to change, and this is the expected first failure for a
    // Spine project living outside the workspace.
    return outTarget.code === SpineErrorCode.PathNotAllowed
      ? err(
          outTarget.code,
          outTarget.message,
          `Pass \`outDir\` inside ${host.workspaceRoot}; the skeleton itself may live anywhere.`,
          outTarget.details,
        )
      : outTarget;
  }
  const outDir = outTarget.data;
  const stem = basename(skeletonFile.data.absolute).replace(/\.json$/i, '');
  const markdownName = `${stem}${DOC_SUFFIX}md`;
  const jsonName = `${stem}${DOC_SUFFIX}json`;
  const markdownPath = join(outDir, markdownName);
  const jsonPath = join(outDir, jsonName);

  const previous = readPreviousDocument(host, jsonPath);

  // --- measure influence, or record honestly why it was not measured ---
  const slotNames = (Array.isArray(root['slots']) ? root['slots'] : [])
    .map((slot) =>
      typeof slot === 'object' && slot !== null
        ? ((slot as Record<string, unknown>)['name'] as string | undefined)
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
  const { attachments } = readSkinsAndAttachments(root, slotNames);
  const attachmentsOfSlot = new Map<string, Set<string>>();
  for (const entry of attachments.entries) {
    const set = attachmentsOfSlot.get(entry.slot) ?? new Set<string>();
    set.add(entry.key);
    attachmentsOfSlot.set(entry.slot, set);
  }

  let influence: InfluenceDoc;
  let elapsedMs = 0;
  let degradedForDiscard = false;

  if (probeMode === 'off') {
    // The renderer is never called at all.
    influence = degradedInfluence(probeMode, PROBE_OFF_REASON, 0, {
      rotationDegrees,
      translateFraction,
    });
    degradedForDiscard = true;
  } else {
    const atlas = inspectAtlasText(atlasText as string);
    if (!atlas.ok) return atlas;

    let imageDir: string | undefined;
    if (args.imageDir !== undefined) {
      const resolved = resolveReadTarget(args.imageDir, host.workspaceRoot, host.exists);
      if (!resolved.ok) return resolved;
      imageDir = resolved.data;
    }

    const images = loadAtlasImages(host, atlasPath as string, atlas.data, imageDir);
    if (!images.ok) return images;

    // Design-review MEDIUM 2: derived from the atlas, exactly as
    // `prepareRender` does it, not fixed at true. RENDERABLE_ATLAS
    // declares `pma: false`, so a hardcoded true would composite the
    // repo's own renderable fixture differently from every existing
    // preview and baseline of it — and the whole point of sharing the
    // launcher is that documents and baselines describe one pipeline.
    const premultipliedAlpha = atlas.data.pages.some((page) => page.pma);

    const attributions: ProbeAttribution[] = [];
    /**
     * Decoded on the first frame and closed over, not re-decoded per
     * probe: at the schema maximum that would be 512 decodes of one
     * unchanging image. Held in a box so the reducer's writes are visible
     * to the code after the await.
     */
    const neutral: { image: RgbaImage | null } = { image: null };
    const failure: { decode: string | null } = { decode: null };

    const started = Date.now();
    const probed = await renderProbes(host, launcher, {
      skeletonJson: skeletonFile.data.text,
      atlasText: atlasText as string,
      images: images.data,
      skin: args.skin ?? null,
      probes: plan.data.targets,
      rotationDegrees,
      translateFraction,
      width: probeWidth,
      height: probeHeight,
      premultipliedAlpha,
      scale: 1,
      onProbeFrame: (frame, neutralFrame) => {
        if (failure.decode !== null) return;

        // Only the decodes are guarded. A size mismatch out of
        // `changedPixelMask` is unreachable by construction — every frame
        // comes off one canvas sized once — so it is left to throw and be
        // reported as the generator defect it would be.
        const decoded = ((): { baseline: RgbaImage; actual: RgbaImage } | null => {
          try {
            neutral.image ??= decodePng(neutralFrame.png);
            return { baseline: neutral.image, actual: decodePng(frame.png) };
          } catch (cause) {
            failure.decode = cause instanceof Error ? cause.message : String(cause);
            return null;
          }
        })();
        if (decoded === null) return;

        const mask = changedPixelMask(decoded.baseline, decoded.actual);
        const attributed = attributeChangedPixels(
          mask,
          neutralFrame.slotBoxes as SlotBox[],
          frame.slotBoxes as SlotBox[],
          // Slot declaration order IS the setup-pose draw order, and it is
          // known here without waiting for the page to report it.
          slotNames,
        );

        attributions.push({
          bone: frame.bone,
          axis: frame.axis,
          changedPixels: mask.differentPixels,
          totalPixels: mask.width * mask.height,
          maxChannelDelta: mask.maxChannelDelta,
          unattributed: attributed.unattributed,
          perSlot: attributed.perSlot,
        });
      },
    });
    elapsedMs = Date.now() - started;

    if (!probed.ok) {
      if (probed.code !== SpineErrorCode.DependencyMissing) {
        // Any other failure is returned as the error it is, with nothing
        // written: a document that says "no influence data" when the real
        // problem is a broken atlas is the dishonesty this tool removes.
        return probed;
      }
      // Chromium or playwright-core absent: write both files, say so.
      influence = degradedInfluence(
        probeMode,
        `${probed.message} ${probed.hint}`,
        plan.data.plannedCount,
        { rotationDegrees, translateFraction },
      );
      degradedForDiscard = true;
    } else if (failure.decode !== null) {
      return err(
        SpineErrorCode.ParseFailed,
        `A probe render could not be decoded: ${failure.decode}`,
        'This is a defect in the probe path, not in your data; report it with the skeleton that triggered it.',
      );
    } else {
      const totalPixels = probed.data.canvas.width * probed.data.canvas.height;

      // Which slots each bone could move at all, from the hierarchy and
      // the constraints. Attribution is by axis-aligned bounding box, so a
      // credited slot is not necessarily a moved one, and the data says
      // which is which without costing a probe.
      const reachable = resolveReachableSlots(
        bones.parents,
        readSlots(root, new Set(bones.names)).bones,
        resolveConstraintsByBone(root),
      );

      const boneDocs: InfluenceBoneDoc[] = attributions.map((entry) => {
        const changedFraction = round(
          totalPixels === 0 ? 0 : entry.changedPixels / totalPixels,
          4,
        );
        const reachableSlots = reachable.get(entry.bone);
        const slots: InfluenceSlotDoc[] = entry.perSlot
          .slice(0, MAX_INFLUENCED_SLOTS)
          .map((slot) => {
            const fraction = round(
              totalPixels === 0 ? 0 : slot.changedPixels / totalPixels,
              4,
            );
            return {
              slot: slot.slot,
              changedPixels: slot.changedPixels,
              changedFraction: fraction,
              bucket: bucketOf(fraction),
              attachments: [...(attachmentsOfSlot.get(slot.slot) ?? [])].sort(byCodeUnit),
              // Unresolved stays unflagged: a bone the resolver could not
              // place is not claimed to be unable to move anything.
              overlapOnly: reachableSlots !== undefined && !reachableSlots.has(slot.slot),
            };
          });

        return {
          bone: entry.bone,
          axis: entry.axis,
          delta:
            entry.axis === 'rotate' ? rotationDegrees : probed.data.translateUnits,
          changedPixels: entry.changedPixels,
          totalPixels: entry.totalPixels,
          changedFraction,
          bucket: bucketOf(changedFraction),
          maxChannelDelta: entry.maxChannelDelta,
          noVisibleEffect: entry.changedPixels === 0,
          slots,
          slotsTruncated: Math.max(0, entry.perSlot.length - MAX_INFLUENCED_SLOTS),
          unattributedPixels: entry.unattributed,
          unattributedFraction: round(
            totalPixels === 0 ? 0 : entry.unattributed / totalPixels,
            4,
          ),
        };
      });

      influence = {
        available: true,
        reason: null,
        mode: probeMode,
        canvas: probed.data.canvas,
        perturbation: {
          rotationDegrees,
          translateFraction,
          translateUnits: round(probed.data.translateUnits, 3),
        },
        thresholds: {
          channelTolerance: DEFAULT_THRESHOLDS.channelTolerance,
          slightFraction: BUCKET_THRESHOLDS.slightFraction,
          moderateFraction: BUCKET_THRESHOLDS.moderateFraction,
        },
        probesPlanned: plan.data.plannedCount,
        probesPerformed: boneDocs.length,
        environment: { launchArgs: PROBE_LAUNCH_ARGS, useGl: null },
        framing: {
          x: round(probed.data.framing.x, 3),
          y: round(probed.data.framing.y, 3),
          width: round(probed.data.framing.width, 3),
          height: round(probed.data.framing.height, 3),
          padding: probed.data.framing.padding,
          fromPoses: probed.data.framing.fromPoses,
        },
        warnings: [...probed.data.warnings].sort(byCodeUnit).slice(0, MAX_NAMED_ITEMS),
        bones: boneDocs,
      };
    }
  }

  // --- assemble and write ---
  const document = buildDocument({
    root,
    skeletonFile: skeletonFile.data.absolute,
    atlasFile: atlasPath,
    generatedAt: new Date().toISOString(),
    influence,
  });

  host.writeText(markdownPath, renderDocumentMarkdown(document));
  host.writeText(jsonPath, `${JSON.stringify(document, null, 2)}\n`);

  // Nothing is ever deleted. This tool's own two names are overwritten in
  // place, so it has no stale-file problem to solve; the whole
  // `*.spine-doc.*` family is reported instead, not just the two
  // extensions this version writes.
  const owned = new Set([markdownName, jsonName]);
  const foreign = host
    .listDir(outDir)
    .filter((name) => /\.spine-doc\./i.test(name) && !owned.has(name))
    .sort(byCodeUnit);

  const staleness = compareStaleness(
    previous.existed
      ? { skeletonHash: previous.skeletonHash, fingerprint: previous.fingerprint }
      : null,
    { skeletonHash: document.source.skeletonHash, fingerprint: document.source.fingerprint },
  );

  const influenceDiscarded =
    degradedForDiscard && previous.influenceAvailable ? previous.probesPerformed : 0;

  const data: SkeletonDocumentData = {
    skeletonFile: skeletonFile.data.absolute,
    atlasFile: atlasPath,
    outDir,
    markdownPath,
    jsonPath,
    counts: {
      bones: document.summary.boneCount,
      slots: document.summary.slotCount,
      skins: document.summary.skinCount,
      attachments: document.summary.attachmentCount,
      constraints: document.summary.constraintCount,
      animations: document.summary.animationCount,
      events: document.summary.eventCount,
      maxDepth: document.summary.maxDepth,
      rootCount: document.summary.rootCount,
      weightedMeshes: document.summary.weightedMeshCount,
    },
    deadBones: document.summary.deadBones.slice(0, MAX_NAMED_ITEMS),
    deadBoneCount: document.summary.deadBones.length,
    defectSummary: defectLines(document).slice(0, MAX_NAMED_ITEMS),
    foreignDocsKept: foreign.slice(0, MAX_FOREIGN_DOCS_REPORTED),
    foreignDocsKeptTruncated: Math.max(0, foreign.length - MAX_FOREIGN_DOCS_REPORTED),
    previousDocument: {
      existed: previous.existed,
      staleness,
      previousHash: previous.skeletonHash,
      previousFingerprint: previous.fingerprint,
      influenceDiscarded,
    },
    probe: {
      mode: probeMode,
      available: influence.available,
      reason: influence.reason,
      planned: influence.probesPlanned,
      performed: influence.probesPerformed,
      elapsedMs: influence.available ? elapsedMs : 0,
      canvas: influence.canvas,
      probeWarnings: influence.warnings.slice(0, MAX_NAMED_ITEMS),
    },
  };

  return ok(data, summariseDocument(summaryParts(document, data)));
}

/** The ten candidate summary lines, before the shedding ladder runs. */
function summaryParts(
  document: SkeletonDocument,
  data: SkeletonDocumentData,
): SummaryParts {
  const stem = basename(data.skeletonFile);

  const stalenessLine = {
    absent: 'Staleness: there was no previous document at this path.',
    fresh: 'Staleness: the previous document described the same data, so it was already current.',
    hashChanged:
      'Staleness: the previous document described a different skeleton.hash, so it was stale; this one matches.',
    fingerprintChanged:
      'Staleness: the previous document described a different fingerprint, so it was stale; this one matches.',
    both: 'Staleness: the previous document described a different skeleton.hash and fingerprint, so it was stale; this one matches.',
  }[data.previousDocument.staleness];

  return {
    head:
      `Documented ${stem}: ${data.counts.bones} bones (depth ${data.counts.maxDepth}), ` +
      `${data.counts.slots} slots, ${data.counts.animations} animation(s), ` +
      `${data.counts.constraints} constraint(s).`,
    markdownPath: data.markdownPath,
    jsonPath: data.jsonPath,
    influencePrefix: data.probe.available
      ? `Influence: ${data.probe.performed} probe(s) in ${data.probe.mode} mode, ${(
          data.probe.elapsedMs / 1000
        ).toFixed(1)}s of render time.`
      : `Influence: not measured — ${data.probe.reason ?? 'no reason was recorded.'}`,
    // Null suppresses the clause entirely: an ungated "(none)" would tell
    // a reader the rig has no dead bones when nobody looked.
    deadBones: data.probe.available ? document.summary.deadBones : null,
    animations: document.animations.map(
      (animation) =>
        `${animation.name} (${animation.duration.toFixed(2)}s, ${
          animation.loopable.value ? 'loops' : 'one-shot'
        }${animation.rootMotion.locomotive ? '' : ', in place'})`,
    ),
    staleness: stalenessLine,
    foreignDocs: data.foreignDocsKept,
    discarded:
      data.previousDocument.influenceDiscarded > 0
        ? `The previous document had measured influence for ${data.previousDocument.influenceDiscarded} bone(s); this run replaced it with a data-only document because ${
            data.probe.mode === 'off'
              ? "`probeMode` was 'off'"
              : 'Chromium was unavailable'
          }. Re-run with \`probeMode: 'rotate'\` to measure it again.`
        : null,
    notes: [
      'skeleton.hash alone does not detect change — see "Staleness" in the document.',
      'influence is measured from software-rasterised renders; constraint following is read from the data, never inferred from pixels.',
    ],
  };
}

/** Register the documentation tool. */
export function registerDocTools(
  server: McpServer,
  host: SpineHost,
  launcher: BrowserLauncher = createPlaywrightLauncher(),
): void {
  server.registerTool(
    'skeleton_document',
    {
      title: 'Document what a rig does',
      description: [
        'Write <basename>.spine-doc.md and .spine-doc.json describing what a rig does, in four sections:',
        'the bone hierarchy with setup-pose and derived world transforms, the IK/transform/path/physics constraints resolved per bone,',
        'the per-bone influence measured by perturbing one bone and re-rendering it, and a motion profile per animation.',
        'Constraint following is read from the skeleton data and never inferred from pixels; influence is measured by rendering, so probing costs',
        'one render per bone-axis combination plus one — set probeMode to "off" for the three sections that need no browser.',
        'Records both skeleton.hash and its own content fingerprint, because the hash alone does not detect change.',
      ].join(' '),
      inputSchema: {
        skeleton: z.string().describe('Path to the exported skeleton JSON file.'),
        atlas: z
          .string()
          .optional()
          .describe("Path to the matching .atlas file. Required unless `probeMode` is 'off'."),
        imageDir: z
          .string()
          .optional()
          .describe('Folder holding the atlas page images. Defaults to the atlas folder.'),
        outDir: z
          .string()
          .optional()
          .describe(
            'Folder to write the two documents to, inside the workspace. Defaults to the skeleton folder.',
          ),
        probeMode: z
          .enum(['off', 'rotate', 'full'])
          .optional()
          .describe(
            "How much to measure: 'off' launches no browser, 'rotate' probes one axis per bone, 'full' probes three. Defaults to 'rotate'.",
          ),
        probeRotationDegrees: z
          .number()
          .min(1)
          .max(90)
          .optional()
          .describe('Rotation applied to one bone at a time. Defaults to 20.'),
        probeTranslateFraction: z
          .number()
          .min(0.001)
          .max(0.5)
          .optional()
          .describe(
            'Translation applied in `full` mode, as a fraction of the larger setup-pose bounds axis. Defaults to 0.05.',
          ),
        probeBones: z
          .array(z.string())
          .optional()
          .describe('Only probe these bones. Every entry must be a declared bone name.'),
        maxProbes: z
          .number()
          .int()
          .min(1)
          .max(512)
          .optional()
          .describe(
            'Refuse to render more than this many bone-axis combinations. Defaults to 256; the list is never silently truncated.',
          ),
        probeWidth: z
          .number()
          .int()
          .min(64)
          .max(1024)
          .optional()
          .describe('Probe canvas width in pixels. Defaults to 256.'),
        probeHeight: z
          .number()
          .int()
          .min(64)
          .max(1024)
          .optional()
          .describe('Probe canvas height in pixels. Defaults to 256.'),
        skin: z.string().optional().describe('Skin to apply before probing.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => guardTool(() => skeletonDocument(host, launcher, args)),
  );
}
