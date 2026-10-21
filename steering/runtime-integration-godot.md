# Godot Integration Steering
<!-- File Purpose / 本檔案用途: spine-godot 整合指引，涵蓋兩種安裝路徑、.spine-json 副檔名要求、資源結構與 SpineSprite 用法。 -->

> **Context**: For AI assistants wiring exported Spine data into Godot via spine-godot. This guide
> is planning-level: the scaffold encodes the documented rules, but has not been run against a
> Godot project from here. Verify in the editor and say so.

## Role and Purpose

Godot integration has one hard prerequisite choice and one non-obvious file-naming rule. Get both
wrong and the import silently does nothing; get them right and the rest is ordinary Godot work.

## Two installation paths

| Path | Trade-off |
|---|---|
| **GDExtension** | Works with a stock Godot build — no custom editor. The usual choice. |
| **Custom C++ engine module** | Requires a Godot editor **and** export templates built from the spine-godot sources. Supports extras such as AnimationPlayer integration and C# bindings, and is unlikely to support consoles. |

Ask which one the project uses before giving instructions, because the install steps differ
entirely. Match the spine-godot version to the exporting editor's major.minor, as with every
runtime.

## The file naming rule

**JSON skeletons must be renamed to `.spine-json`.** Since 2022, spine-godot refuses `.json`,
because Godot plugins compete over that extension and only one can own it.

| Exported | Godot needs |
|---|---|
| `hero.json` | `hero.spine-json` |
| `hero.skel` | `hero.skel` (no change) |
| `hero.atlas` | `hero.atlas` (no change) |
| `hero.png` | `hero.png` (no change) |

`runtime_scaffold` with `target: "godot"` reports the rename. An existing project moving to a newer
spine-godot also needs its `.tscn`/`.tres` resource paths updated, for which Esoteric ships a
conversion script.

## Resources

Godot imports the files as resources that are then combined:

1. The skeleton file becomes a **SpineSkeletonFileResource**.
2. The atlas becomes a **SpineAtlasResource**.
3. A **SpineSkeletonDataResource** references both.
4. A **SpineSprite** node takes the SpineSkeletonDataResource and renders it.

## Playback

```gdscript
extends SpineSprite

func _ready() -> void:
	var state_data := get_skeleton_data_res().get_animation_state_data()
	state_data.set_default_mix(0.2)
	state_data.set_mix_by_name("walk", "run", 0.3)
	get_animation_state().set_animation("walk", true, 0)
```

As elsewhere, track 0 is the base layer and mixes are configured per animation pair.
`runtime_scaffold` generates this script with a mix table derived from the skeleton.

## Checklist

1. Decided between GDExtension and the custom engine module, and installed accordingly.
2. spine-godot version matches the exporting editor's major.minor.
3. JSON skeleton renamed to `.spine-json`.
4. SpineSkeletonDataResource references both the skeleton and the atlas resource.
5. A SpineSprite node plays the animation in the editor preview.

## Honesty note

When advising on Godot, say which parts are verified: the extension requirement and the two
installation paths come from Esoteric's documentation, while the exact GDScript API surface varies
between spine-godot versions. Have the developer confirm the method names against their installed
version rather than asserting them.
