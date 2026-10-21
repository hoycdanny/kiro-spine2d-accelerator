# Version Compatibility Steering
<!-- File Purpose / 本檔案用途: 編輯器與 runtime 版本對齊、--update 版本鎖定、升級流程與版本不符的診斷。 -->

> **Context**: For AI assistants dealing with Spine version mismatches. This is the most common
> cause of "it worked yesterday" in a Spine pipeline.

## Role and Purpose

Spine's editor and runtimes are versioned together. Data exported by a 4.2 editor needs a 4.2
runtime, and the runtimes enforce it: a mismatched major.minor is refused at load time rather than
rendering incorrectly. Patch versions within a major.minor are compatible.

## The rules

1. **Editor major.minor must equal runtime major.minor.** 4.2.37 data works with any 4.2.x runtime.
2. **`spine-runtimes` ships one branch per version line** — `4.0`, `4.1`, `4.2`, `4.3`, `5.0`. Check
   out the branch that matches the editor, not `main`.
3. **Upgrading the runtime means re-exporting every project.** That is why the `.spine` projects
   must be kept: they are the only thing that can produce 4.3 data from a 4.2 project.
4. **Upgrading the editor is one-way per project.** A newer editor can open an older project, but
   the reverse is not supported; exporting to an older data version is a partial-recovery measure
   that loses data and warns about it.

## Pinning the editor in automation

The Spine launcher can update itself, which quietly changes the output of a pipeline that was green
yesterday. Pass `--update` on every CLI invocation:

| Value | Meaning | Use |
|---|---|---|
| `4.2.37` | Exactly that build | Most reproducible |
| `4.2.xx` | Latest patch of 4.2 | Good CI default: bug fixes, no data-format change |
| `stable` / `latest` | Latest stable | Avoid in CI |
| `latestbeta` / `beta` | Latest beta | Development only |

`spine_env_probe` reports `requestedVersion` from `version.txt` and warns when it is a channel
rather than a concrete version, because a channel means the editor build can change between runs.

`--ignore-unknown` lets an older launcher forward parameters it does not recognise to a newer
editor build. Use it only when a parameter is rejected by the launcher but known to the editor.

## This Power's baseline

The data baseline is **4.2**, because that is where runtime coverage is complete across platforms.
The local editor may be newer — `spine_env_probe` reports both and warns on divergence. For exports
consumed by 4.2 runtimes, pass `update: "4.2.xx"` even when the installed editor is 4.3.

## Diagnosing a mismatch

| Symptom | Cause |
|---|---|
| The runtime refuses to load the data, citing a version | Editor and runtime major.minor differ. Re-export, or change the runtime branch. |
| Unity refuses the import | Same, or the file extension is wrong (`.atlas` instead of `.atlas.txt`, `.skel` instead of `.skel.bytes`). |
| A field the runtime expects is absent | Timeline fields were renamed between versions. Re-export from the matching editor rather than patching the data. |
| Physics constraints do nothing | Physics arrived in 4.2. A 4.1 runtime ignores them. |
| CI output changed with no commit | The launcher updated itself. Pin `--update`. |

## Where versions are visible

- `skeleton.spine` in exported JSON — the editor that produced the data. `skeleton_inspect`
  surfaces it; `skeleton_diff` flags a change between two exports.
- `spine.log` in the user data directory — the launcher and editor versions that last ran, and
  whether it was a trial build. This is what `spine_env_probe` reads.
- `version.txt` in the user data directory — the version channel the launcher is pinned to.
- `runtime_scaffold` reports the required `spine-runtimes` branch per target and blocks when the
  data records no version at all.

## Upgrade checklist

When a developer wants to move from 4.2 to 4.3:

1. Confirm every `.spine` project is in version control.
2. Install the new editor; keep the old one available until the move is finished.
3. Re-export every project with `--update 4.3.xx` through `spine_batch`.
4. `skeleton_diff` old against new. Expect a hash change; investigate anything semantic.
5. Switch the runtime to the matching branch and update the package version.
6. Re-run `skeleton_lint`, then rebuild visual regression baselines — they are bound to the
   skeleton hash, so they will correctly refuse to compare across the upgrade.
