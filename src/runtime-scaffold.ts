// ============================================================
// Group E — runtime integration planning.
//
// Each target has file-naming rules that are easy to get wrong and produce
// an import that silently does nothing. They are encoded here because they
// are facts, not preferences:
//
//  spine-unity   atlas must end in `.atlas.txt` and binary data in
//                `.skel.bytes`; a plain `.atlas` or `.skel` cannot be
//                loaded at all. Unity then generates `_Atlas`, `_Material`
//                and `_SkeletonData` assets automatically.
//  spine-godot   JSON skeletons must be renamed to `.spine-json`; since
//                2022 the importer refuses `.json`, because Godot plugins
//                fight over that extension.
//  spine-ts      no renaming, but the runtime package version must match
//                the editor's major.minor.
//
// The version rule applies everywhere: data exported from a 4.2 editor
// needs a 4.2 runtime, and the runtimes enforce it on load.
// ============================================================

import { AtlasReport } from './atlas-data';
import { SkeletonReport } from './skeleton-data';
import { parseVersion, runtimeBranchFor } from './spine-env';

/** Supported integration targets. */
export const RUNTIME_TARGETS = ['unity', 'web', 'godot'] as const;

export type RuntimeTarget = (typeof RUNTIME_TARGETS)[number];

/** A file the integration needs, and what it must be called. */
export interface AssetPlacement {
  /** Source file, as exported. */
  from: string;
  /** Name the target requires. */
  to: string;
  /** Why the rename is needed, when it is. */
  reason: string | null;
}

/** A generated file. */
export interface ScaffoldFile {
  /** Path relative to the destination directory. */
  path: string;
  content: string;
}

/** Suggested mix duration between two animations. */
export interface MixSuggestion {
  from: string;
  to: string;
  seconds: number;
  reason: string;
}

/** The whole plan for one target. */
export interface ScaffoldPlan {
  target: RuntimeTarget;
  /** `spine-runtimes` branch the data needs. */
  runtimeBranch: string | null;
  /** Version compatibility findings; a non-empty list blocks integration. */
  blockers: string[];
  warnings: string[];
  placements: AssetPlacement[];
  mixTable: MixSuggestion[];
  defaultMix: number;
  files: ScaffoldFile[];
  steps: string[];
}

/** Default mix, in seconds, when two animations have nothing in common. */
export const DEFAULT_MIX_SECONDS = 0.2;

/**
 * Derive mix durations from the skeleton.
 *
 * The heuristic is deliberately simple and explained in the output: short
 * animations get short mixes, because a 0.2s blend into a 0.25s attack
 * swallows the attack. Animations that share animated bones can blend
 * longer, since the pose difference is smaller.
 */
export function suggestMixTable(
  report: SkeletonReport,
  maxPairs = 24,
): MixSuggestion[] {
  const animations = report.animations.filter(
    (animation) => animation.timelineCount > 0,
  );
  const suggestions: MixSuggestion[] = [];

  for (const from of animations) {
    for (const to of animations) {
      if (from.name === to.name) continue;
      if (suggestions.length >= maxPairs) break;

      const shorter = Math.min(from.duration, to.duration);
      const fromBones = new Set(from.animatedBones);
      const shared = to.animatedBones.filter((bone) => fromBones.has(bone)).length;
      const union =
        new Set([...from.animatedBones, ...to.animatedBones]).size || 1;
      const overlap = shared / union;

      let seconds = DEFAULT_MIX_SECONDS;
      let reason = 'default blend';

      if (overlap > 0.6) {
        seconds = 0.3;
        reason = `${Math.round(overlap * 100)}% of animated bones are shared, so a longer blend reads smoothly`;
      } else if (overlap < 0.2) {
        seconds = 0.15;
        reason = `only ${Math.round(overlap * 100)}% of animated bones are shared, so a long blend would look like a drift`;
      }

      if (shorter > 0 && seconds > shorter / 2) {
        seconds = Math.max(0.05, Number((shorter / 2).toFixed(2)));
        reason = `capped at half of the shorter animation (${shorter.toFixed(2)}s), which would otherwise be swallowed by the blend`;
      }

      suggestions.push({
        from: from.name,
        to: to.name,
        seconds: Number(seconds.toFixed(2)),
        reason,
      });
    }
  }

  return suggestions;
}

