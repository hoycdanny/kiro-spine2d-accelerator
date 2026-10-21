# Web Integration Steering
<!-- File Purpose / 本檔案用途: spine-ts 網頁整合指引，涵蓋套件選擇、版本對齊、資產載入、4.2 physics 參數與渲染迴圈。 -->

> **Context**: For AI assistants wiring exported Spine data into a web project via spine-ts.

## Role and Purpose

The web runtime is the most convenient target: no engine, no import step, and no file renaming. It
is also the one this Power uses internally for headless preview, so the same code path is already
exercised here.

## Choosing a package

| Package | Use |
|---|---|
| `@esotericsoftware/spine-webgl` | WebGL rendering with full control. What `runtime_scaffold` generates, and what the preview tool uses. |
| `@esotericsoftware/spine-player` | A drop-in player widget with controls. Fastest path to "show this animation on a page". |
| `@esotericsoftware/spine-canvas` | 2D canvas rendering. No mesh deformation; use only where WebGL is unavailable. |
| `@esotericsoftware/spine-phaser`, `-pixi`, `-threejs` | Integrations for those engines. |

**Pin the major.minor to the exporting editor**: `npm install @esotericsoftware/spine-webgl@4.2`.
A 4.3 runtime refuses 4.2 data.

## Assets

No renaming is needed, but two things matter:

1. **Serve over HTTP.** A `file://` page cannot fetch the atlas and images. Use a dev server.
2. **Keep the page images next to the atlas.** The AssetManager resolves page image names relative
   to the atlas URL.

## Loading

```ts
const context = new spine.ManagedWebGLRenderingContext(canvas);
const assets = new spine.AssetManager(context);
assets.loadTextureAtlas('/assets/hero.atlas');
assets.loadText('/assets/hero.json');
await assets.loadAll();

const atlas = assets.require('/assets/hero.atlas') as spine.TextureAtlas;
const json = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
const data = json.readSkeletonData(assets.require('/assets/hero.json') as string);
```

For binary data, use `assets.loadBinary(...)` and `spine.SkeletonBinary` instead.

`json.scale` applies a load-time scale, which is the right place to resize a skeleton — not a
transform on the canvas.

## The render loop

```ts
state.update(delta);
state.apply(skeleton);
skeleton.update(delta);                              // advances physics time
skeleton.updateWorldTransform(spine.Physics.update); // 4.2+ requires the argument
renderer.begin();
renderer.drawSkeleton(skeleton, premultipliedAlpha);
renderer.end();
```

Two details that cause real bugs:

- **`updateWorldTransform` takes a physics argument in 4.2+.** `Physics.update` integrates,
  `Physics.pose` applies without simulating, `Physics.reset` clears state. Omitting it throws.
- **`drawSkeleton`'s second argument must match the atlas.** Read the atlas `pma` flag rather than
  hardcoding it; `atlas_inspect` reports it.

Drive `delta` from `requestAnimationFrame` timestamps, and clamp it when a tab is backgrounded — a
multi-second delta makes physics explode.

## Mixes and tracks

`AnimationStateData` holds the blend durations:

```ts
stateData.defaultMix = 0.2;
stateData.setMix('walk', 'run', 0.3);
```

`runtime_scaffold` generates this table from the skeleton's own animations, with a comment
explaining each value. Track 0 is the base layer; higher tracks layer on top.

Listen for events through `state.addListener({ event, complete, start, end, interrupt, dispose })`.
Spine events are the intended way for an animation to tell application code when something happens.

## This Power's own usage

`render_preview` uses spine-webgl inside headless Chromium, with everything inlined as data URLs so
nothing is fetched. If a preview renders and a web page does not, the difference is almost always
asset loading (paths, CORS, or a dev server) rather than the data.

## Checklist

1. Runtime package major.minor matches the exporting editor.
2. Assets served over HTTP, page images beside the atlas.
3. `updateWorldTransform(spine.Physics.update)` present.
4. `drawSkeleton`'s premultiplied-alpha argument matches the atlas `pma` flag.
5. Delta time clamped.
