# Workflow Automation Steering
<!-- File Purpose / 本檔案用途: 多步驟 Spine 工作流編排指引，涵蓋工具鏈順序、失敗處理、進度回報與批次策略。 -->

> **Context**: For AI assistants chaining several Spine operations into one outcome.

## Role and Purpose

Most real requests are compositions: "turn this PSD into something I can use in Unity" is five tools
in order. This guide covers the ordering rules that matter, where to stop on failure, and what to
report.

## Ordering rules

1. **Probe first.** `spine_env_probe` before anything that writes. It costs one process start and
   turns a confusing mid-pipeline failure into an upfront answer.
2. **Build settings before exporting.** `export_settings_build` / `pack_settings_build` produce the
   files the CLI consumes; generating them mid-export hides what was actually used.
3. **Lint after every export.** `skeleton_lint` with the atlas. This is the step that catches the
   failure mode no other step sees: a region the skeleton needs that the atlas lacks.
4. **Diff before regression.** `skeleton_diff` explains *what* changed; visual regression only shows
   *that* pixels changed.
5. **Scaffold last.** `runtime_scaffold` reads the final data, so run it after the data is settled.

## Composed workflows

**PSD to a usable Unity asset**
```
spine_env_probe
  → psd_to_skeleton            (sidecar; works on a trial)
  → spine_import               (needs a license: writes a .spine project)
  → spine_export               (settings from export_settings_build)
  → spine_pack                 (settings from pack_settings_build)
  → skeleton_lint              (with the atlas)
  → render_preview             (confirm it renders)
  → runtime_scaffold target=unity
```

**Re-export and verify**
```
spine_env_probe
  → spine_batch (export per project, update: "4.2.xx")
  → skeleton_lint per pair
  → skeleton_diff old vs new
  → visual_regression per animation
```

**Audit an inherited project**
```
spine_project_info      (what version, how many animations)
  → skeleton_inspect    (with the atlas)
  → atlas_inspect
  → skeleton_lint failOn="warning"
```

## Failure handling

Stop or continue deliberately, and say which:

| Failure | Action |
|---|---|
| `CAPABILITY_DENIED` | **Stop.** Report the blocked operations and the prepared command lines. Nothing downstream can work. |
| `CLI_TIMEOUT` | **Stop.** Ask the developer to close the Spine editor, then retry. |
| `INPUT_MISSING` / `PATH_NOT_ALLOWED` | **Stop.** An argument is wrong; fix it rather than retrying. |
| `GATE_FAILED` from lint | **Report and ask.** Some findings are deliberate; the developer decides whether to proceed. |
| `GATE_FAILED` from regression | **Report with the diff images.** Do not update the baseline without being asked. |
| `DEPENDENCY_MISSING` | **Degrade.** The PSD and preview paths are optional; everything else still works. Say what is unavailable. |
| `CLI_FAILED` on one project in a batch | Spine applies commands in order, so a batch may be partially done. Report which artifacts exist before retrying. |

Never retry the same call unchanged more than once. Every error here carries a `hint` that says
what to change.

## Batching

One Spine invocation can carry many commands, which matters because editor startup dominates a
small export. Prefer `spine_batch` over a loop of `spine_export` whenever more than two projects
are involved.

Capabilities are checked for the whole batch before anything runs, so a batch containing one blocked
operation is refused as a whole rather than half-executed.

Keep batches homogeneous enough to report on: one batch per output target, rather than one batch
mixing Unity and web exports.

## Progress and reporting

For a multi-step run, report after each step rather than only at the end — a 2 GB PSD or a cold
editor start is slow enough that silence looks like a hang.

The closing report should state:

- What was produced, with paths
- What was verified, and how (lint result, preview coverage, regression verdict)
- What was **not** verified, and why (no license, no Chromium, no real PSD)
- The next action, if the developer has to do something in the editor

That last pair matters most. This Power can prepare a licensed-only operation perfectly and still
not know whether it works; saying so is more useful than implying success.
