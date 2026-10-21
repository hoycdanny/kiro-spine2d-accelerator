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
| `images/<attachment>.png` | One loose, unpacked PNG per attachment, named exactly after the attachment. This folder is what the Spine editor's `File -> Import Data` resolves attachments against |

It also reports `boneCount`, `attachmentCount`, `regionNames`, `virtualBones`, `unmappedLayers`,
`imagesDir`, `imagePaths`, `staleImagesRemoved` and `warnings`, then inspects and lints the result
before returning.

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
- **Stale PNGs are pruned.** After writing, any other `*.png` sitting directly in that folder is
  deleted and reported in `staleImagesRemoved` — the editor matches by filename, so a leftover
  `cape.png` from a previous run would be silently picked up. Non-PNG files, subdirectories and
  PNGs nested inside them are left alone.
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