/** Check the exported data against a target's runtime. */
export function checkCompatibility(
  report: SkeletonReport,
  atlas: AtlasReport | null,
  target: RuntimeTarget,
): { runtimeBranch: string | null; blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const version = parseVersion(report.meta.spineVersion);
  const runtimeBranch = runtimeBranchFor(version);

  if (version === null) {
    blockers.push(
      'The skeleton data records no Spine version, so the required runtime version cannot be determined. Re-export from the editor.',
    );
  } else {
    warnings.push(
      `Use the spine-runtimes ${runtimeBranch} branch: data exported from ${report.meta.spineVersion} will be refused by a runtime of a different major.minor.`,
    );
  }

  if (!report.nonessential && target === 'unity') {
    warnings.push(
      'Nonessential data is absent. That is fine for shipping, but the data cannot be imported back into Spine, so keep the .spine project safe.',
    );
  }

  if (atlas) {
    if (atlas.totals.pageCount > 1) {
      warnings.push(
        `The atlas has ${atlas.totals.pageCount} pages. A single page is recommended — it halves texture binds, and spine-unity's SkeletonGraphic (UI) path effectively requires it.`,
      );
    }
    if (atlas.totals.mixedPremultiply) {
      blockers.push(
        'Atlas pages disagree on premultiplied alpha. Re-pack with one setting before integrating; runtimes pick a blend function per page.',
      );
    }
  }

  if (target === 'unity' && atlas?.pages.some((page) => page.pma)) {
    warnings.push(
      'The atlas is premultiplied. That is only correct in Gamma colour space; in Linear, re-pack with Premultiply alpha off and Bleed on (straight alpha works in both).',
    );
  }

  if (report.animations.length === 0) {
    warnings.push(
      'The skeleton has no animations, so there is nothing to drive at runtime yet.',
    );
  }

  return { runtimeBranch, blockers, warnings };
}

/** Inputs for planning. */
export interface ScaffoldInputs {
  target: RuntimeTarget;
  /** Skeleton data file name, e.g. `hero.json` or `hero.skel`. */
  skeletonFileName: string;
  /** Atlas file name, e.g. `hero.atlas`. */
  atlasFileName: string;
  /** Atlas page image names. */
  pageFileNames: string[];
  report: SkeletonReport;
  atlas: AtlasReport | null;
  /** Name used for classes, nodes and variables. */
  name: string;
}

function unityPlacements(inputs: ScaffoldInputs): AssetPlacement[] {
  const placements: AssetPlacement[] = [];
  const isBinary = /\.skel(\.bytes)?$/i.test(inputs.skeletonFileName);

  if (isBinary) {
    placements.push({
      from: inputs.skeletonFileName,
      to: inputs.skeletonFileName.replace(/\.skel(\.bytes)?$/i, '.skel.bytes'),
      reason: /\.skel\.bytes$/i.test(inputs.skeletonFileName)
        ? null
        : 'spine-unity cannot load files with the .skel extension; it must be .skel.bytes',
    });
  } else {
    placements.push({ from: inputs.skeletonFileName, to: inputs.skeletonFileName, reason: null });
  }

  placements.push({
    from: inputs.atlasFileName,
    to: inputs.atlasFileName.replace(/\.atlas(\.txt)?$/i, '.atlas.txt'),
    reason: /\.atlas\.txt$/i.test(inputs.atlasFileName)
      ? null
      : 'Unity only imports known extensions; the atlas must be .atlas.txt',
  });

  for (const page of inputs.pageFileNames) {
    placements.push({ from: page, to: page, reason: null });
  }

  return placements;
}

function godotPlacements(inputs: ScaffoldInputs): AssetPlacement[] {
  const placements: AssetPlacement[] = [];
  const isJson = /\.json$/i.test(inputs.skeletonFileName);

  placements.push({
    from: inputs.skeletonFileName,
    to: isJson
      ? inputs.skeletonFileName.replace(/\.json$/i, '.spine-json')
      : inputs.skeletonFileName,
    reason: isJson
      ? 'spine-godot refuses .json skeletons since 2022, because Godot plugins compete for that extension; it must be .spine-json'
      : null,
  });

  placements.push({ from: inputs.atlasFileName, to: inputs.atlasFileName, reason: null });
  for (const page of inputs.pageFileNames) {
    placements.push({ from: page, to: page, reason: null });
  }

  return placements;
}

