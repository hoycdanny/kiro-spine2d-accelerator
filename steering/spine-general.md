# Spine General Steering
<!-- File Purpose / 本檔案用途: Spine 2D core concepts, file formats and the automation boundary / Spine 2D 的核心概念、檔案格式與自動化邊界，是其他 steering 的共同基礎。 -->

> **Context**: This steering file is for AI assistants helping developers with Spine 2D work. It
> uses "the developer" for the human being assisted, and "the artist" when the task belongs to
> whoever rigs and animates in the editor.

## Role and Purpose

Spine is two halves that are easy to confuse. The **editor** is a desktop application where an
artist rigs and animates; the **runtimes** (spine-unity, spine-ts, spine-c++, spine-godot and
others) play the exported data back in an engine. Automation lives entirely on the boundary between
them: the editor exports data, and everything downstream consumes it.

Read this file before answering anything about what is or is not possible.

## The automation boundary

Spine exposes **no in-editor API and no scripting layer**. Its only official automation surface is
the command line interface, and a CLI invocation starts a separate Spine process that performs
whole-file operations and exits.

Practical consequences:

| The developer asks for | What is actually possible |
|---|---|
| "Add a bone / rename a slot / move a keyframe" | Not possible. Generate data and import it, or do it in the editor. |
| "Open this project and show me the animation" | Not possible. Inspect the exported data, or render it headlessly. |
| "Export all my projects" | Yes — `spine_batch` with one export command per project. |
| "Tell me what changed in this export" | Yes — `skeleton_diff` on two exported files. |
| "Build a rig from this PSD" | Yes — `psd_to_skeleton`, bypassing the editor entirely. |

**Verified behaviour worth repeating to the developer**: when a Spine editor window is open, the
CLI launcher hands the request to that instance, prints `Started.`, and never returns. Close the
editor before CLI work. A `CLI_TIMEOUT` is almost always this.

## File formats

| File | What it is | Can tooling read it? |
|---|---|---|
| `.spine` | The project: bones, skins, meshes, weights, animations | **No.** Compressed binary, undocumented format. Only the CLI touches it. |
| `.json` | Exported skeleton data | Yes. Documented format; `skeleton_inspect` parses it. |
| `.skel` | Exported skeleton data, binary | Documented, but not parsed by this Power. Smaller and much faster to load at runtime. |
| `.atlas` | Texture atlas region data | Yes. Line-based text; `atlas_inspect` parses both the 4.0+ and legacy forms. |
| `.png` | Atlas page images | Yes, as bytes. Used by the headless renderer. |
| `*.export.json` | Export settings for `-e` | Written by the editor's Save button or `--last-export-settings`. Field names are not publicly documented. |
| `pack.json` | Texture packer settings | Fully documented schema; generated and validated by `pack_settings_build`. |

**Keep the `.spine` project safe.** It is the only lossless source. An export without nonessential
data cannot be imported back without losing information, and the project cannot be reconstructed
from a shipped build.

## Trial vs licensed

The trial is fully featured **except** saving projects, texture packing, and exporting data, images
or video. That removes every CLI command that writes, leaving `-i` (project info) and `--version`.

What still works on a trial:

- Everything in the data layer: inspect, lint, diff, settings generation
- PSD to skeleton generation (it never runs the editor)
- Headless preview and visual regression (they read exported data)

What does not:

- `spine_export`, `spine_pack`, `spine_unpack`, `spine_import`, `spine_cleanup`

Report this as a licensing fact, not a bug, and include the command line the operation would have
run so it can be repeated after purchase.

## Vocabulary the developer will use

- **Bone**: the transform hierarchy. Exactly one root. Parents are always exported before children.
- **Slot**: a draw-order position bound to a bone. Slot order *is* draw order: higher index draws
  on top.
- **Attachment**: what a slot shows — `region` (a rectangle), `mesh` (deformable, possibly weighted
  to several bones), `linkedmesh`, `boundingbox`, `path`, `point`, `clipping`.
- **Skin**: a set of attachments per slot. The `default` skin holds everything not in a named skin.
  Looking up an attachment checks the active skin, then the default skin.
- **Constraint**: IK, transform, path, and (4.2+) physics.
- **Event**: a named marker an animation fires, which game code listens for.
- **Mix**: the blend duration between two animations, configured per pair at runtime.

## Defaults for omitted fields

The exported format omits anything at its default, so a reader must know them. The data layer
applies these:

`length` 0 · `scaleX`/`scaleY` 1 · `rotation`/`shearX`/`shearY` 0 · `transform` `normal` ·
`fps` 30 · slot `color` `FFFFFFFF` · attachment `type` `region` · IK `mix` 1 ·
`bendPositive` true · path `positionMode` `percent` · `spacingMode` `length` ·
`rotateMode` `tangent`

A mesh is **weighted** when its `vertices` array is longer than its `uvs` array, because weighted
vertices carry bone indices and weights instead of a bare x,y pair.

## Version-specific field names

Spine renamed timeline fields between versions (`angle` to `value`, `rotateMix` to `mixRotate`,
`twoColor` to `rgba2`), and 4.2 added physics constraints. The inspector therefore walks the
timeline tree **structurally** — counting keyframe arrays and reading `time` fields — rather than
matching version-specific key names. When extending it, keep that property: it is what makes a
3.8 export and a 4.2 export both measurable.

## Where to go next

| Task | Steering file |
|---|---|
| Exporting | `export-automation.md` |
| Atlases | `texture-packing.md` |
| Auditing data | `skeleton-data-lint.md` |
| Version mismatches | `version-compatibility.md` |
| PSD generation | `psd-to-rig.md` |
| Previews and regression | `visual-regression.md` |
| Engine integration | `runtime-integration-unity.md`, `runtime-integration-web.md`, `runtime-integration-godot.md` |
| Pipelines | `ci-pipeline.md`, `workflow-automation.md` |
