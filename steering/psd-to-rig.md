# PSD to Rig Steering
<!-- File Purpose / 本檔案用途: 由分層 PSD 生成 Spine 骨架的指引，涵蓋圖層命名約定、樞紐規則、虛擬骨骼與生成後的收尾。 -->

> **Context**: For AI assistants generating a Spine rig from artwork. Generation bypasses the Spine
> editor entirely, so it works on a trial license. The import step afterwards does not.

## Role and Purpose

The slowest part of starting a Spine character is the mechanical part: cutting layers, creating
bones, parenting them, placing pivots, and binding attachments. `psd_to_skeleton` does that from
layer names, and leaves the judgement — meshes, weights, animation — to the artist.

Be clear with the developer about the boundary. This produces a *correct starting rig*, not a
finished one.

## What it produces

| File | Contents |
|---|---|
| `<name>.json` | Spine 4.2 skeleton: bones, slots in PSD draw order, a default skin of region attachments, an empty `setup` animation |
| `<name>.atlas` | 4.0+ format atlas text, one page |
| `<name>.png` | The packed page image |
| `images/<attachment>.png` | One loose, unpacked PNG per attachment, named exactly after the attachment. This folder is what the Spine editor's `File -> Import Data` resolves attachments against. Only files named after a known body part are managed here; anything else in the folder is reported, not deleted |

It also reports `boneCount`, `attachmentCount`, `regionNames`, `virtualBones`, `unmappedLayers`,
`imagesDir`, `imagePaths`, `staleImagesRemoved`, `foreignImagesKept` and `warnings`, then inspects
and lints the result before returning.

### Editor import reads the loose images, the runtime reads the atlas

The skeleton JSON carries `skeleton.images = "./images/"`, and the editor resolves every attachment
as `<skeleton.images>/<attachmentName>.png` relative to the imported JSON. **The editor never reads
the `.atlas` on import.** The spine-ts runtime (and therefore `render_preview`) does the opposite:
it loads the atlas page and ignores the loose files entirely.

That split is why the "blank canvas after import" bug went unnoticed for so long — every automated
check ran through the atlas path, which was correct the whole time. If an artist reports an empty
canvas after `File -> Import Data`, the question is whether `images/` sits next to the JSON, not
whether the atlas is valid.

- `emitLooseImages` defaults to **true**. Set it to false only when nobody will open the editor
  (a runtime-only pipeline); the tool then warns that editor import will not resolve attachments.
- **The tool prunes only what it owns, and reports the rest.** Attachment names always come from
  the canonical body-part list, so that list is the whole set of names the tool can write. After
  writing, a top-level `*.png` whose stem is one of those names but is not part of this rig is a
  leftover from an earlier run: it is deleted and reported in `staleImagesRemoved`. Any other PNG
  — an animator's hand-made `cape.png`, or an alias spelling like `body.png` — is reported in
  `foreignImagesKept` and **never deleted**. That matters because the editor matches by file name,
  so a file the tool will not remove can still be resolved as an attachment; relay the list rather
  than assuming the folder is clean. Non-PNG files, subdirectories and PNGs nested inside them are
  left alone.
- The loose files are the per-part layer images as they came out of the PSD, not crops of the
  packed page, so their pixels match the attachment geometry exactly.

## Layer naming

The canonical hierarchy:

```
root → hip → torso → chest → neck → head
arms hang off chest, legs off hip
```

Recognised part names include `head`, `torso`, `chest`, `neck`, `hip`, `shoulder_left`, `arm_left`,
`forearm_left`, `hand_left`, `thigh_right`, `shin_right`, `foot_right`, and their counterparts on
the other side.

Aliases are accepted: `body` and `belly` map to `torso`; `pelvis`, `hips` and `waist` to `hip`;
`face` and `skull` to `head`; `upper_arm_left` to `arm_left`; `lower_leg_right` and `calf_right` to
`shin_right`; `leg_left` to `thigh_left`.

Side markers work leading or trailing, with several spellings: `arm_l`, `arm-R`, `l_arm`,
`left arm`, `hand lt` all resolve. Separators (space, hyphen, dot, slash) and case are normalised.

**Unrecognised layers are reported in `unmappedLayers`, never guessed at.** Relay that list: it is
the artist's cue to rename a layer or add that part in the editor.

## Two behaviours worth explaining to the developer

**Missing intermediate bones are created.** A PSD with only `body` and `head` still produces the
full `root → hip → torso → chest → neck → head` chain. The virtual bones are positioned from the
parts that do exist, so the head rotates about a plausible neck rather than about the document
origin. They come back in `virtualBones`.

**Pivots sit at joints, not image centres.** Each part pivots at the edge where its joint is — a
thigh at its top, a torso at its bottom. Rotating about an image centre bends a limb in the middle,
which is the single most common thing wrong with a hand-built first rig.