function webPlacements(inputs: ScaffoldInputs): AssetPlacement[] {
  return [
    { from: inputs.skeletonFileName, to: inputs.skeletonFileName, reason: null },
    { from: inputs.atlasFileName, to: inputs.atlasFileName, reason: null },
    ...inputs.pageFileNames.map((page) => ({ from: page, to: page, reason: null })),
  ];
}

function identifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  const parts = cleaned.split(/\s+/);
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/^(\d)/, '_$1') || 'Character';
}

function mixLines(
  table: MixSuggestion[],
  render: (entry: MixSuggestion) => string,
): string[] {
  return table.map((entry) => `${render(entry)} // ${entry.reason}`);
}

function unityFiles(inputs: ScaffoldInputs, mixTable: MixSuggestion[]): ScaffoldFile[] {
  const className = `${identifier(inputs.name)}Controller`;
  const first = inputs.report.animations[0]?.name ?? 'animation';

  const mix = mixLines(
    mixTable,
    (entry) =>
      `        data.SetMix("${entry.from}", "${entry.to}", ${entry.seconds}f);`,
  ).join('\n');

  const code = `using Spine.Unity;
using UnityEngine;

/// <summary>
/// Drives a Spine skeleton with AnimationState.
///
/// Attach to the GameObject that the generated _SkeletonData asset created
/// (drag the asset into the scene and choose SkeletonAnimation).
/// </summary>
[RequireComponent(typeof(SkeletonAnimation))]
public class ${className} : MonoBehaviour
{
    [SpineAnimation] public string idleAnimation = "${first}";

    private SkeletonAnimation skeletonAnimation;

    private void Awake()
    {
        skeletonAnimation = GetComponent<SkeletonAnimation>();
        ConfigureMixes();
    }

    private void Start()
    {
        // Track 0 is the base layer; loop the idle there.
        skeletonAnimation.AnimationState.SetAnimation(0, idleAnimation, true);

        // Events fire from the skeleton's own event keys.
        skeletonAnimation.AnimationState.Event += (entry, e) =>
        {
            Debug.Log($"Spine event {e.Data.Name} at {e.Time:F2}s during {entry.Animation.Name}");
        };
    }

    /// <summary>
    /// Mix durations decide how long one animation blends into the next.
    /// These values were derived from the skeleton's animation durations and
    /// which bones each one animates; tune them in play mode.
    /// </summary>
    private void ConfigureMixes()
    {
        var data = skeletonAnimation.AnimationState.Data;
        data.DefaultMix = ${DEFAULT_MIX_SECONDS}f;

${mix || '        // No animation pairs to mix yet.'}
    }

    /// <summary>Queue a one-shot, then return to idle.</summary>
    public void PlayOnce(string animationName)
    {
        var state = skeletonAnimation.AnimationState;
        state.SetAnimation(0, animationName, false);
        state.AddAnimation(0, idleAnimation, true, 0f);
    }
}
`;

  return [{ path: `${className}.cs`, content: code }];
}

