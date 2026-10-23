# Spine 2D Accelerator Power

## Overview

This package automates Spine 2D asset work: skeleton data inspection and linting, texture
packing settings, batch export through the Spine command line interface, PSD-to-rig generation,
headless animation preview, visual regression, and runtime integration for Unity, web and Godot.

### Architecture

- **AI Layer**: understands intent, picks the workflow, chains tool calls
- **spine-mcp = Execution Layer**: the MCP server in this package. It drives the Spine CLI in a
  separate process and operates on exported skeleton/atlas data. It talks stdio only and opens no
  network port.
- **This Package = Intelligence Layer**: POWER.md (this file), steering files and preset templates
  that carry the Spine domain knowledge

### The one architectural fact that shapes everything

**Spine has no in-editor API, and no way to drive an editor window.** Unlike engine-side bridges
that live inside the editor process, Spine's only official automation surface is its command line
interface, which starts a *separate* Spine process, performs export / import / pack / clean-up /
info, and exits.

Two consequences that this Power is built around:

1. **"Add a bone", "open this project", "select that slot" are not possible.** Anything that
   changes a `.spine` project happens through the CLI's whole-file operations, or by generating
   data and importing it.
2. **A running Spine editor blocks the CLI.** Verified on Spine 4.3.26: when an editor window is
   already open, the launcher hands the request to that instance, prints `Started.`, and never
   returns. Every CLI tool here has a timeout and reports this case explicitly. Tell the developer
   to close the Spine editor before running CLI operations.

### Key Principles

1. **Deterministic work belongs in code.** Skeleton JSON and atlas parsing, validation, diffing and
   settings generation are implemented as tested functions, never as "the model edits the JSON".
2. **Capability gate before subprocess.** The Spine trial cannot save, pack, or export. Write tools
   check the installed edition first and refuse with the exact command line they would have run, so
   the work can be repeated verbatim once a license is in place.
3. **Version locking is a first-class concern.** Editor and runtime versions must match, and the
   launcher can silently update itself. Every CLI tool accepts `--update`.
4. **Paths: read anywhere, write only inside the workspace.** Spine projects commonly live outside
   the workspace; generated output does not.
5. **No shell string interpolation.** Arguments go to the process as an array, so paths with spaces
   and quotes need no escaping and cannot inject.

### Core Behaviors

**These behaviors are always active when this Power is loaded.**

#### Language

Respond in the language the developer uses. If they write in Chinese, respond in Traditional
Chinese (繁體中文). Match any other language they use. When no preference is clear, default to
Traditional Chinese. Technical terms may stay in English with an explanation on first use. Code
identifiers always stay in English.

#### Auto-Activation

When the spine-mcp tools are available, this Power is active. Any request involving skeletons,
animations, atlases, `.spine` projects, exported JSON/`.skel` data, or Spine runtime integration
should use these workflows — the developer does not need to say "Spine".

#### Steering-First Approach

Before any multi-step operation, read the relevant steering file:

| Domain | Steering File |
|--------|--------------|
| General Spine concepts, file formats | `spine-general.md` |
| Export, export settings, batch export | `export-automation.md` |
| Texture packing, `pack.json`, atlas problems | `texture-packing.md` |
| Skeleton data inspection and linting | `skeleton-data-lint.md` |
| Editor/runtime version matching, `--update` | `version-compatibility.md` |
| PSD to rig generation | `psd-to-rig.md` |
| Headless preview and visual regression | `visual-regression.md` |
| Unity integration | `runtime-integration-unity.md` |
| Web integration | `runtime-integration-web.md` |
| Godot integration | `runtime-integration-godot.md` |
| CI pipelines and gates | `ci-pipeline.md` |
| Multi-step automation | `workflow-automation.md` |
| Language preference | `language-zh-tw.md` |

#### Safety & Quality Checks

- **Probe first.** Call `spine_env_probe` before any write operation. It reports the edition, the
  capability matrix, the matching runtime branch, and whether the Python sidecar is ready.
- **Close the editor.** Before any CLI call, remind the developer to close Spine if a window is
  open. A `CLI_TIMEOUT` almost always means an editor had the request.
- **`spine_cleanup` rewrites the project.** It requires `confirm: true`, and there is no undo
  outside version control. Prefer `spine_export` with `clean: true`, which cleans the exported data
  and leaves the project untouched.
- **Lint after export.** Run `skeleton_lint` with the atlas after any export. A missing atlas region
  renders as nothing at runtime and is invisible in the exported JSON alone.
