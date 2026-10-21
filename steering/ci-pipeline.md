# CI Pipeline Steering
<!-- File Purpose / 本檔案用途: Spine 資產進 CI 的指引，涵蓋版本鎖定、無頭環境限制、gate 設計與授權在 CI 的前置條件。 -->

> **Context**: For AI assistants putting Spine asset work into continuous integration.

## Role and Purpose

A Spine pipeline in CI exists to answer one question on every change: *is the exported data still
correct, and does it still look the same?* This guide covers what can and cannot run on a runner,
and how to shape the gates.

## What runs on a runner, and what does not

| Operation | On CI |
|---|---|
| Data export (`-e json` / `binary`) | **Yes.** Headless. |
| Texture packing (`-p`) | **Yes.** Headless. |
| Project info (`-i`) | Yes. |
| Import, clean-up | Yes, though both write and are rarely wanted in CI. |
| Image / video export | **No.** Needs an OS windowing system and OpenGL. |
| Data layer (inspect, lint, diff, settings) | Yes. No Spine installation needed. |
| PSD generation | Yes, with uv and the Python dependencies. |
| Headless preview / visual regression | Yes, with Chromium. This is why that path exists. |

So: export data and pack atlases with Spine; verify visually with the headless renderer.

## Licensing in CI

Every write operation needs a licensed Spine on the runner. That means an installed editor and an
activated license, which is a per-organisation decision — a license is per-seat, and a CI runner
counts. Options, in rough order of how often they are chosen:

1. **Export locally, commit the artifacts.** CI then only lints, diffs and renders — no license
   needed on the runner. Simplest, and sufficient for most teams.
2. **A self-hosted runner with a licensed editor.** Needed when CI must re-export.
3. **Data-layer-only CI.** No Spine at all; gate on lint and regression of committed artifacts.

Recommend option 1 unless the developer specifically needs re-export in CI, and raise the licensing
question explicitly rather than writing a workflow that will fail on activation.

## Pin the editor version

The launcher updates itself. In CI, always pass `--update` with a concrete version or a patch
wildcard (`4.2.xx`). Without it, the same commit produces different output next month.

## Gate design

Two tools return `GATE_FAILED`, which makes them usable directly:

| Gate | Tool | Fails when |
|---|---|---|
| Data correctness | `skeleton_lint` | Any finding reaches `failOn` (default `error`) |
| Visual stability | `visual_regression` | A frame moves beyond the thresholds, or the baseline no longer describes the data |

Suggested policy:

- **Pull requests**: lint with `failOn: "error"`, regression in `check` mode. Upload diff images as
  artifacts so a reviewer can look.
- **Main branch**: the same, plus `failOn: "warning"` if the team has agreed its budgets.
- **Baseline updates**: never automatic. A regression failure is a question for a human; an
  auto-updating baseline verifies nothing.

## Repository layout that works

```
art/                 .spine projects — the only lossless source
export/              committed exported data (json/skel, atlas, png)
baseline/<anim>/     one baseline directory per animation, plus baseline.json
templates/           export-settings, pack-settings, lint-rules
.agents/ or ci/      the workflow and scripts
```

Commit the exported artifacts when CI has no license. Commit the baselines either way: they are
small PNGs and they are the record of how the game looked.

## Caching

- `node_modules` by lockfile hash.
- The Chromium build for Playwright by version — re-downloading it per run is slower than the rest
  of the pipeline combined.
- The uv environment for the PSD sidecar, if that path runs in CI.
- Do **not** cache the Spine editor install across version changes; that defeats `--update`.

## Templates

`templates/ci/` ships a GitHub Actions workflow and a PowerShell script. Both default to the
no-license shape — lint and regression over committed artifacts — with the export steps present but
commented, since they need an activated editor.

Point the developer at the comments rather than silently enabling steps that cannot pass.

## Reporting from CI

A failing gate should leave behind enough to act on without re-running locally:

- The lint findings, with severities and fixes
- The regression diff images
- The semantic `skeleton_diff` between the committed artifact and the newly exported one, when CI
  re-exports

That third item is what turns "12 frames moved" into "the artist reparented the head bone".