function webFiles(inputs: ScaffoldInputs, mixTable: MixSuggestion[]): ScaffoldFile[] {
  const branch =
    runtimeBranchFor(parseVersion(inputs.report.meta.spineVersion)) ?? '4.2';
  const first = inputs.report.animations[0]?.name ?? 'animation';

  const mix = mixLines(
    mixTable,
    (entry) =>
      `  stateData.setMix('${entry.from}', '${entry.to}', ${entry.seconds});`,
  ).join('\n');

  const code = `// Spine playback with spine-ts (WebGL).
//
// Install the runtime that matches the exporting editor:
//   npm install @esotericsoftware/spine-webgl@${branch}
// A runtime of a different major.minor refuses to load this data.
import * as spine from '@esotericsoftware/spine-webgl';

const SKELETON_URL = '/assets/${inputs.skeletonFileName}';
const ATLAS_URL = '/assets/${inputs.atlasFileName}';

/** Mix durations derived from the skeleton's animations. */
function configureMixes(stateData: spine.AnimationStateData): void {
  stateData.defaultMix = ${DEFAULT_MIX_SECONDS};
${mix || '  // No animation pairs to mix yet.'}
}

export class ${identifier(inputs.name)}App {
  private skeleton!: spine.Skeleton;
  private state!: spine.AnimationState;
  private renderer!: spine.SceneRenderer;
  private lastFrame = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async load(): Promise<void> {
    const context = new spine.ManagedWebGLRenderingContext(this.canvas);
    const assets = new spine.AssetManager(context);
    assets.loadTextureAtlas(ATLAS_URL);
    assets.loadText(SKELETON_URL);
    await assets.loadAll();

    const atlas = assets.require(ATLAS_URL) as spine.TextureAtlas;
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const json = new spine.SkeletonJson(loader);
    const data = json.readSkeletonData(assets.require(SKELETON_URL) as string);

    this.skeleton = new spine.Skeleton(data);
    const stateData = new spine.AnimationStateData(data);
    configureMixes(stateData);
    this.state = new spine.AnimationState(stateData);
    this.state.setAnimation(0, '${first}', true);

    this.renderer = new spine.SceneRenderer(this.canvas, context);
  }

  start(): void {
    const frame = (now: number) => {
      const delta = this.lastFrame === 0 ? 0 : (now - this.lastFrame) / 1000;
      this.lastFrame = now;

      this.state.update(delta);
      this.state.apply(this.skeleton);
      this.skeleton.update(delta);
      // Spine 4.2+ requires the physics argument.
      this.skeleton.updateWorldTransform(spine.Physics.update);

      this.renderer.begin();
      this.renderer.drawSkeleton(this.skeleton, ${inputs.atlas?.pages.some((page) => page.pma) ?? true});
      this.renderer.end();

      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
`;

  return [{ path: `${identifier(inputs.name)}App.ts`, content: code }];
}

function godotFiles(inputs: ScaffoldInputs, mixTable: MixSuggestion[]): ScaffoldFile[] {
  const first = inputs.report.animations[0]?.name ?? 'animation';
  const mix = mixLines(
    mixTable,
    (entry) =>
      `\tstate_data.set_mix_by_name("${entry.from}", "${entry.to}", ${entry.seconds})`,
  ).join('\n');

  const code = `extends SpineSprite
# Spine playback with spine-godot.
#
# Attach to a SpineSprite node whose SpineSkeletonDataResource points at the
# imported skeleton and atlas resources.

func _ready() -> void:
	_configure_mixes()
	# Track 0 is the base layer.
	get_animation_state().set_animation("${first}", true, 0)

func _configure_mixes() -> void:
	# Mix durations derived from the skeleton's animations.
	var state_data := get_skeleton_data_res().get_animation_state_data()
	state_data.set_default_mix(${DEFAULT_MIX_SECONDS})
${mix || '\tpass # No animation pairs to mix yet.'}

func play_once(animation_name: String) -> void:
	var state := get_animation_state()
	state.set_animation(animation_name, false, 0)
	state.add_animation("${first}", 0.0, true, 0)
`;

  return [{ path: `${identifier(inputs.name).toLowerCase()}_controller.gd`, content: code }];
}

function unitySteps(inputs: ScaffoldInputs): string[] {
  return [
    'Install spine-unity: add the unitypackage for the matching runtime branch, or the UPM package from the spine-runtimes repository.',
    'Copy the files below into a new empty folder under Assets/ — Unity watches that folder and generates the Spine assets itself.',
    'Unity generates three assets: an _Atlas asset for the .atlas.txt, a _Material per page image, and a _SkeletonData asset for the skeleton data.',
    'Drag the generated _SkeletonData asset into the scene and choose SkeletonAnimation (or SkeletonGraphic for UI).',
    'Add the generated controller script to that GameObject.',
    'If the colours look wrong, check the premultiplied alpha / colour space pairing: straight alpha (Premultiply alpha off, Bleed on) is the safe choice in both Linear and Gamma.',
  ];
}

function webSteps(inputs: ScaffoldInputs): string[] {
  return [
    `Install the runtime: npm install @esotericsoftware/spine-webgl@${runtimeBranchFor(parseVersion(inputs.report.meta.spineVersion)) ?? '4.2'}`,
    'Serve the skeleton, atlas and page images over HTTP from the same folder — the AssetManager resolves the page images relative to the atlas URL.',
    'Add a <canvas> element and construct the generated class with it.',
    'Call load() and then start().',
    'Note that file:// pages cannot fetch these assets; use a dev server.',
  ];
}