- **Check premultiplied alpha against the target.** Mixed PMA across pages, or PMA disagreeing with
  the runtime's colour space, is the most common cause of wrong-looking edges.

#### Baseline: Spine 4.2 data, local editor may differ

This Power targets the **4.2** data baseline, because that is where the runtimes are complete
across platforms. The local editor may be newer; `spine_env_probe` reports both and warns when they
diverge. For exports consumed by 4.2 runtimes, pass `update: "4.2.xx"`.

## Setup

### Prerequisites

1. **Spine editor.** A licensed Spine (Essential or Professional) for anything that writes. The
   trial works for read-only inspection and for everything that operates on exported data.
2. **Node.js 18+** for the MCP server.
3. Optional: **uv** for the PSD generation sidecar; **playwright-core** plus a Chromium build for
   headless preview and visual regression. Everything else works without them.

### Spine Runtimes license

Facts, to be relayed to the developer whenever you write an HTML export or scaffold a runtime
integration — not legal advice:

- A Spine editor license is required at the time the Spine Runtimes are integrated into a product.
  After that, the product may continue to be distributed even if the license later expires.
- Integrating the Runtimes into a development tool, SDK or library free of charge is explicitly
  allowed, but every user of that tool needs their own Spine license.
- A Spine license is needed to distribute any software containing the Spine Runtimes, even when the
  Spine editor itself is not used.
- This package installs `@esotericsoftware/spine-webgl` from npm as an optional dependency and
  vendors no Spine code. The HTML file `preview_export_html` writes embeds that runtime, so
  distributing that file needs the developer's own license.

See https://esotericsoftware.com/spine-purchase.

### Installation

```bash
npm install
npm run build          # compiles src/ to dist/
uv sync --project python   # optional: PSD generation
npx playwright-core install chromium   # optional: headless preview
```

