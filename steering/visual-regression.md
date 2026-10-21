# Visual Regression Steering
<!-- File Purpose / 本檔案用途: headless 預覽與視覺回歸指引，涵蓋取樣策略、基準圖管理、容差設定與兩種輸出路徑的角色分工。 -->

> **Context**: For AI assistants verifying Spine animations automatically. Needs the optional
> playwright-core dependency and a Chromium build; nothing else in this Power does.

## Role and Purpose

Spine data can pass every structural check and still look wrong. Visual verification closes that
gap, and doing it headlessly makes it something CI can enforce rather than something a human
remembers to check.

## Role split: two rendering paths, different jobs

| Path | Job |
|---|---|
| Spine's own image/video export (CLI `-e` with an image class) | **Authoritative output.** What ships to marketing, or into a sprite sheet. Needs an OS windowing system and OpenGL, so it is fragile on CI runners. |
| `render_preview` / `visual_regression` (spine-ts in headless Chromium) | **Automation.** Reproducible, runs without a desktop session, and is the input to regression. Not a substitute for the authoritative output. |

Say which one you used. A developer comparing a regression PNG against a marketing render will
otherwise assume they should be identical.

## What makes the renders reproducible

Two deliberate choices, worth knowing because changing them invalidates baselines:

1. **Fixed-step time advance.** Animation time is advanced in fixed steps (1/60s by default) rather
   than one jump to the sample time, so physics constraints (4.2+) integrate the way a real runtime
   would.
2. **One camera framing per run.** The camera is framed once from the union of every sampled pose,
   so all frames in a run share one coordinate system. Per-frame framing would hide movement.

Also fixed: premultiplied alpha defaults to whatever the atlas declares, and the canvas size is
explicit. All three are recorded in the baseline manifest.

## Sampling

Prefer explicit `times` over `sampleCount` for anything that will become a baseline, because the
sample points must stay stable across runs. Four points through a loop is usually enough to catch
real changes; add points around a moment that matters (an attack's contact frame).

`sampleCount` spreads samples evenly from 0 to the animation's duration, inclusive, and is the
right choice for a one-off look.

## Baselines

A baseline directory holds the PNGs plus `baseline.json`, which records the skeleton hash, the Spine
version, the animation, skin, sample times, canvas size and premultiplied-alpha setting.

**Use one directory per animation.** The manifest check will refuse a mismatch anyway, but a
directory per animation keeps the failure obvious.

Modes:
- `check` (default) — compare, and fail as `GATE_FAILED` on a difference.
- `update` — write the baseline and the manifest.

When the manifest does not describe the current request, the tool reports *that* instead of pixel
differences:

| Mismatch | What it means |
|---|---|
| `missing` | No baseline yet. Run with `mode: "update"`. |
| `hash` | The skeleton data changed. Pixel diffs would be expected rather than informative — review `skeleton_diff` first, then update. |
| `animation` | The baseline covers a different animation. Use a separate directory. |
| `times` / `frames` | Different sample points. Comparing different moments is meaningless. |
| `size` | A different canvas size. Re-create the baseline. |

## Thresholds

Two thresholds work together, and both are needed:

- `channelTolerance` (default 4, of 255) absorbs the small per-pixel differences a software
  rasteriser produces between runs. Raising it hides real colour shifts.
- `maxDifferentFraction` (default 0.002) is the share of pixels allowed to differ beyond that
  tolerance. Raising it hides real movement.

Tighten `channelTolerance` to 0 only when comparing renders from one machine. Loosen
`maxDifferentFraction` when antialiasing along a long silhouette edge produces unavoidable churn —
but prefer a larger canvas first, since that reduces the proportion of edge pixels.

Diff images are dimmed greyscale with differing pixels in magenta. Pass `diffDir` so a failure
produces something to look at; without it, the summary says so.

## Standard flows

**Look at an animation:**
```
render_preview(skeleton, atlas, animation: "walk", times: [0, 0.25, 0.5, 0.75], outputDir: "preview")
```

**Establish a baseline:**
```
visual_regression(skeleton, atlas, baselineDir: "baseline/walk", animation: "walk",
                  times: [0, 0.25, 0.5, 0.75], mode: "update")
```

**Gate a change:**
```
skeleton_diff(from: baselineExport, to: newExport)
visual_regression(skeleton, atlas, baselineDir: "baseline/walk", animation: "walk",
                  times: [0, 0.25, 0.5, 0.75], diffDir: "regression/walk")
```

## Diagnosing a blank or wrong render

`render_preview` reports per-frame pixel coverage precisely so "it rendered nothing" is detectable.

| Symptom | Cause |
|---|---|
| Coverage 0 on every frame | The atlas regions do not match the attachment names. Run `skeleton_inspect` with the atlas. |
| `CLI_FAILED` mentioning a region or attachment | Same cause, surfaced by the runtime's attachment loader. |
| `DEPENDENCY_MISSING` | playwright-core is missing, or Chromium is not installed (`npx playwright install chromium`). |
| Dark halos around edges | Premultiplied alpha mismatch. Check the atlas `pma` flag against `premultipliedAlpha`. |
| A shader compilation failure | A forced GL backend. The launcher deliberately passes no `--use-gl` override; headless Chromium's default software path works. |
| Frames identical across times | The animation may genuinely be static, or the sample times all fall before its first keyframe. |
