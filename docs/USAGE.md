# Using the Spine 2D Power

> **This guide is English only.** The five READMEs are maintained in parallel in five languages;
> this guide is not. It is a long file of worked examples, flag tables and error strings, and
> a half-translated copy of that would be worse than an honest single-language one. Everything here
> is additional detail: the setup, the tool list and the honest limits are in the READMEs, in every
> language.

Setup is not repeated here. Install, build and wire the server up with
[`README.md`](../README.md) first — Node 18 or newer, `npm install`, `npm run build`, and the
`mcp.json` shape it shows. Come back when `node dist/ci-cli.js help` prints something.

Every command below was run from the repository root on Windows, against the git-ignored
`demo/out/` workspace that `node demo/run-demo.js` creates. Every block of output is real output
from this repository, copied from the run. Where something could not be run here, it says so in
the line above it.

**Contents**

- [A. The three ways to drive it](#a-the-three-ways-to-drive-it)
  - [A1. Natural language, through Kiro or any MCP client](#a1-natural-language-through-kiro-or-any-mcp-client)
  - [A2. The bundled CI command line](#a2-the-bundled-ci-command-line)
  - [A3. Direct MCP `tools/call`, for scripting](#a3-direct-mcp-toolscall-for-scripting)
- [B. Four walk-throughs, end to end](#b-four-walk-throughs-end-to-end)
  - [B1. An animator hands you a PSD](#b1-an-animator-hands-you-a-psd)
  - [B2. Reviewing a rig you did not build](#b2-reviewing-a-rig-you-did-not-build)
  - [B3. Gating assets in CI](#b3-gating-assets-in-ci)
  - [B4. Handing assets to engineering](#b4-handing-assets-to-engineering)
- [C. The arguments that matter](#c-the-arguments-that-matter)
- [D. Troubleshooting](#d-troubleshooting)
- [What is not verified here](#what-is-not-verified-here)

---

## A. The three ways to drive it

The same 22 tools are reachable three ways. Pick by who is asking: a person in a chat window, a CI
runner, or a script.

| Way | Use it when | Needs |
|---|---|---|
| Natural language through an MCP client | You are working interactively and want the AI to pick the tool and read the result back | Kiro, or any MCP client, pointed at `dist/server.js` |
| `node dist/ci-cli.js` | A pipeline needs a pass/fail exit code and no AI in the loop | Node and a build |
| Direct `tools/call` over stdio | You are scripting a batch, or wiring this into something else | Node, a build, and `@modelcontextprotocol/sdk` |

### A1. Natural language, through Kiro or any MCP client

There is no command to learn. Say what you want; the AI picks the tool, fills the arguments and
reads the summary back. The summaries below are the first lines the tools actually printed during
`node demo/run-demo.js` and the scripted calls in [A3](#a3-direct-mcp-toolscall-for-scripting) —
they are what you will see quoted back at you.

**"Turn `hero.psd` into a Spine rig I can open in the editor."**

Runs `psd_to_skeleton`:

```
Generated a 20-bone rig with 16 attachment(s) from ...\demo\out\hero.psd.
Skeleton: ...\demo\out\generated\hero.json
Atlas: ...\demo\out\generated\hero.atlas (...\demo\out\generated\hero.png)
Images: ...\demo\out\generated\images — 16 loose PNG(s) named after the attachments, which is what the Spine editor's File -> Import Data resolves against.
Virtual bones created because no layer provided them: root, neck, shoulder_left, shoulder_right. They are positioned from the parts that do exist.
Layers that matched no known body part and were skipped: cape. Rename them to a recognised part, or add them in the editor.
```

Two of those lines are the whole value of asking. The `images/` folder is what makes editor import
work, and `cape` is a layer the tool refused to guess at — see
[B1](#b1-an-animator-hands-you-a-psd).

**"Is this export correct, and does the atlas cover it?"**

Runs `skeleton_inspect` with the atlas, then `skeleton_lint`:

```
Exported by Spine 4.2.37: 20 bones (depth 8), 16 slots, 1 skin(s), 16 attachments, 1 animation(s).
Animations: setup (0.00s).
Nonessential data present (skeleton.fps, skeleton.images), so this file can be imported back into Spine.
Atlas cross-check passed: every region the skeleton needs exists in ...\demo\out\generated\hero.atlas.
```

```
0 error(s), 1 warning(s), 0 info — gate passed (failOn: error).
WARNING:
  animation/empty [setup]: Animation "setup" has no timelines.
    fix: Delete it, or confirm it exists on purpose as an empty animation used to clear a track.
Atlas checked: ...\demo\out\generated\hero.atlas
```

**"Give me something to look at so I can review the rig."**

Runs `skeleton_animate`:

```
Wrote 3 template-generated animation(s) to ...\demo\out\generated\hero-templates.json.
  idle (2.00s, intended to loop) on hip, torso, chest, head, arm_left and 1 more.
  wave (1.00s, one-shot) on head, arm_left, arm_right, forearm_right, hand_right.
  walk (1.00s, intended to loop) on hip, torso, arm_left, arm_right, thigh_left and 3 more.
Existing animations preserved: setup.
skeleton.hash recomputed: 7c7d0e3f3b9e4bd525d792 -> 6fff8f55128be7e90cbe8b (algorithm kiro-spine2d/canonical-sha1-22, not the editor's).
This is mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it.
Lint added no new errors (0 new, 1 warning(s)) with the generator's naming rules disabled.
```

That honesty line is not decoration. It is one constant in
[`src/animation-templates.ts`](../src/animation-templates.ts), reused in the tool description, the
tool summary and the `_generator` record of the file it writes, so the claim cannot drift from the
code.

**"Send the client one file they can open."**

Runs `preview_export_html`:

```
Wrote ...\demo\out\preview\hero.html (299 KB).
It opens in any browser by double-clicking it: no server, no install, and nothing is fetched — the runtime, the skeleton, the atlas and every page image are embedded in the file.
Controls: play/pause, a timeline scrub, an animation selector (idle, setup, wave), speed and a debug-bones toggle.
Opens on wave at 480x480, premultiplied alpha false.
This file embeds the Spine Runtimes. Distributing it — to a client, a server or anyone else — requires your own Spine license: https://esotericsoftware.com/spine-purchase
```

### A2. The bundled CI command line

A pipeline has no AI in it, so the same gates are exposed as subcommands with exit codes.
`node dist/ci-cli.js help` prints this, and it is the authoritative flag list — it is the `USAGE`
constant in [`src/ci-cli.ts`](../src/ci-cli.ts):

```
spine-ci — Spine asset gates for CI

Usage:
  node dist/ci-cli.js lint        --export-dir <dir> [--rules <file>]... [--fail-on error|warning|info]
  node dist/ci-cli.js regression  --export-dir <dir> --baseline-dir <dir> [--diff-dir <dir>] [--mode check|update]
  node dist/ci-cli.js export      --projects-dir <dir> --out-dir <dir> [--settings <file>] [--update <version>]
  node dist/ci-cli.js diff        --from <file> --to <file>

Notes:
  * export needs a licensed Spine editor, and no Spine editor window open.
  * regression needs playwright-core and a Chromium build.
  * Exit codes: 0 pass, 1 gate failed, 2 usage or operational error.
```

Verified: `node dist/ci-cli.js help` exits **0** and prints exactly the block above.

**Exit codes: 0 pass, 1 gate failed, 2 usage or operational error.** The distinction matters to a
pipeline. `1` means the gate did its job and the assets are wrong. `2` means the gate never ran —
bad flags, a missing directory, an unreadable file — and a pipeline that treats the two the same
will one day ship a broken asset because a path was mistyped.

The two prerequisites in the `Notes:` block are the CLI's own words, and both are real:

- **`export` needs a licensed Spine editor, and no Spine editor window open.** The licence half is
  enforced before anything is spawned (see [D](#d-troubleshooting), `CAPABILITY_DENIED`). The
  window half is the hang described in [D](#d-troubleshooting), `CLI_TIMEOUT`.
- **`regression` needs playwright-core and a Chromium build.** `npx playwright-core install chromium`.
  Nothing else in the CLI needs a browser.

Three real runs, in the order they were made:

```
> node dist/ci-cli.js diff
Usage: diff --from <baseline.json> --to <new.json>
> echo $LASTEXITCODE
2
```

A subcommand that cannot run is a `2`, not a `1`: `diff` with no flags never compared anything.

```
> node dist/ci-cli.js lint --export-dir nope
No exported skeleton JSON found under nope. Nothing to lint.
> echo $LASTEXITCODE
2
```

"Nothing to lint" is deliberately an error, not a pass. A lint gate that finds no files and exits
`0` is the most expensive green tick in a pipeline.

```
> node dist/ci-cli.js lint --export-dir demo/out/generated --fail-on error
PASS lint demo\out\generated\hero-animated.json
    0 error(s), 1 warning(s), 0 info — gate passed (failOn: error).
    WARNING:
      animation/empty [setup]: Animation "setup" has no timelines.
        fix: Delete it, or confirm it exists on purpose as an empty animation used to clear a track.
    Atlas rules were skipped: pass `atlas` to check region coverage, premultiplied alpha and packing efficiency.

    note: no atlas found beside hero-animated; atlas rules were skipped

PASS lint demo\out\generated\hero.json
    0 error(s), 1 warning(s), 0 info — gate passed (failOn: error).
    WARNING:
      animation/empty [setup]: Animation "setup" has no timelines.
        fix: Delete it, or confirm it exists on purpose as an empty animation used to clear a track.
    Atlas checked: ...\demo\out\generated\hero.atlas

> echo $LASTEXITCODE
0
```

`lint` walks `--export-dir` recursively, pairs each `.json` with an atlas of the same stem beside
it, and accepts both `.atlas` and `.atlas.txt` — the second because a Unity-targeted export writes
that name. A skeleton with no atlas next to it is still linted, with the atlas rules skipped and a
`note:` line saying so. That note is worth reading in CI output: half a lint is easy to mistake for
a whole one.

`--rules` is repeatable and overlays the defaults in order. With the two shipped rule files, on the
same demo workspace:

```
> node dist/ci-cli.js lint --export-dir demo/out/generated --rules templates/lint-rules/naming.json --rules templates/lint-rules/budgets.json --fail-on error
PASS lint demo\out\generated\hero-animated.json
    0 error(s), 1 warning(s), 0 info — gate passed (failOn: error).
    WARNING:
      animation/empty [setup]: Animation "setup" has no timelines.
        fix: Delete it, or confirm it exists on purpose as an empty animation used to clear a track.
    Atlas rules were skipped: pass `atlas` to check region coverage, premultiplied alpha and packing efficiency.

    note: no atlas found beside hero-animated; atlas rules were skipped

PASS lint demo\out\generated\hero.json
    0 error(s), 1 warning(s), 0 info — gate passed (failOn: error).
    WARNING:
      animation/empty [setup]: Animation "setup" has no timelines.
        fix: Delete it, or confirm it exists on purpose as an empty animation used to clear a track.
    Atlas checked: ...\demo\out\generated\hero.atlas

> echo $LASTEXITCODE
0
```

The two shipped files are editable copies of the built-in defaults, so overlaying them changes
nothing by itself — that is the point of starting from them. Edit a pattern or a budget and the
overlaid value is what the gate enforces.

One family of files is never linted even though it sits in the export directory:
`skeleton_document` writes `<stem>.spine-doc.json` and `<stem>.spine-doc.md` beside the skeleton it
documents, and `findExportPairs` skips the `.json` the same way it skips `*.export.json`,
`*.pack.json` and `baseline.json`. None of them is exported skeleton data. A genuinely malformed
export still fails loudly.

The `export` subcommand is **UNVERIFIED here**: it needs a licensed Spine editor and this machine
has a trial, so it was not run. Its flags above come from the `USAGE` constant and its behaviour
from [`src/ci-cli.ts`](../src/ci-cli.ts) — it collects every `.spine` file under `--projects-dir`
and sends them to the editor in **one** invocation, because each invocation starts a whole editor
process.

### A3. Direct MCP `tools/call`, for scripting

For a batch job, talk to the server the way a client does. This is the complete script; save it in
the repository root as `spine-inspect.mjs` and run `node spine-inspect.mjs`.

```js
// Drive the Power from a script. Save in the repository root, then:
//   node spine-inspect.mjs
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Every write the server performs is confined to this root.
const SPINE_WORKSPACE_ROOT = resolve('demo', 'out');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist', 'server.js')],
  env: { ...process.env, SPINE_WORKSPACE_ROOT },
});

const client = new Client({ name: 'spine-script', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tools exposed by the server.`);

// Paths in tool arguments are relative to SPINE_WORKSPACE_ROOT.
const result = await client.callTool({
  name: 'skeleton_inspect',
  arguments: { input: 'generated/hero.json', atlas: 'generated/hero.atlas' },
});

console.log(result.isError ? 'refused' : 'ok');
console.log(result.content[0].text);

await client.close();
```

Verified: `node spine-inspect.mjs` exits **0** and prints

```
22 tools exposed by the server.
ok
Exported by Spine 4.2.37: 20 bones (depth 8), 16 slots, 1 skin(s), 16 attachments, 1 animation(s).
Animations: setup (0.00s).
Nonessential data present (skeleton.fps, skeleton.images), so this file can be imported back into Spine.
Atlas cross-check passed: every region the skeleton needs exists in ...\demo\out\generated\hero.atlas.
```

Four things in that script are not incidental.

- **`env: { ...process.env, SPINE_WORKSPACE_ROOT }`.** Every write every tool performs is confined
  to that root; a path argument that escapes it is refused with `PATH_NOT_ALLOWED` before anything
  is written. Inherit the rest of `process.env` or the child loses `PATH`, and on Windows it then
  cannot find `uv` for the PSD sidecar.
- **Relative paths.** Tool arguments resolve against `SPINE_WORKSPACE_ROOT`, so `generated/hero.json`
  is `demo/out/generated/hero.json`. Absolute paths work too, as long as they are inside the root
  for writes; a skeleton being *read* may live anywhere.
- **`result.isError`.** A tool that refuses comes back as a normal response with `isError` set, not
  as a thrown exception. Check it. The first text block carries the code, the message and the hint.
- **`result.content[0].text`.** The human-readable summary. The machine-readable payload is in
  `result.structuredContent`, which is where you read frame counts, finding lists and file paths
  from rather than parsing the summary.

[`demo/run-demo.js`](../demo/run-demo.js) is a longer worked example of the same pattern — ten
steps, with the expected outcome of each one declared up front.

---

## B. Four walk-throughs, end to end

### B1. An animator hands you a PSD

The goal is a skeleton the animator can open in Spine, built from the layer names they already use.
No Spine licence is involved: `psd_to_skeleton` never launches Spine.

**Step 1 — name the layers.** The layer name is the only instruction the tool takes. Recognised
part names are `head`, `torso`, `chest`, `neck`, `hip`, `shoulder_left`, `arm_left`,
`forearm_left`, `hand_left`, `thigh_left`, `shin_left`, `foot_left` and their right-side
counterparts. Aliases are accepted: `body` and `belly` for `torso`; `pelvis`, `hips` and `waist`
for `hip`; `face` and `skull` for `head`; `upper_arm_left` for `arm_left`; `lower_leg_right` and
`calf_right` for `shin_right`; `leg_left` for `thigh_left`. Side markers work leading or trailing
in several spellings — `arm_l`, `arm-R`, `l_arm`, `left arm`, `hand lt` all resolve — and case,
spaces, hyphens, dots and slashes are normalised. The full list is in
[`steering/psd-to-rig.md`](../steering/psd-to-rig.md).

Hidden layers are skipped on purpose: hiding a layer is an instruction. Group layers are walked
through, but a group is not itself a part.

A layer named **`<part>[pivot]`** places that bone's origin explicitly: the small layer's centre
becomes the bone origin. Use it when the silhouette does not put the joint on an edge — otherwise
each part pivots at the edge where its joint is (a thigh at its top, a torso at its bottom), which
is what stops a limb bending in the middle of the image.

**Step 2 — run it.** Against the demo's own PSD, which `demo/make-sample-psd.py` draws
procedurally:

```json
{
  "psd": "hero.psd",
  "outDir": "generated",
  "name": "hero"
}
```

```
Generated a 20-bone rig with 16 attachment(s) from ...\demo\out\hero.psd.
Skeleton: ...\demo\out\generated\hero.json
Atlas: ...\demo\out\generated\hero.atlas (...\demo\out\generated\hero.png)
Images: ...\demo\out\generated\images — 16 loose PNG(s) named after the attachments, which is what the Spine editor's File -> Import Data resolves against.
PNGs this tool does not own, left in place: cape.png. Only images named after a known body part are pruned, so these were not touched — but the Spine editor resolves attachments by file name against this folder, so check whether they belong to this skeleton and delete them yourself if they do not.
Virtual bones created because no layer provided them: root, neck, shoulder_left, shoulder_right. They are positioned from the parts that do exist.
Layers that matched no known body part and were skipped: cape. Rename them to a recognised part, or add them in the editor.
No layer provided bone "root"; it was created as a positioned virtual bone.
No layer provided bone "neck"; it was created as a positioned virtual bone.
No layer provided bone "shoulder_left"; it was created as a positioned virtual bone.
No layer provided bone "shoulder_right"; it was created as a positioned virtual bone.
0 error(s), 1 warning(s), 0 info — gate passed (failOn: error).
WARNING:
  animation/empty [setup]: Animation "setup" has no timelines.
    fix: Delete it, or confirm it exists on purpose as an empty animation used to clear a track.
Next: spine_import with input "...\demo\out\generated\hero.json" and output "<project>.spine" (needs a licensed Spine). Weights, meshes and animation belong in the editor — this generator produces region attachments and an empty setup animation.
```

(The `cape.png` line is there because a PNG was deliberately dropped into
`generated/images/` before this run. See *the images folder is shared ground* below.)

**Step 3 — know what the four outputs are for.**

| Output | Who reads it |
|---|---|
| `generated/hero.json` | The Spine editor, on `File -> Import Data`. Also every data tool here |
| `generated/hero.atlas` | The runtime, and `render_preview` / `visual_regression`. **Not** the editor |
| `generated/hero.png` | The packed atlas page, referenced by the `.atlas` |
| `generated/images/<attachment>.png` | The Spine editor, on import — one loose PNG per attachment |

**Step 4 — why `images/` is the one that decides whether import works.** The skeleton JSON carries
`skeleton.images = "./images/"`, and the editor resolves every attachment as
`<skeleton.images>/<attachmentName>.png` relative to the imported JSON. **The editor never reads
the `.atlas` on import.** The runtime does the opposite: it loads the atlas page and ignores the
loose files entirely.

So without that folder, `File -> Import Data` *succeeds* and the canvas is blank, with no error
anywhere — while every automated check that goes through the atlas passes, because the atlas was
correct the whole time. That is why `emitLooseImages` defaults to **true** and why the tool says
out loud when it wrote none.

**Step 5 — import it.** In the editor: `File -> Import Data`, pick `generated/hero.json`, and keep
`generated/images/` sitting next to it. Then convert regions to meshes where you need deformation,
bind weights, add IK, and animate. The `setup` animation is empty on purpose.

To do the import from here instead, `spine_import` with
`input: "generated/hero.json"` and `output: "art/hero.spine"` — that writes a project file, so it
needs a licensed Spine. **UNVERIFIED here**, for that reason.

**Step 6 — read the two "we did not guess" lists.**

- **`unmappedLayers`.** The demo PSD has a purple `cape` layer that matches no known body part. It
  is reported as skipped, not attached to the nearest bone and not invented as a new one. That is
  the artist's cue: rename it to a recognised part, or add it in the editor. A tool that guessed
  would produce a rig that looks finished and has a cape bound to a shoulder.
- **`virtualBones`.** A PSD with only `body` and `head` still produces the whole
  `root -> hip -> torso -> chest -> neck -> head` chain. The missing bones are created and
  positioned from the parts that do exist, so the head rotates about a plausible neck rather than
  about the document origin. Here that is `root`, `neck`, `shoulder_left` and `shoulder_right`.

**The images folder is shared ground.** Attachment names always come from the canonical body-part
list, so that list is the entire set of names the tool can write — and the only names it will
delete. A top-level PNG whose stem is one of those names but is not part of this rig is a leftover
from an earlier run: it is pruned and reported in `staleImagesRemoved`. Any *other* PNG, like the
`cape.png` planted above or an alias spelling such as `body.png`, is reported in
`foreignImagesKept` and **never deleted**. Relay that list rather than assuming the folder is
clean: the editor matches by file name, so a file this tool will not remove can still be resolved
as an attachment.

### B2. Reviewing a rig you did not build

Three tools, in this order: what is in it, what it does, and whether it is correct.

**Step 1 — `skeleton_inspect`, with the atlas.**

```json
{
  "input": "generated/hero.json",
  "atlas": "generated/hero.atlas"
}
```

```
Exported by Spine 4.2.37: 20 bones (depth 8), 16 slots, 1 skin(s), 16 attachments, 1 animation(s).
Animations: setup (0.00s).
Nonessential data present (skeleton.fps, skeleton.images), so this file can be imported back into Spine.
Atlas cross-check passed: every region the skeleton needs exists in ...\demo\out\generated\hero.atlas.
```

Pass the atlas. Without it you get the structure and nothing else; with it, every region the
skeleton references is checked for existence. A region the skeleton asks for and the atlas lacks
renders as nothing at runtime, with no error anywhere — the check that catches it is the last line
above, and the failing form of it is in [D](#d-troubleshooting).

The `nonessential data` line answers a question that comes up later: without it the file cannot be
imported back into Spine, which is fine for shipping and not fine if the `.spine` project is lost.

**Step 2 — `skeleton_document`, for what the rig *does*.** Two files, `<stem>.spine-doc.md` and
`<stem>.spine-doc.json`, in four sections: the bone hierarchy with setup-pose and derived world
transforms, the IK/transform/path/physics constraints resolved per bone, the per-bone influence
measured by re-rendering, and a motion profile per animation.

```json
{
  "skeleton": "generated/hero.json",
  "atlas": "generated/hero.atlas",
  "outDir": "doc"
}
```

```
Documented hero.json: 20 bones (depth 8), 16 slots, 1 animation(s), 0 constraint(s).
Markdown: ...\demo\out\doc\hero.spine-doc.md
JSON:     ...\demo\out\doc\hero.spine-doc.json
Influence: 20 probe(s) in rotate mode, 0.7s of render time. Bones with no visible effect: none.
Animations: setup (0.00s, loops, in place).
Staleness: there was no previous document at this path.
Note: skeleton.hash alone does not detect change — see "Staleness" in the document.
Note: influence is measured from software-rasterised renders; constraint following is read from the data, never inferred from pixels.
```

The measured-influence table is the part you cannot get from reading the JSON. Two real rows from
the document that run wrote:

```
| Bone | Axis | Delta | Changed pixels | Fraction | Bucket | Max channel delta | Influenced slots | Unattributed |
| `neck` | rotate | 20 | 2530 | 0.0386 | moderate | 255 | `head` → `head` (0.0386); `chest` → `chest` (0.0022) [overlap] | 0 |
| `hand_right` | rotate | 20 | 287 | 0.0044 | slight | 255 | `hand_right` → `hand_right` (0.0044); `forearm_right` → `forearm_right` (0.0014) [overlap]; `hip` → `hip` (0.0005) [overlap]; `thigh_right` → `thigh_right` (0.0001) [overlap] | 0 |
```

**What `[overlap]` means, and why it is labelled rather than hidden.** Influence is measured by
perturbing one bone — here rotating it by 20 degrees — re-rendering, and crediting each changed
pixel to every slot whose **axis-aligned bounding box** contains it. A box is larger than the
attachment it bounds, more so for a rotated one, so a slot that did not itself move gets credited
whenever its box overlaps one that did. A `[overlap]` slot is exactly that case: the perturbed bone
is not in that slot's bone subtree and no constraint links the two, so those pixels are an artefact
of the measurement and not movement. Unmarked slots *can* be moved by the perturbed bone.

The subtree-and-constraint test comes from the data, never from pixels. So the document can tell
you which credits are real without spending another render on it — and `rotating hand_right moves
thigh_right` never reaches you as a claim.

`probeMode: 'off'` gives you the three sections that need no browser, and launches nothing:

```json
{
  "skeleton": "generated/hero.json",
  "probeMode": "off",
  "outDir": "doc-off"
}
```

```
Documented hero.json: 20 bones (depth 8), 16 slots, 1 animation(s), 0 constraint(s).
Markdown: ...\demo\out\doc-off\hero.spine-doc.md
JSON:     ...\demo\out\doc-off\hero.spine-doc.json
Influence: not measured — Not measured: probeMode was 'off'. Re-run with probeMode 'rotate' and an atlas to measure influence.
Animations: setup (0.00s, loops, in place).
Staleness: there was no previous document at this path.
```

The influence line says *why* it is empty rather than reporting an empty table. A document claiming
no bone has any visible effect, when in fact nobody looked, is the failure this wording exists to
prevent.

**Step 3 — `skeleton_lint`, for whether it is correct.**

```json
{
  "input": "generated/hero.json",
  "atlas": "generated/hero.atlas"
}
```

```
0 error(s), 1 warning(s), 0 info — gate passed (failOn: error).
WARNING:
  animation/empty [setup]: Animation "setup" has no timelines.
    fix: Delete it, or confirm it exists on purpose as an empty animation used to clear a track.
Atlas checked: ...\demo\out\generated\hero.atlas
```

Every finding carries a severity and a concrete fix. The result comes back as a `GATE_FAILED`
error — not a success with a sad summary — as soon as any finding reaches `failOn`, which defaults
to `error`. That is what makes the same call usable from a script: branch on the result, not on the
text. `failOn` accepts `error`, `warning` or `info`; `rules` takes a list of rules files overlaid
on the defaults, with editable copies in
[`templates/lint-rules/naming.json`](../templates/lint-rules/naming.json) and
[`templates/lint-rules/budgets.json`](../templates/lint-rules/budgets.json).

### B3. Gating assets in CI

Two gates, in this order: `skeleton_lint` for what the data says, `visual_regression` for what it
looks like. The second exists because the first cannot see a repack — moving an atlas region by
three pixels does not change the skeleton JSON by one byte, so a text diff, a hash comparison and a
full lint pass all report that nothing happened.

**Baselines.** One directory per animation under `--baseline-dir`, each holding the frame PNGs and
a `baseline.json` manifest:

```
export/              committed exported data (json, atlas, png)
baseline/<anim>/     one baseline directory per animation, plus baseline.json
regression-diff/     written only on failure
```

The manifest records the skeleton hash, the Spine version, the animation, the skin, the exact
times, the canvas size and the premultiplied-alpha flag. On a check run, all of that is compared
first. If the skeleton hash moved, you get *that* as the outcome — with a pointer to
`skeleton_diff` — instead of four frames of pixel noise blaming the renderer for a data change.

**A passing check.** Through the stdio client, against the baseline `demo/run-demo.js` recorded:

```json
{
  "skeleton": "generated/hero-animated.json",
  "atlas": "generated/hero.atlas",
  "baselineDir": "baseline/wave",
  "diffDir": "regression-diff",
  "animation": "wave",
  "width": 240,
  "height": 240,
  "times": [0, 0.25, 0.5, 0.75]
}
```

```
4/4 frame(s) within tolerance (channel tolerance 4, budget 0.200% of pixels).
  wave-00-0_000s.png: ok — 0/57600 px (0.000%), max channel delta 0.
  wave-01-0_250s.png: ok — 0/57600 px (0.000%), max channel delta 0.
  wave-02-0_500s.png: ok — 0/57600 px (0.000%), max channel delta 0.
  wave-03-0_750s.png: ok — 0/57600 px (0.000%), max channel delta 0.
Visual regression passed.
Note: these renders come from the spine-ts runtime in headless Chromium. Spine's own image export is the authoritative visual output; this path exists to verify data automatically.
```

Keep `times` explicit and stable across runs. With `sampleCount` instead, changing the animation's
duration silently re-samples it and every frame differs for a reason that is not a regression.

**A failing check.** `demo/run-demo.js` shifts one atlas region by 3 pixels, the way a repack
would, and runs the identical call again:

```
GATE_FAILED: Visual regression failed for 4 frame(s).
Hint: 0/4 frame(s) within tolerance (channel tolerance 4, budget 0.200% of pixels).
  wave-00-0_000s.png: FAIL — 513/57600 px (0.891%), max channel delta 255.
  wave-01-0_250s.png: FAIL — 518/57600 px (0.899%), max channel delta 254.
  wave-02-0_500s.png: FAIL — 524/57600 px (0.910%), max channel delta 254.
  wave-03-0_750s.png: FAIL — 518/57600 px (0.899%), max channel delta 254.
Visual regression failed.
Diff images: ...\demo\out\regression-diff\wave-00-0_000s.png, ...
```

Diff images are written for failing frames only, and only when you asked for them. Pass `diffDir`
(tool) or `--diff-dir` (CLI) — without it the summary ends with "Pass `diffDir` to write diff
images for the failing frames." and you are debugging a percentage. Upload that folder as a CI
artifact; the magenta pixels are the regression.

**Updating a baseline deliberately.** `mode: 'update'` on the tool, `--mode update` on the CLI.
It overwrites the PNGs and the manifest without comparing anything, and says so
(`Baseline written (no comparison performed).`). That is the only way to move a baseline, and it is
an explicit argument rather than a fallback, so a check run can never quietly adopt the thing it
was supposed to be checking.

**The CLI form, and the one thing to get right.** Run on the demo workspace exactly as the
templates do:

```
> node dist/ci-cli.js regression --export-dir demo/out/generated --baseline-dir demo/out/baseline --diff-dir demo/out/regression-diff
FAIL regression hero/wave
    INVALID_ARGUMENT: Animation "wave" is not in this skeleton.
    Available animations: setup.
> echo $LASTEXITCODE
1
```

That is the real outcome, and it is worth keeping. The CLI pairs every skeleton that has an atlas
beside it with every baseline directory it finds, then asks for that animation by name. In
`demo/out/generated` the `wave` lives in `hero-animated.json`, which has no atlas of its own
beside it, while `hero.json` — which does — only has `setup`. So the pairing produces
`hero` × `wave`, and `hero` has no `wave`.

The fix is a layout rule, not a flag: **the skeleton that carries the animations and its atlas must
sit together in `--export-dir`, and the baseline directory names must be animations that skeleton
actually has.** That is exactly the shape a real `export/` directory has, and the reason the
templates assume committed export artifacts.

**The two shipped templates.**

- [`templates/ci/spine-assets.yml`](../templates/ci/spine-assets.yml) — a GitHub Actions workflow.
  Checkout, Node 20, `npm ci`, `npm run build`, a cached Chromium, then the two gates and an
  `upload-artifact` of `regression-diff/` on failure. The export job is present but commented out,
  because it needs a self-hosted runner with a licensed editor and a Spine licence is per seat —
  an organisational decision, not a configuration change.
- [`templates/ci/Invoke-SpineCi.ps1`](../templates/ci/Invoke-SpineCi.ps1) — the same gates for
  Windows. `-Action lint | regression | export | all`, with `-ExportDir`, `-BaselineDir`,
  `-DiffDir`, `-FailOn`, `-Update` and `-DryRun`. It builds if `dist/server.js` is missing, and
  before the export step it runs the read-only environment probe and skips the export with a
  warning when the editor is not licensed, rather than failing the run.

More on the pipeline shape, including why the default assumes committed artifacts, is in
[`steering/ci-pipeline.md`](../steering/ci-pipeline.md) and
[`steering/visual-regression.md`](../steering/visual-regression.md).

### B4. Handing assets to engineering

`runtime_scaffold` produces the integration glue for one target: the file names that target
requires, a controller script with a mix table derived from this skeleton, and a README with the
steps. `target` is `unity`, `web` or `godot`.

```json
{
  "target": "unity",
  "skeleton": "generated/hero-animated.json",
  "atlas": "generated/hero.atlas",
  "name": "Hero"
}
```

```
unity integration plan for Hero: runtime branch 4.2.
Required renames:
  hero.atlas -> hero.atlas.txt (Unity only imports known extensions; the atlas must be .atlas.txt)
Mix table: 2 suggested pair(s), default 0.2s.
Use the spine-runtimes 4.2 branch: data exported from 4.2.37 will be refused by a runtime of a different major.minor.
Not written to disk: pass `outputDir` to save the scaffold.
Once the files are in Assets/, Unity generates the _Atlas, _Material and _SkeletonData assets; scene assembly can then be handed to a Unity-side tool.
```

```json
{
  "target": "godot",
  "skeleton": "generated/hero-animated.json",
  "atlas": "generated/hero.atlas",
  "name": "Hero"
}
```

```
godot integration plan for Hero: runtime branch 4.2.
Required renames:
  hero-animated.json -> hero-animated.spine-json (spine-godot refuses .json skeletons since 2022, because Godot plugins compete for that extension; it must be .spine-json)
Mix table: 2 suggested pair(s), default 0.2s.
Use the spine-runtimes 4.2 branch: data exported from 4.2.37 will be refused by a runtime of a different major.minor.
Not written to disk: pass `outputDir` to save the scaffold.
```

**The renames, and what happens when you skip them.** These are encoded in
[`src/runtime-scaffold.ts`](../src/runtime-scaffold.ts) because they are facts about the runtimes,
not preferences:

| Target | Exported | Must be named | What happens otherwise |
|---|---|---|---|
| `unity` | `hero.atlas` | `hero.atlas.txt` | Unity only imports known extensions, so a plain `.atlas` is not imported at all |
| `unity` | `hero.skel` | `hero.skel.bytes` | spine-unity cannot load a file with the `.skel` extension |
| `godot` | `hero.json` | `hero.spine-json` | The importer has refused `.json` since 2022, because Godot plugins compete for that extension |
| `web` | — | no change | spine-ts renames nothing |

The failure mode is the reason the tool states them rather than mentioning them: nothing errors.
The file is simply not picked up, and you are left looking at an empty inspector.

**The version rule applies to all three.** Data exported from a 4.2 editor needs a 4.2 runtime, and
the runtimes enforce it on load. The plan reads the exporting version out of the data and names the
`spine-runtimes` branch; when the data records no version at all that is a **blocker**, not a
warning, and the tool returns `VALIDATION_FAILED` rather than a plan built on a guess.

**The mix table.** Durations derived from this skeleton's own animations: pairs that share many
animated bones get a longer blend, pairs that share few get a shorter one, and any value is capped
at half the shorter animation — because a 0.2 s blend into a 0.25 s attack swallows the attack.
Every row carries the reason it has that number. Treat them as a starting point to tune in play
mode, which is what the generated README says too.

Pass `outputDir` to write the scaffold (the controller script plus its README) into the workspace;
omit it to look at the plan first. It never touches the game project's own files — a developer, or
a Unity-side tool, copies them in.

---

## C. The arguments that matter

Three tools carry enough arguments to be worth a table. Everything below is read out of the schema
in the source, named per section.

### `skeleton_document`

From [`src/tools/doc-tools.ts`](../src/tools/doc-tools.ts).

| Argument | Type | Default | Notes |
|---|---|---|---|
| `skeleton` | string | required | Path to the exported skeleton JSON |
| `atlas` | string | — | **Required unless `probeMode` is `'off'`** |
| `imageDir` | string | the atlas folder | Where the atlas page images live |
| `outDir` | string | the skeleton folder | Must be inside the workspace |
| `probeMode` | `'off' \| 'rotate' \| 'full'` | `'rotate'` | `off` launches no browser, `rotate` probes one axis per bone, `full` probes three |
| `probeRotationDegrees` | number, 1–90 | `20` | Rotation applied to one bone at a time |
| `probeTranslateFraction` | number, 0.001–0.5 | `0.05` | Translation in `full` mode, as a fraction of the larger setup-pose bounds axis |
| `probeBones` | string[] | every bone | Every entry must be a declared bone name |
| `maxProbes` | integer, 1–512 | `256` | Refuse to render more than this many bone-axis combinations |
| `probeWidth` | integer, 64–1024 | `256` | Probe canvas width |
| `probeHeight` | integer, 64–1024 | `256` | Probe canvas height |
| `skin` | string | — | Validated against the skeleton's own skins |

Four of those have consequences worth stating.

- **`atlas` is required unless `probeMode` is `'off'`.** Probing renders the rig, so it needs the
  atlas. Omitting both is `INVALID_ARGUMENT` with the hint *"Pass `atlas`, or set `probeMode` to
  'off' for a data-only document."* — not a document with an empty influence section.
- **`maxProbes` refuses; it never truncates.** Over the limit, the call fails and names the cost.
  A silently truncated list would produce a document that looks complete and describes a third of
  the rig. Cost is one render per bone-axis combination plus one for the neutral frame, so a
  20-bone rig in `rotate` mode is 20 probes — 0.7 s here — and the same rig in `full` mode is 60.
- **`probeBones` entries must be declared bone names.** A typo is an error, not a silently
  narrower probe set.
- **`skin` is checked against the skeleton's own skins** before anything renders. A misspelled skin
  would otherwise come back as a success, rendered on the default skin.

### `skeleton_animate`

From [`src/tools/animate-tools.ts`](../src/tools/animate-tools.ts) and the `TEMPLATES` table in
[`src/animation-templates.ts`](../src/animation-templates.ts).

| Argument | Type | Default | Notes |
|---|---|---|---|
| `skeleton` | string | required | Path to the exported skeleton JSON |
| `animations` | array of 1–16 objects | required | One entry per animation to generate |
| `animations[].template` | one of the five below | required | — |
| `animations[].name` | string | the template name | Must match `/^[A-Za-z0-9_-]{1,64}$/` and be unique within the request |
| `animations[].duration` | number, 0.1–60 | the template's own duration | Seconds |
| `animations[].amplitude` | number, 0.1–3 | `1` | Scales the deviation from the setup pose |
| `outPath` | string | `<skeleton folder>/<stem>-animated.json` | Inside the workspace |
| `overwriteAnimations` | boolean | `false` | Allow replacing an animation that already exists in the data |
| `overwriteFile` | boolean | `false` | Allow overwriting the output file on disk |
| `emitEvents` | boolean | `false` | Emit the event keyframes a template declares |
| `atlas` | string | — | Enables the atlas lint rules on the result |

The five templates, with the durations from `TEMPLATES`:

| Template | Default duration | Loops | Required bones | Optional bones it uses if present |
|---|---|---|---|---|
| `idle` | 2.0 s | yes | `torso` | `chest`, `head`, `hip`, `arm_left`, `arm_right` |
| `walk` | 1.0 s | yes, in place | `thigh_left`, `thigh_right` | `shin_left`, `shin_right`, `hip`, `torso`, `arm_left`, `arm_right` |
| `wave` | 1.0 s | no | `arm_right` | `forearm_right`, `hand_right`, `head`, `arm_left` |
| `jump` | 0.8 s | no | `hip` | `thigh_left`, `thigh_right`, `shin_left`, `shin_right`, `torso`, `arm_left`, `arm_right` |
| `turn_head` | 1.2 s | no | `head` | `neck`, `chest` |

And the sentence the tool prints with every result:

> This is mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it.

There is also no mesh deformation: a weighted mesh follows the bones it is bound to, so generation
succeeds on a rig that has one, and the result names the mesh and states that nothing reshapes it
independently of its bones.

**`overwriteFile` defaults to `false`.** Run the same call twice and the second one refuses:

```
INVALID_ARGUMENT: A file already exists at ...\demo\out\generated\hero-templates.json.
Hint: Pass `overwriteFile` true to replace it, or choose another `outPath`. Two runs with different parameters would otherwise silently destroy the first result.
```

That last clause is the reason. A second run with a different `duration` or `amplitude` would
otherwise destroy the first result, and the result is a file somebody may already have opened in
the editor.

**`overwriteAnimations` defaults to `false` too, and is a different question.** It governs an
animation *name inside the data*, not the file: asking for a `walk` when the skeleton already has
one is `INVALID_ARGUMENT` until you allow the replacement. Existing animations — including an empty
`setup` — are otherwise preserved untouched.

**A template that does not fit the rig refuses, with the bones you have.** Against a four-bone rig
(`root`, `hip`, `torso`, `head`) with `[{ "template": "wave" }]`:

```
VALIDATION_FAILED: Template "wave" does not fit this rig: missing required bone(s) arm_right.
Hint: Template "wave" needs arm_right, which this rig does not have. The rig's bones are: root, hip, torso, head. No animation was generated and nothing was written: a renamed or substituted bone would produce motion that looks like success.
```

Nothing is written. No bone is ever substituted — the "if there is no `arm_right`, rotate the last
bone instead" fallback produces something that looks like success and is nonsense. A missing
*optional* bone is the opposite case: only its own timelines are dropped, the animation is still
emitted, and the omission is named in the summary.

If the rig uses another naming convention the error carries a rename suggestion
(`upper_arm_left` → `arm_left`, `pelvis` → `hip`) as advice to you, not as a bone the tool will
quietly use.

**`duration` and `amplitude` are the two knobs.** A slower, smaller walk:

```json
{
  "skeleton": "generated/hero.json",
  "animations": [
    { "template": "walk", "name": "walk_slow", "duration": 1.6, "amplitude": 0.6 }
  ],
  "outPath": "generated/hero-templates.json",
  "overwriteFile": true
}
```

```
Wrote 1 template-generated animation(s) to ...\demo\out\generated\hero-templates.json.
  walk_slow (1.60s, intended to loop) on hip, torso, arm_left, arm_right, thigh_left and 3 more. An in-place walk cycle: the legs alternate and the arms counter-swing, with no root translation, so the rig walks on the spot.
Existing animations preserved: setup.
skeleton.hash recomputed: 7c7d0e3f3b9e4bd525d792 -> d2b6e425d7397358dd078b (algorithm kiro-spine2d/canonical-sha1-22, not the editor's).
```

`amplitude` scales the deviation from the axis's neutral value, which is why it is not a plain
multiply: `rotate` and `translate` are additive around 0, while `scale` is multiplicative around 1.
At `amplitude: 0.5` a naive multiply would turn `jump`'s hip scale of `(1.05, 0.92)` into
`(0.525, 0.46)` — a caller who asked for less squash would get a hip at half size.

**`emitEvents` defaults to `false`, and today changes nothing.** None of the five templates declares
an event, so the flag is a no-op for all of them; it exists for the first template that does. When
a template does declare one, the flag emits its keyframes and declares any missing event in the
root `events` object — never overwriting an existing declaration, because a pre-existing `footstep`
keeps its own int/float/string/audio payload.

**`skeleton.hash` is recomputed, and the algorithm is named in the file.** It is this project's own
canonical hash (`kiro-spine2d/canonical-sha1-22`), not the editor's, and the written file says so
in its `_generator` record so nobody mistakes one for the other.

### `psd_to_skeleton`

From [`src/tools/generate-tools.ts`](../src/tools/generate-tools.ts).

| Argument | Type | Default | Notes |
|---|---|---|---|
| `psd` | string | required | Path to the layered PSD |
| `outDir` | string | required | Inside the workspace |
| `name` | string | the PSD file name | Base name for the generated files |
| `padding` | integer, 0–32 | `2` | Pixels of padding between packed regions |
| `maxSize` | integer, 64–8192 | `4096` | Maximum atlas page size |
| `premultipliedAlpha` | boolean | `false` | Records the flag in the atlas; the page image is **not** premultiplied, so only set this if the runtime expects it |
| `emitLooseImages` | boolean | `true` | Write the loose per-attachment PNGs the editor import resolves against |
| `timeoutSeconds` | integer, 1–3600 | `300` | Timeout for the Python sidecar |

**`emitLooseImages` defaults to `true`, and turning it off is a decision about the editor.** With
it off, nothing resolves on `File -> Import Data` and the summary says exactly that:

> No loose per-attachment images were written, so the Spine editor's File -> Import Data will not
> resolve attachments and the canvas will look empty. Re-run with emitLooseImages true (the
> default) to get them; the atlas path (runtime and render_preview) is unaffected.

Set it to `false` only for a runtime-only pipeline where nobody will open the editor.

**`foreignImagesKept` reports; it never prunes.** A PNG you put in `images/` yourself is reported
and left exactly where it was — see the `cape.png` line in
[B1](#b1-an-animator-hands-you-a-psd). Only names from the canonical body-part list are candidates
for pruning, and only when they are leftovers of this tool's own earlier run
(`staleImagesRemoved`). Non-PNG files, subdirectories and PNGs nested inside them are never
touched.

**`premultipliedAlpha` records a flag, it does not change pixels.** The page image written here is
not premultiplied. Setting the flag tells the runtime to use the premultiplied blend function on a
straight-alpha image, which is a specific wrong-looking result rather than an error. Straight alpha
works in both Linear and Gamma colour space and is the safe choice.

This tool is the one place the Python sidecar is needed: `uv sync --project python`. Everything
else here runs on Node alone.

---

## D. Troubleshooting

| Symptom | Code | What it means | Fix |
|---|---|---|---|
| `dist/server.js is missing. Run: npm run build` | — | There is no build. The server, the demo and the image generator all start with this check | `npm run build` |
| The CLI starts and never returns | `CLI_TIMEOUT` | A Spine editor window is open, so the launcher handed the request to the running instance | Close the Spine editor and retry |
| `Chromium failed to launch` | `DEPENDENCY_MISSING` | No Chromium build for the pinned `playwright-core` | `npx playwright-core install chromium` |
| `The Python sidecar could not be started` | `DEPENDENCY_MISSING` | `uv` is not installed or not on `PATH` | Install `uv`, then `uv sync --project python` |
| `This installation cannot perform exporting skeleton data` | `CAPABILITY_DENIED` | A Spine trial, which cannot save, pack or export | Buy a licence; read-only tools keep working |
| Blank canvas after `File -> Import Data` | — | The `images/` folder is not next to the imported JSON | Keep `generated/images/` beside the JSON, or re-run with `emitLooseImages` true |
| An attachment renders as nothing, with no error | — | The atlas lacks a region the skeleton needs | `skeleton_inspect` with the atlas, or `skeleton_lint` |

Each row in detail.

**`dist/server.js is missing. Run: npm run build`** — reproduced here. With `dist/` renamed aside,
`node demo/run-demo.js` prints exactly that and exits **1**, before it touches anything else.
`docs/make-doc-images.mjs` fails on the same check, and `Invoke-SpineCi.ps1` runs `npm run build`
itself when the file is absent.

**`CLI_TIMEOUT`** — **UNVERIFIED here, deliberately.** The Spine editor is open on this machine and
the CLI was never spawned, because spawning it is exactly the hang being described. The strings are
from [`src/cli-runner.ts`](../src/cli-runner.ts) and the observation is this project's own, recorded
in the README:

```
CLI_TIMEOUT: The Spine CLI did not finish within 180s.
Hint: The Spine CLI launches a separate editor process. When a Spine editor window is already open,
the launcher hands the request to the running instance and then waits forever.
Close the Spine editor and retry, or raise the timeout if the project is genuinely large.
```

The signature in the output is a run that prints `Started.` and never prints `Complete.`:
`Complete.` is how a CLI command says it did the work, and
[`src/cli-output.ts`](../src/cli-output.ts) parses the pair into one flag — `Started.` without
`Complete.` means the editor came up as a GUI session instead of performing the command. The
default timeout is 180 s, which is a cold editor start plus a modest export; raise it only when the
project is genuinely large, because the usual cause is an open window and no timeout is long enough
for `forever`.

**`DEPENDENCY_MISSING`, Chromium** — reproduced here, by pointing `PLAYWRIGHT_BROWSERS_PATH` at a
directory that does not exist and calling `render_preview`:

```
DEPENDENCY_MISSING: Chromium failed to launch (...). Install the browser with: npx playwright-core install chromium
Hint: Headless preview needs playwright-core plus a Chromium build. Everything else in this Power works without them.
```

The elided middle is Playwright's own multi-line diagnostic, which suggests installing the full
`playwright` package. Do not follow it. This project depends on `playwright-core` pinned at
**1.62.0** and the full package is not installed, so installing it would fetch whatever version
resolves and download the Chromium revision *that* version wants, defeating the pin. The only
correct spelling is `npx playwright-core install chromium`, and a test in
`tests/unit/docs-consistency.test.ts` fails on the other one appearing in any document in this
repository.

Only four things need the browser: `render_preview`, `visual_regression`, the measured-influence
section of `skeleton_document`, and `node dist/ci-cli.js regression`. `preview_export_html` needs
the runtime it embeds but no browser at all.

**`DEPENDENCY_MISSING`, the Python sidecar** — not reproduced here, because `uv` is installed and
working on this machine; the strings are from [`src/sidecar.ts`](../src/sidecar.ts). Two different
shapes:

```
DEPENDENCY_MISSING: The Python sidecar could not be started: <spawn error>
Hint: Install uv (https://docs.astral.sh/uv/getting-started/installation/) and run: uv sync --project python. Everything except PSD generation works without it.
```

```
DEPENDENCY_MISSING: The Python sidecar is missing dependencies: <names>.
Hint: Run: uv sync --project python
```

The first is `uv` itself missing from `PATH`; the second is `uv` present with the project's
dependencies unsynced. `spine_env_probe` answers both before you run anything, reporting the Python
version and the dependency versions.

**`CAPABILITY_DENIED`** — reproduced here, from `node demo/run-demo.js` step 9 on this machine's
Spine 4.3.26 trial. No Spine process was spawned: the gate in
[`src/capability-gate.ts`](../src/capability-gate.ts) refuses first, which is the whole point of it
existing.

```
CAPABILITY_DENIED: Blocked operations: exporting skeleton data (export). This installation cannot perform exporting skeleton data. The Spine trial does not permit saving projects, texture packing, or exporting data, images and video.
Hint: Purchase a Spine license (Essential or Professional) and install the licensed build. Read-only project info keeps working on the trial.
{
  "edition": "trial",
  "capability": "canExport",
  "executable": "C:\\Program Files\\Spine Trial\\SpineTrial.com",
  "wouldHaveRun": "\"C:\\Program Files\\Spine Trial\\SpineTrial.com\" -i ...\\demo\\out\\generated\\hero-animated.json -e binary",
  "blocked": [
    "exporting skeleton data (export)"
  ]
}
```

**`wouldHaveRun` is the deliverable.** It is the exact command line the gate declined to run, so
the refusal is not a dead end: hand it to someone with a licensed install, or re-run the same tool
call once the licensed build is in place, and the work repeats verbatim. The alternative — spawning
the CLI and letting the trial fail somewhere inside it — produces output that is hard to tell from
a successful run.

When the edition cannot be confirmed at all, writes are blocked for a different stated reason
(*"The installed Spine edition could not be confirmed, so write operations are blocked."*) with the
hint to run `spine_env_probe`. Blocked rather than attempted: assuming a licence and finding out
later is the failure that costs an afternoon.

**Blank canvas after `File -> Import Data`** — the `images/` folder is not beside the JSON. Covered
in full in [B1](#b1-an-animator-hands-you-a-psd): the editor resolves
`<skeleton.images>/<attachmentName>.png` relative to the imported JSON and never reads the
`.atlas`, so the import succeeds and nothing draws. Check for the folder, not for a valid atlas.

**An attachment renders as nothing, with no error anywhere** — reproduced here. One region was
removed from a copy of the demo atlas, and `skeleton_inspect` was pointed at the pair:

```
Exported by Spine 4.2.37: 20 bones (depth 8), 16 slots, 1 skin(s), 16 attachments, 1 animation(s).
Animations: setup (0.00s).
Nonessential data present (skeleton.fps, skeleton.images), so this file can be imported back into Spine.
Atlas is missing 1 region(s) the skeleton needs: head. Those attachments render as nothing at runtime.
```

`skeleton_lint` on the same pair fails the gate outright:

```
GATE_FAILED: Lint gate failed: 1 error(s), 2 warning(s) at failOn=error.
Hint: Fix the findings below, or relax the rules in templates/lint-rules/ and pass them via `rules`.
```

Nothing else notices. The skeleton is valid, the atlas is valid, the renderer draws what it can and
reports no error — it is only the cross-check between the two that catches it. `render_preview` has
a second net for the total case: if every frame comes back with zero coverage it warns that the
usual cause is an atlas whose regions do not match the attachment names. Run `skeleton_inspect`
with the atlas on every export; it costs nothing and it is the one check that catches a silent
blank.

---

## What is not verified here

In this guide specifically:

- **The `export` subcommand of `dist/ci-cli.js`**, and the `spine_export`, `spine_pack`,
  `spine_unpack`, `spine_import` and `spine_cleanup` tools. All of them need a licensed Spine
  editor; this machine has a trial. Their flags and command lines come from the source and are
  unit-tested, but no successful licensed run has been observed.
- **`CLI_TIMEOUT`.** Not reproduced on purpose: the Spine editor was open throughout, and spawning
  the CLI with a window open is the hang itself. Strings from `src/cli-runner.ts`, observation from
  this project's own record.
- **The `DEPENDENCY_MISSING` sidecar rows.** `uv` is installed and working here, so those two
  messages are quoted from `src/sidecar.ts` rather than reproduced.

Everything else in this file was executed, and the output above is what it printed.

The project's broader limits — placeholder motion, region attachments only, bounding-box influence,
single-platform verification, binary `.skel` being out of scope, undocumented export-settings field
names, unrun Godot integration — are listed with their reasons under **Honest limits** in
[`README.md`](../README.md), together with the two tables separating what has been verified against
the real thing from what has not.