Then point the MCP client at the server (see `mcp.json`):

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["./dist/server.js"],
      "transport": "stdio"
    }
  }
}
```

Optional environment variables:

| Variable | Purpose |
|---|---|
| `SPINE_EXECUTABLE` | Explicit path to the Spine CLI executable. On Windows this must be the `.com` build. |
| `SPINE_USER_DATA` | Explicit Spine user data directory (holds `spine.log`, `version.txt`, `examples/`). |
| `SPINE_WORKSPACE_ROOT` | Overrides the write-confinement root. Defaults to the process working directory. |

> **Security note**: the server speaks stdio and listens on nothing. There is no network surface to
> authenticate. If it is ever changed to an HTTP transport, that decision needs its own review.

### Pre-Tool Hook

`hooks/pre-spine-tool.kiro.hook` fires on prompt submit and reminds the AI to activate this Power
and read the matching steering file before acting. Delete or rename the file to disable it.

## Available MCP Tools

> **Verification status.** Tool names, arguments and result shapes below are implemented and
> covered by tests in this repository. Behaviour verified against a **real Spine 4.3.26 Trial**:
> `--version` output, the editor-handoff hang, and the trial capability locks. Behaviour verified
> against **real headless Chromium**: preview rendering and visual regression. Behaviour verified
> against a **real PSD file**: the generation pipeline. **Not yet verified against a licensed
> editor**: the export / pack / unpack / import / clean-up command lines are assembled and gated
> correctly, but no successful licensed run has been observed — see "Known gaps".

### Group A — CLI orchestration

| Tool | Purpose | Needs a license |
|------|---------|-----------------|
| `spine_env_probe` | Locate the executable; report edition, version, capability matrix, runtime branch, sidecar state | no |
| `spine_project_info` | `-i`: Spine version, skeleton and animation counts for a project, data file, or folder | no |
| `spine_export` | `-e`: export skeleton data, with a settings file or a `json`/`binary`/`json+pack`/`binary+pack` shorthand | **yes** |
| `spine_pack` | `-p`: pack a folder of images into an atlas | **yes** |
| `spine_unpack` | `-c`: write the individual images back out of an atlas | **yes** |
| `spine_import` | `-r`: import JSON/binary/project data into a `.spine` project | **yes** |
| `spine_cleanup` | `-i -m`: animation clean up, saving the project in place. Requires `confirm: true` | **yes** |
| `spine_export_settings_capture` | `--last-export-settings`: write out a project's real export settings, used to calibrate the bundled templates | no |
| `spine_batch` | Chain several commands into one Spine invocation, which avoids paying editor startup per project | depends on contents |

### Group B — data layer (no Spine installation required)

| Tool | Purpose |
|------|---------|
| `skeleton_inspect` | Bones and hierarchy depth, slots and blend modes, skins, attachment types, mesh vertex counts, IK/transform/path/physics constraints, events, every animation with duration and timeline counts, nonessential-data presence; optional atlas cross-check |
| `atlas_inspect` | Pages (size, format, filters, pma), region counts, rotated and whitespace-stripped regions, packing efficiency, duplicate names, non power-of-two pages. Handles both the 4.0+ `bounds`/`offsets` format and the legacy `xy`/`size`/`orig`/`offset` format |
| `skeleton_diff` | Semantic diff of two exports: bones added/removed/reparented, slots rebound or reordered, attachments retargeted, constraints, events, animation duration and timeline changes. Distinguishes "the hash changed" from "the data changed" |
| `skeleton_lint` | Structural invariants, naming conventions, complexity budgets, export settings and atlas problems, each with a severity and a fix. Fails as `GATE_FAILED` for CI |
| `export_settings_build` | Build an export settings JSON by diffing a known-good template. Refuses override keys the template lacks |
| `pack_settings_build` | Build a `pack.json` with every documented field validated by type, range and enum |
| `skeleton_document` | Write `<basename>.spine-doc.md` and `.spine-doc.json` describing what a rig *does*: bone hierarchy with setup-pose and derived world transforms, IK/transform/path/physics constraints resolved per bone from the data, per-bone influence measured by perturbing one bone and re-rendering, and a motion profile per animation. Records both `skeleton.hash` and its own fingerprint, because the hash alone does not detect change. Degrades to three sections without Chromium. *Registered with the Group D verification tools because it shares their headless harness.* |

### Group C — generation

| Tool | Purpose |
|------|---------|
| `psd_to_skeleton` | Layered PSD to skeleton JSON + atlas + page image, plus an `images/` folder of loose per-attachment PNGs next to the JSON, then inspect and lint the result. In that folder it manages only the PNGs it owns — anything else there is reported, never deleted. Runs through the Python sidecar. Works on a trial license; `spine_import` afterwards does not |
| `skeleton_animate` | Generate `idle`, `walk`, `wave`, `jump` and `turn_head` animations into an exported rig and write the result as a second JSON file. Each template declares the bones it needs: a required bone missing means `VALIDATION_FAILED` naming the rig's actual bones and nothing written, because a substituted bone produces motion that looks like success; a missing optional bone drops only its own timelines and is reported. Existing animations survive and `skeleton.hash` is recomputed, with the algorithm named in the file. Pure data work — no editor, no license, no Python. Needs no Spine installation and no Python sidecar. This is mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it. |

### Group D — verification

| Tool | Purpose |
|------|---------|
| `render_preview` | Render chosen moments of an animation with spine-ts in headless Chromium and write PNGs. Fixed-step time advance and a single camera framing make the output reproducible |
| `visual_regression` | Compare a fresh render against baseline PNGs, write diff images, fail as `GATE_FAILED`. Baselines are bound to the skeleton hash |
| `preview_export_html` | Write ONE self-contained HTML file that plays the skeleton in any browser — play/pause, timeline scrub, animation selector, speed, debug bones. The runtime, the skeleton, the atlas and every page image are embedded as data URLs, so there is no server and nothing is fetched. Needs no browser to produce. Distributing the file requires your own Spine license |

### Group E — integration

| Tool | Purpose |
|------|---------|
| `runtime_scaffold` | Per-target integration: required file names, a controller script with a mix table derived from the skeleton, and a README. Targets `unity`, `web`, `godot` |

### Result shape

Every tool answers with a short human-readable summary plus a JSON block. Failures carry a stable
code, a message, and a `hint` that says what to do next:

```
SPINE_NOT_FOUND · CAPABILITY_DENIED · PATH_NOT_ALLOWED · INPUT_MISSING
CLI_FAILED · CLI_TIMEOUT · PARSE_FAILED · VALIDATION_FAILED
GATE_FAILED · DEPENDENCY_MISSING · INVALID_ARGUMENT
```

## Workflow Guides

### Workflow 1: Animator assistant — inspect and audit an export

**"What's in this skeleton?" / "Is this export healthy?"**

1. `skeleton_inspect` with both `input` and `atlas`. The cross-check is the point: a region the
   skeleton needs but the atlas lacks renders as nothing at runtime.
2. `skeleton_lint` with the same pair, plus `rules` if the team has its own files under
   `templates/lint-rules/`.
3. Report findings grouped by severity, with the fix each one carries.
4. If anything is wrong in the data rather than the export settings, the fix belongs in the editor —
   say so rather than editing the JSON.

**Error handling**: a `PARSE_FAILED` on skeleton data usually means the export used the
"JavaScript" or "Minimal" format, which omit quotes. Re-export as plain JSON.

### Workflow 2: Asset pipeline — batch export

**"Export every project in art/ for Unity."**

1. `spine_env_probe`. A trial stops here with `CAPABILITY_DENIED`; report the blocked operations.
2. `export_settings_build` with the `unity-binary` template, overriding `output`.
3. `pack_settings_build` with the `unity-default` template (`.atlas.txt`, straight alpha).
4. `spine_batch` with one `export` command per project, `update: "4.2.xx"` to pin the editor.
5. `skeleton_lint` each exported pair.
6. Report: projects exported, artifacts written, lint findings.

**The trap**: `-e json+pack` / `binary+pack` use Spine's *default* settings and ignore `pack.json`
files entirely. Pass a settings file, or pack separately with `spine_pack`.

### Workflow 3: PSD to rig

**"Turn this PSD into a Spine rig."**

1. `spine_env_probe` and confirm `sidecar.available`.
2. `psd_to_skeleton` with the PSD and an output folder.
3. Read back `virtualBones` (bones created because no layer provided them) and `unmappedLayers`
   (layers whose names matched no body part) and relay both — those are the two things the artist
   can act on.
4. Check `imagesDir` and `imagePaths` before telling anyone to open the editor. The editor's
   `File -> Import Data` resolves every attachment as `<skeleton.images>/<attachmentName>.png`
   relative to the imported JSON — it does **not** read the `.atlas` at all, so without that
   `images/` folder the import succeeds and the canvas looks empty. `emitLooseImages` defaults to
   true, so the folder is written unless it was explicitly turned off. The tool only manages the
   PNGs it owns there: its own leftovers from an earlier run — files named after a known body part
   that this rig no longer has — are pruned and reported in `staleImagesRemoved`, while any other
   PNG in that folder is reported in `foreignImagesKept` and **left untouched**. Relay that second
   list: the editor resolves attachments by file name, so a file nobody expected can still be
   picked up. The runtime and `render_preview` are the other half of the split: they read the atlas
   and ignore these files.
5. `spine_import` to turn the data into a `.spine` project (needs a license).
6. Tell the developer what the generator does *not* do: no meshes, no weights, no animation beyond
   an empty setup animation. Those belong in the editor.

### Workflow 4: Visual regression

**"Did this re-export change how it looks?"**

1. `skeleton_diff` first. A semantic diff explains *what* changed; pixels only show *that*
   something changed.
2. `visual_regression` with a stable `times` list and a per-animation `baselineDir`.
3. On `GATE_FAILED`, report the failing frames and the diff images.
4. When the skeleton hash changed, the tool says so instead of reporting pixel noise: review the
   semantic diff, then re-run with `mode: "update"` to rebuild the baseline.

Role split: Spine's own image/video export is the authoritative visual output, and it needs a
windowing system plus OpenGL. The headless renderer here is the automation path.

**Show it to a client**: when someone wants to *see* the animation rather than gate it, use
`preview_export_html` instead of sending PNGs. It writes one HTML file with everything embedded —
no server, no install, nothing fetched — so it survives being emailed or dropped on a shared drive.
It needs no browser to produce, so it also works where Chromium is absent. Say the licence fact
when you hand the file over: it embeds the Spine Runtimes, and distributing it requires your own
Spine license (https://esotericsoftware.com/spine-purchase).

### Workflow 5: Runtime integration

**"Get this into my Unity project."**

1. `runtime_scaffold` with `target: "unity"`, the skeleton and the atlas.
2. Apply the renames it reports. They are not cosmetic: spine-unity cannot load a plain `.atlas` or
   `.skel`.
3. Copy the files into a new empty folder under `Assets/`; Unity generates the `_Atlas`,
   `_Material` and `_SkeletonData` assets.
4. Add the generated controller to the GameObject created from `_SkeletonData`.
5. Scene assembly beyond that point belongs to a Unity-side tool.

### Workflow 6: CI

See `steering/ci-pipeline.md` and `templates/ci/`. The shape is: pin the editor with `--update`,
batch export, lint as a gate, visual regression as a gate. Image and video export need a windowing
system and OpenGL, so CI should export data and pack atlases only.

### Workflow 7: Understand and animate an unfamiliar rig

**"Someone handed me this rig. What does it do, and can I see it move?"**

1. `skeleton_inspect` first, for the cheap structural answer: bone count, depth, slots, skins,
   constraints, animations.
2. `skeleton_document` with `probeMode: "off"` for speed. That writes
   `<basename>.spine-doc.md` and `<basename>.spine-doc.json` with three of the four sections —
   hierarchy with derived world transforms, constraints resolved per bone from the data, and a
   motion profile per animation — and launches no browser at all.
3. `skeleton_document` again with `probeMode: "rotate"` when the influence question actually comes
   up ("which images does this bone move?"). That one perturbs a single bone and re-renders, so it
   costs `1 + bones × axes` renders and needs Chromium. Without Chromium it still writes both
   files and says which section is missing and why.
4. `skeleton_animate` when the rig has no animations to look at, or none that answer the question.
   Pick a template whose required bones the rig has; a template that does not fit fails with
   `VALIDATION_FAILED` naming the missing bones rather than substituting one.
5. `skeleton_diff` from the input to the `<basename>-animated.json` output, to state exactly what
   was added.
6. `render_preview` on the output, sampling several times across the animation, to see it move.

**Relay the caveat every time you offer `skeleton_animate`:** what it writes is mechanically
plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no
secondary motion, no weight shift, no foot locking. Say so before the developer opens it, not
after. It is a starting point to refine in the Spine editor, not a deliverable.

## Demo

`npm run demo` runs a scripted, self-narrating path through ten steps against the real server:
environment probe, PSD to rig, inspect and lint, semantic diff of an animator's change, headless
render, visual baseline, a deliberately broken atlas caught with a diff image, Unity scaffold,
the licensing refusal, and a standalone interactive HTML page at `demo/out/preview/hero.html` that
a client can open with no server and no install. It works on a trial license and writes only into
`demo/out/`.

When a developer asks for a demonstration, run that rather than improvising: it is reproducible,
and `demo/README.md` carries the narration for each step in five languages.

## Templates

| Folder | Contents |
|--------|----------|
| `templates/export-settings/` | `unity-binary`, `web-json`, `ci-batch`, plus a README about provenance and calibration |
| `templates/pack-settings/` | `unity-default` (`.atlas.txt`, straight alpha), `web-pot` (power-of-two, polygon packing, multi-scale), `pixelart` (nearest filtering, no stripping or rotation) |
| `templates/lint-rules/` | `naming.json`, `budgets.json` — the editable copies of the built-in defaults |
| `templates/ci/` | GitHub Actions workflow and a PowerShell script |

## Known gaps

Stated plainly so they are not mistaken for working features:

- **No licensed-editor verification.** Export, pack, unpack, import and clean-up are implemented,
  gated and unit-tested, but have not been observed succeeding against a licensed Spine.
- **Export settings field names are not publicly documented.** The bundled templates are shaped
  from the documented export dialog. Calibrate them with `spine_export_settings_capture` before
  trusting them in CI. `pack.json` has no such problem: its schema is documented and fully
  validated here.
- **Binary `.skel` is not parsed.** The data-layer tools read JSON exports. Binary is the right
  shipping format, so inspect the JSON export of the same project, or re-export as JSON for audits.
- **No mesh or weight generation.** The PSD pipeline produces region attachments only.
- **Godot support is planning-level.** The scaffold encodes the file-naming rules and the two
  integration paths; it has not been run against a Godot project.
- **Measured influence is comparable, its last digits are not.** `skeleton_document`'s influence
  buckets (`none`, `slight`, `moderate`, `strong`) are stable across machines, but the fourth
  decimal of a changed-pixel fraction is not: it depends on the GPU, the driver and the Chromium
  build. Compare buckets and relative ordering across machines, not raw fractions. The derived
  world transforms in the hierarchy section are an affine approximation that omits shear
  composition and reflection, so they locate a bone rather than reproduce the runtime exactly.
- **Influence is credited by bounding box, so overlap is credited too.** A changed pixel goes to
  every slot whose axis-aligned bounding box contains it, and a box is larger than the attachment
  it bounds, more so for a rotated one. A slot that did not itself move is therefore credited when
  its box overlaps one that did. The document marks those entries `[overlap]` (`overlapOnly` in
  the JSON) by resolving the hierarchy and the constraints from the data: the perturbed bone is not
  in that slot's bone subtree and no constraint links the two. Read an unmarked slot as moved and a
  marked one as overlap.
- **Generated animations carry no mesh deformation.** `skeleton_animate` writes bone timelines
  only. A weighted mesh still animates correctly, because it follows the bones it is bound to, but
  no `deform` timeline is ever generated, so nothing reshapes a mesh independently of its bones.
  The result is mechanically plausible placeholder motion to refine in the editor.
