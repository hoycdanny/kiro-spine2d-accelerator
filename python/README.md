# spine-psd-sidecar

Generates a Spine rig from a layered PSD: skeleton JSON, a texture atlas, the atlas page image,
and an `images/` folder of loose per-attachment PNGs next to the JSON. It bypasses the Spine
editor entirely, which is what makes it usable on a trial license — the generated files are then
imported into Spine with `spine_import` (that step does need a license, since it writes a project
file).

The `images/` folder is not a convenience: the editor's `File -> Import Data` resolves every
attachment as `<skeleton.images>/<attachmentName>.png` relative to the JSON and never reads the
`.atlas`, so without it the import succeeds and the canvas is blank. The runtime and
`render_preview` are the other way round — they read the atlas and ignore these files.

This is a **sidecar**, not an MCP server. The TypeScript execution layer owns the single tool
surface and calls this process with one JSON request on stdin.

## Install

```bash
uv sync --project python
```

Python 3.11+. Dependencies: psd-tools, Pillow, rectpack.

## Protocol

```bash
echo '{"command":"probe"}' | uv run --project python spine-psd-sidecar
```

```json
{"command": "psd_to_skeleton", "psdPath": "art/hero.psd", "outDir": "export", "name": "hero",
 "emitLooseImages": true}
```

Responses are `{"ok": true, "data": {...}}` or
`{"ok": false, "error": {"code": "...", "message": "...", "hint": "..."}}`.
Diagnostics go to stderr so stdout stays parseable.

`emitLooseImages` defaults to true; set it to false to write only the atlas path. The success
payload reports `imagesDir` (the folder), `imagePaths` (the written `<attachment>.png` files),
`staleImagesRemoved` (names of its *own* leftovers pruned from that folder — PNGs named after a
body part this rig no longer has, which the editor would otherwise silently pick up) and
`foreignImagesKept` (names of any other PNG found there, reported and left exactly where it is,
because the pipeline never deletes a file it could not have written).

## Layer naming

Layer names drive the rig. The canonical hierarchy is:

```
root -> hip -> torso -> chest -> neck -> head
arms off chest, legs off hip
```

Recognised names include `head`, `torso` (or `body`), `chest`, `neck`, `hip` (or `pelvis`),
`arm_left`, `forearm_right`, `hand_left`, `thigh_right`, `shin_left`, `foot_right`, and the
common side spellings — `arm_l`, `l_arm`, `left arm` all resolve to `arm_left`.

Two behaviours worth knowing:

- **Missing intermediate bones are created.** A PSD with only `body` and `head` still produces
  `root → hip → torso → chest → neck → head`, with the virtual bones positioned from the parts
  that do exist. The response lists them in `virtualBones`.
- **Pivots sit at joints, not image centres.** Each part pivots at the edge where its joint is,
  so a limb rotates from the joint instead of bending in the middle. Add a layer named
  `<part>[pivot]` to place a pivot explicitly; its centre becomes that bone's origin.

Unrecognised layers are reported in `unmappedLayers` rather than guessed at.

## What it does not do

- No mesh attachments or weights: parts are region attachments. Mesh and weight work belongs in
  the editor.
- No animations beyond an empty `setup` animation.
- No whitespace stripping in the atlas, because the attachment offsets are expressed in terms of
  each layer's full bounds.

## Tests

```bash
uv run --project python pytest
```

Fixtures are synthetic: tests build `PsdDocument` objects directly, so no PSD files are needed
and no Spine example assets are redistributed.
