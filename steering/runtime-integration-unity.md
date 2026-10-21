# Unity Integration Steering
<!-- File Purpose / 本檔案用途: spine-unity 整合指引，涵蓋必要副檔名、Unity 自動生成的資產、premultiplied alpha 與色彩空間配對、AnimationState 與 mix 設定。 -->

> **Context**: For AI assistants wiring exported Spine data into Unity via spine-unity.

## Role and Purpose

Most Unity integration failures are not code failures. They are a wrong file extension, a
premultiplied-alpha mismatch, or a runtime version that does not match the editor. This guide front
-loads those three.

## The file naming rules (not optional)

| Exported | Unity needs | Why |
|---|---|---|
| `hero.atlas` | `hero.atlas.txt` | Unity only imports known extensions. |
| `hero.skel` | `hero.skel.bytes` | **spine-unity cannot load `.skel`.** |
| `hero.json` | `hero.json` | No change. |
| `hero.png` | `hero.png` | No change. |

Set these at export time rather than renaming afterwards:

- Texture Packer Settings → **Atlas extension** → `.atlas.txt`
- Export → Binary → **Extension** → `.skel.bytes`

`pack_settings_build` with the `unity-default` template and `export_settings_build` with
`unity-binary` already carry both. `runtime_scaffold` reports any rename still needed.

## What Unity generates

Copy the files into a **new empty folder** under `Assets/`. Unity detects them and creates:

| Asset | Holds |
|---|---|
| `*_Atlas` | A reference to the `.atlas.txt` and to the material(s) |
| `*_Material` (one per page image) | The shader and the page texture |
| `*_SkeletonData` | The skeleton data file plus the `_Atlas` asset, and the per-skeleton import and animation settings |

Drag `_SkeletonData` into the scene and choose **SkeletonAnimation** for world-space rendering, or
**SkeletonGraphic** for Unity UI. A GameObject appears with the Spine components already attached.

## Premultiplied alpha and colour space

The pairing that decides whether edges look right:

- **Straight alpha** — pack with `premultiplyAlpha: false`, `bleed: true`. Works in **both** Linear
  and Gamma colour space. This is the safe default, and what spine-unity 4.3+ recommends.
- **Premultiplied alpha** — pack with `premultiplyAlpha: true`. Correct only in **Gamma**.

If the project might ever switch colour space, use straight alpha. `skeleton_lint` with
`expectPremultipliedAlpha: false` asserts it, and `atlas_inspect` reports what the atlas actually
declares.

## Single-page atlases

Prefer one atlas page. It halves texture binds, and the SkeletonGraphic (UI) path effectively
requires it — Unity UI batching cannot span multiple textures for one graphic.
`runtime_scaffold` warns when the atlas has more than one page.

## Runtime version

spine-unity's major.minor must match the exporting editor. Install the unitypackage or UPM package
from the matching `spine-runtimes` branch. `runtime_scaffold` reports the branch and blocks when the
data records no version.

## AnimationState and mixes

`runtime_scaffold` generates a controller with:

- `SetAnimation(0, name, loop)` on track 0, the base layer
- `AnimationState.Data.DefaultMix` plus a `SetMix(from, to, seconds)` table derived from this
  skeleton's animations
- An `Event` handler, since Spine events are how an animation tells game code to spawn a hit or play
  a sound
- A `PlayOnce` helper that queues a one-shot and returns to idle with `AddAnimation`

The mix values are a starting point derived from animation durations and how many bones each pair
shares; the generated README explains each one. Tune them in play mode — a long blend into a short
attack swallows the attack.

Tracks are layers: track 0 for locomotion, higher tracks for additive or partial animations.

## Hand-off

This Power stops at "the assets are in place and here is a controller". Scene assembly, prefab
wiring and component configuration belong on the Unity side — a Unity-focused tool or the developer.
Say that explicitly rather than attempting scene edits from here.

## Checklist before declaring it done

1. `skeleton_lint` passed with the atlas.
2. Extensions are `.atlas.txt` and, for binary, `.skel.bytes`.
3. One atlas page, or a stated reason for more.
4. Premultiplied alpha matches the colour space.
5. The spine-unity version matches the exporting editor.
6. The skeleton appears in the scene and the idle animation plays.