function godotSteps(): string[] {
  return [
    'Install spine-godot. Two options exist: the GDExtension, which works with a stock Godot build, or the custom C++ engine module, which needs a Godot editor and export templates built from the spine-godot sources.',
    'Copy the files below into the Godot project, keeping the required renames.',
    'Godot imports the skeleton as a SpineSkeletonFileResource and the atlas as a SpineAtlasResource; combine them in a SpineSkeletonDataResource.',
    'Add a SpineSprite node, assign the SpineSkeletonDataResource, and attach the generated script.',
  ];
}

/** Build the full plan for a target. */
export function planScaffold(inputs: ScaffoldInputs): ScaffoldPlan {
  const compatibility = checkCompatibility(inputs.report, inputs.atlas, inputs.target);
  const mixTable = suggestMixTable(inputs.report);

  const placements =
    inputs.target === 'unity'
      ? unityPlacements(inputs)
      : inputs.target === 'godot'
        ? godotPlacements(inputs)
        : webPlacements(inputs);

  const files =
    inputs.target === 'unity'
      ? unityFiles(inputs, mixTable)
      : inputs.target === 'godot'
        ? godotFiles(inputs, mixTable)
        : webFiles(inputs, mixTable);

  const steps =
    inputs.target === 'unity'
      ? unitySteps(inputs)
      : inputs.target === 'godot'
        ? godotSteps()
        : webSteps(inputs);

  const readme = buildReadme(inputs, {
    ...compatibility,
    placements,
    steps,
    mixTable,
  });

  return {
    target: inputs.target,
    runtimeBranch: compatibility.runtimeBranch,
    blockers: compatibility.blockers,
    warnings: compatibility.warnings,
    placements,
    mixTable,
    defaultMix: DEFAULT_MIX_SECONDS,
    files: [...files, readme],
    steps,
  };
}

function buildReadme(
  inputs: ScaffoldInputs,
  context: {
    runtimeBranch: string | null;
    blockers: string[];
    warnings: string[];
    placements: AssetPlacement[];
    steps: string[];
    mixTable: MixSuggestion[];
  },
): ScaffoldFile {
  const lines: string[] = [
    `# ${inputs.name} — ${inputs.target} integration`,
    '',
    `Exported by Spine ${inputs.report.meta.spineVersion ?? 'unknown'}; needs the spine-runtimes **${context.runtimeBranch ?? 'unknown'}** branch.`,
    '',
  ];

  if (context.blockers.length > 0) {
    lines.push('## Blockers', '');
    for (const blocker of context.blockers) lines.push(`- ${blocker}`);
    lines.push('');
  }

  lines.push('## Files', '');
  lines.push('| Exported | Must be named | Why |');
  lines.push('|---|---|---|');
  for (const placement of context.placements) {
    lines.push(
      `| \`${placement.from}\` | \`${placement.to}\` | ${placement.reason ?? 'no change'} |`,
    );
  }
  lines.push('');

  lines.push('## Steps', '');
  context.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push('');

  if (context.warnings.length > 0) {
    lines.push('## Notes', '');
    for (const warning of context.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## Animations', '');
  if (inputs.report.animations.length === 0) {
    lines.push('This skeleton has no animations yet.');
  } else {
    lines.push('| Animation | Duration | Timelines |');
    lines.push('|---|---|---|');
    for (const animation of inputs.report.animations) {
      lines.push(
        `| ${animation.name} | ${animation.duration.toFixed(2)}s | ${animation.timelineCount} |`,
      );
    }
  }
  lines.push('');

  if (context.mixTable.length > 0) {
    lines.push('## Suggested mixes', '');
    lines.push(
      `Default mix is ${DEFAULT_MIX_SECONDS}s. These suggestions come from animation durations and how many bones each pair shares — treat them as a starting point, not a result.`,
      '',
    );
    lines.push('| From | To | Seconds | Why |');
    lines.push('|---|---|---|---|');
    for (const entry of context.mixTable) {
      lines.push(`| ${entry.from} | ${entry.to} | ${entry.seconds} | ${entry.reason} |`);
    }
    lines.push('');
  }

  return { path: 'README.md', content: `${lines.join('\n')}\n` };
}
