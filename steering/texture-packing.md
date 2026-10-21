# Texture Packing Steering
<!-- File Purpose / 本檔案用途: 貼圖集打包指引，涵蓋 pack.json 全欄位語意、per-folder 繼承、premultiplied alpha 與 atlas 問題診斷。 -->

> **Context**: For AI assistants configuring Spine's texture packer. Packing requires a licensed
> Spine; reading and auditing an existing atlas does not.

## Role and Purpose

A texture atlas exists to cut texture binds: bind one large texture, draw many regions from it.
Spine's packer is a general-purpose tool, and unlike export settings, **its settings schema is fully
documented** — so `pack_settings_build` validates every field by type, range and enum rather than
templating blindly.

## How packing gets invoked

Two paths, with different rules:

**1. During data export** (`Pack` checked, or a `+pack` shorthand). Two source modes:
- *Attachments*: packs only images used by attachments. **`pack.json` files are ignored.**
- *Image folders*: packs what it finds in each skeleton's images path, and **does** read `pack.json`.

**2. Separately**, through the texture packer (`spine_pack`). More control, and the usual choice
when the pack settings matter.

This is the single most common source of "my pack settings had no effect": the `+pack` shorthand
uses the Attachments mode with default settings.

## Per-folder settings

A `pack.json` in an image folder configures that folder. Subfolders inherit it and may override it
with their own. Two related behaviours:

- Images in the same folder go on the same set of pages. Separate folders when two groups are never
  drawn together (game vs pause menu) so one bind serves each.
- `combineSubdirectories` merges a folder tree onto shared pages anyway — except any subfolder that
  has its own `pack.json`.
- `{ "ignore": true }` excludes a folder and everything under it.

## Settings that actually change the result

| Setting | What to know |
|---|---|
| `maxWidth` / `maxHeight` | The page limit. Images that do not fit produce more pages. |
| `packing` | `rectangles` (default), `grid` (uniform spritesheet), `polygons` (tightest, slower, **needs the project** for mesh hulls). |
| `premultiplyAlpha` | Must match how the runtime blends. See below. |
| `stripWhitespaceX` / `Y` | Removes blank edges; the offsets are recorded so rendering stays correct. Needs project context to avoid cutting into meshes. |
| `paddingX` / `paddingY` | 2 is the safe default with linear filtering, because filtering samples neighbours. 0 is only safe with `Nearest`. |
| `duplicatePadding` | Copies edge pixels into the padding, which hides seams. |
| `bleed` | Fills transparent pixels with the nearest colour. Needed with straight alpha to avoid dark fringes. |
| `rotation` | Packs tighter by rotating regions 90°; runtimes compensate. |
| `alias` | Pixel-identical images are packed once. Free win. |
| `pot` / `multipleOfFour` / `square` | Page-dimension constraints some toolkits and compression formats require. `multipleOfFour` is redundant when `pot` is on. |
| `filterMin` / `filterMag` | `Linear` for artwork, `Nearest` for pixel art. |
| `scale` / `scaleSuffix` / `scaleResampling` | One atlas per scale. Suffixes must match the scale count, or each scale goes to its own subfolder. |
| `atlasExtension` | `.atlas` normally — **`.atlas.txt` for Unity**, which cannot import a plain `.atlas`. |
| `useIndexes` | Treats `name_3.png` as region `name` index 3, for frame sequences. |
| `currentProject` | Use the project's mesh UVs when stripping whitespace. Keep on. |

## Premultiplied alpha

The one setting that silently ruins rendering if it disagrees with the consumer.

- **Straight alpha** (`premultiplyAlpha: false`, `bleed: true`) works in both Linear and Gamma
  colour space. Prefer it when unsure, and it is what spine-unity 4.3+ recommends.
- **Premultiplied alpha** (`premultiplyAlpha: true`) is Spine's export default and is correct in
  Gamma colour space.

Two failure modes to check for:

1. **Mixed PMA across pages.** Runtimes pick a blend function per page, so one atlas with both
   modes renders wrong. `atlas_inspect` reports this, and `skeleton_lint` treats it as an error.
2. **PMA disagreeing with the runtime.** Pass `expectPremultipliedAlpha` to `skeleton_lint`, or
   `premultipliedAlpha` to `render_preview`, to assert the pairing instead of eyeballing it.

## Reading an existing atlas

`atlas_inspect` reports pages (size, format, filters, pma), region counts, rotated and
whitespace-stripped counts, packing efficiency, duplicate region names, and non power-of-two pages.
Both atlas generations are handled:

- 4.0+: `bounds: x, y, w, h` and `offsets: left, bottom, origW, origH`
- pre-4.0: `xy:`, `size:`, `orig:`, `offset:`, and `rotate: true|false`

`rotate` may be `true` (meaning 90°) or a degree value.

## Diagnosing atlas problems

| Symptom | Likely cause |
|---|---|
| An attachment renders as nothing | The region is missing from the atlas. `skeleton_inspect` with `atlas` names it. |
| Dark or light fringes around edges | PMA mismatch, or straight alpha without `bleed`. |
| Thin lines of a neighbouring image | Padding too small for the filter, or `duplicatePadding` off. |
| Parts of a mesh cut off | Whitespace stripping without project context. Pass `projects`. |
| Low packing efficiency | Enable stripping and rotation, try `polygons`, or lower the page size so pages fill better. |
| Texture compression rejects the page | Dimensions are not power-of-two / divisible by four / square. |

## Bundled templates

| Template | For |
|---|---|
| `unity-default` | spine-unity: `.atlas.txt`, straight alpha, bleed on, divisible by four |
| `web-pot` | Web: power-of-two, polygon packing, premultiplied, 1x + 0.5x scales |
| `pixelart` | Pixel art: `Nearest` filtering, no stripping, no rotation, no PMA, indexes on |

`pack_settings_build` writes **every** field explicitly rather than relying on Spine's defaults, so
a default change in a future release cannot silently alter a project's atlases.