To place a pivot explicitly, add a small layer named `<part>[pivot]`; its centre becomes that
bone's origin. Useful when the art's silhouette does not put the joint on an edge.

## Coordinate conventions

PSD is y-down with the origin at the top left; Spine is y-up. The rig origin is the horizontal
centre of the used area at the bottom of the lowest part — where a character's feet are, and where
animators expect (0, 0) to be. Bone positions are emitted relative to their parent, as the format
requires, and parents are always written before children.

## After generation

1. **Read the lint result.** It runs automatically, with the bone/slot/attachment naming rules off
   because the generator's convention is underscores.
2. **Import into Spine** with `spine_import` (needs a license):
   `spine_import(input: "generated/hero.json", output: "art/hero.spine")`
3. **Tell the artist what to do next**, in the editor: convert region attachments to meshes where
   deformation is needed, bind weights, add IK for limbs, and animate. The `setup` animation is
   empty on purpose.
4. **Optional sanity render**: `render_preview` on the generated data confirms the attachments
   resolve against the generated atlas before anyone opens the editor.

## What it does not do

State these plainly rather than letting the developer discover them:

- No mesh attachments and no weights — region attachments only.
- No animations beyond an empty `setup`.
- No whitespace stripping in the atlas, because attachment offsets are expressed against each
  layer's full bounds.
- One page per rig; no multi-scale output.
- Hidden PSD layers are skipped, deliberately: hiding a layer is an instruction.
- Group layers are walked through, but groups themselves are not parts.

## Generating placeholder animation

A freshly generated rig has an empty `setup` animation and nothing to look at. `skeleton_animate`
fills that gap from five parameterised templates, writing a second file
`<basename>-animated.json` and leaving the input untouched. It is pure data work: no editor, no
license, no Python sidecar.

| Template | Duration | Loops | Required bones | Optional bones it uses if present |
|---|---|---|---|---|
| `idle` | 2.0 s | yes | `torso` | `chest`, `head`, `hip`, `arm_left`, `arm_right` |
| `walk` | 1.0 s | yes | `thigh_left`, `thigh_right` | `shin_left`, `shin_right`, `hip`, `torso`, `arm_left`, `arm_right` |
| `wave` | 1.0 s | no | `arm_right` | `forearm_right`, `hand_right`, `head`, `arm_left` |
| `jump` | 0.8 s | no | `hip` | `thigh_left`, `thigh_right`, `shin_left`, `shin_right`, `torso`, `arm_left`, `arm_right` |
| `turn_head` | 1.2 s | no | `head` | `neck`, `chest` |

**A non-matching rig fails; it does not improvise.** A missing *required* bone is
`VALIDATION_FAILED` naming the template, the bones it needed and the bones the rig actually has,
and nothing is written. No substitute bone is ever picked — a substitution produces motion that
looks like success and reads as nonsense. A missing *optional* bone drops only its own timelines,
still emits, and is named in the summary. If the rig uses a different convention, the error carries
a rename suggestion (`upper_arm_left` → `arm_left`, `pelvis` → `hip`) as advice to the developer,
not as a bone the tool will quietly use.

**Relay this wording whenever you offer the tool**, before the developer opens the result:

> This is mechanically plausible placeholder motion, not finished animation — linear keyframes, no
> curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor
> to refine it.

**Weighted meshes.** Mesh *deformation* is out of scope: no `deform` timeline is ever generated.
A weighted mesh itself still animates correctly, because it follows the bones it is bound to, so
generation succeeds on a rig that has one — the result just names the mesh and states that nothing
reshapes it independently of its bones.

After generating, `skeleton_diff` from the input to the output states exactly what was added, and
`render_preview` sampling several times across the animation shows it moving. The output's
`skeleton.hash` is recomputed with this tool's own algorithm, named in the file, which is not the
editor's.

## Setup and failures

The sidecar needs uv and its Python dependencies:

```bash
uv sync --project python
```

`spine_env_probe` reports `sidecar.available`, the Python version and the dependency versions.

| Error | Meaning |
|---|---|
| `DEPENDENCY_MISSING` on spawn | uv is not installed or not on PATH. |
| `DEPENDENCY_MISSING` with a list | `uv sync --project python` has not been run. |
| `VALIDATION_FAILED` mentioning "No layer name matched" | No layer resolved to a body part. Check the layer names against the list above. |
| `VALIDATION_FAILED` from structural validation | A generator bug or a very unusual PSD. The files are still written so they can be inspected; report it with the PSD. |
| `CLI_TIMEOUT` | A large PSD. Raise `timeoutSeconds`, or flatten layer groups that are not body parts. |
