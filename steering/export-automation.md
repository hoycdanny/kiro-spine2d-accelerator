# Export Automation Steering
<!-- File Purpose / 本檔案用途: Spine 資料匯出自動化指引，涵蓋 export settings 範本差異法、批次匯出、CLI 參數與常見陷阱。 -->

> **Context**: For AI assistants automating Spine data export. Every tool named here requires a
> licensed Spine; the trial cannot export.

## Role and Purpose

Export turns a `.spine` project into data a runtime can load. It is the single most repeated
operation in a Spine pipeline, and the one where a wrong setting is least visible: the files appear,
and the problem shows up as missing attachments or wrong colours much later.

This guide covers choosing a format, building settings files safely, batching, and the traps.

## Standard export flow

```
spine_env_probe → export_settings_build → spine_export (or spine_batch) → skeleton_lint
```

1. **Probe.** `spine_env_probe`. On a trial, stop and report the blocked operations with the command
   line that would have run.
2. **Build settings.** `export_settings_build` from a template, overriding `output`.
3. **Export.** `spine_export` for one project; `spine_batch` for several, which pays the editor
   startup cost once instead of per project.
4. **Lint.** `skeleton_lint` with the atlas. An export that "succeeded" can still be missing regions.

## JSON or binary

| | JSON | Binary (`.skel`) |
|---|---|---|
| Size | Much larger | Much smaller |
| Load time | Slower | Much faster |
| Human readable | Yes | No |
| Tooling | Easy to parse and diff | Needs a binary reader |

Recommend **binary for shipping, JSON for audits and tooling**. The data-layer tools here read JSON,
so a project shipping binary should also export JSON when an audit is wanted.

## Export settings: the template-diff rule

The export dialog is documented; the **field names of the settings JSON it saves are not**. So:

- Never author an export settings file from first principles.
- Start from a template in `templates/export-settings/` and apply a narrow diff.
- `export_settings_build` **refuses override keys the template does not already contain**, because
  Spine silently ignores unknown keys — a typo would otherwise produce a file that looks right and
  exports wrong.
- Calibrate the templates against reality with `spine_export_settings_capture`
  (`--last-export-settings`), which writes out the settings a real project last used. Replace the
  template field names with the captured ones, then re-run the tests.

Until a template has been calibrated, treat its output as a draft: run one real export and confirm
the artifacts before wiring it into CI.

## CLI parameters that matter

| Parameter | Why it matters |
|---|---|
| `-i` / `--input` | A project, a data file, or a **folder**. Overrides the settings file. |
| `-o` / `--output` | A file or folder. Overrides the settings file. This is what makes one template reusable across projects. |
| `-e` / `--export` | A settings file path, or `json`, `binary`, `json+pack`, `binary+pack`. |
| `-m` / `--clean` | Animation clean up for the **exported data only**; the project is untouched. |
| `--clean-all` | The same, for every export in the invocation. |
| `--update <version>` | Pins the editor version. Always pass it in CI. |
| `--last-export-settings` | Writes out a project's real export settings. |

Several commands can be chained into one invocation; `spine_batch` does this.

## Traps

**1. The `+pack` shorthands ignore `pack.json`.**
`-e json+pack` and `-e binary+pack` use Spine's default settings and the "Attachments" source mode,
which does not read `pack.json` files at all. When per-folder pack settings matter, pass a real
settings file, or pack separately with `spine_pack`.

**2. A shorthand carries no paths.**
`-e binary` has no input or output of its own, so `input` is required. A settings file can carry
both, which is why `output` is optional when one is used.

**3. Animation clean up removes keys identical to the setup pose.**
That is usually what you want for shipping. It is *not* what you want when the runtime relies on an
explicit key to return to the setup pose, and the spine-unity guide recommends keeping it off while
learning. Default to off, and only enable it deliberately.

**4. Nonessential data decides whether a round trip is possible.**
Off: smaller files, and the data cannot be imported back into Spine without losing information.
On: required when the data needs to return to the editor, or when a tool needs mesh edges.

**5. `spine_cleanup` is not the same as `clean: true`.**
`spine_cleanup` (`-i -m`) rewrites and saves the **project file**, with no undo outside version
control, and requires `confirm: true`. `spine_export` with `clean: true` only affects the exported
data.

**6. A running editor hangs the CLI.**
Verified: the launcher forwards the request to the open editor and never returns. Close the editor.

## Batch export

```
spine_batch(commands: [
  { kind: "export", input: "art/hero.spine",  output: "build/spine", exportSpec: "export/unity.export.json" },
  { kind: "export", input: "art/boss.spine",  output: "build/spine", exportSpec: "export/unity.export.json" },
  { kind: "pack",   input: "art/images",      output: "build/atlas", packSpec: "export/pack.json", projects: ["art/hero.spine"] }
], update: "4.2.xx", cleanAll: false)
```

Capabilities are checked for the **whole batch** up front, so a batch containing one blocked
operation is refused as a whole rather than half-executed.

## Error handling

| Symptom | Cause and action |
|---|---|
| `CAPABILITY_DENIED` | Trial edition. Report the blocked operations and the prepared command line. |
| `CLI_TIMEOUT` | A Spine editor window is open, or the project is genuinely large. Close the editor; otherwise raise `timeoutSeconds`. |
| `CLI_FAILED` with a non-zero exit | Spine rejected the command. The printed command line can be re-run manually to see the full output. |
| Exit code 0 but no `Complete.` | Spine started but did not report finishing. Treat as suspect and check the artifacts. |
| `INPUT_MISSING` on the export spec | A settings file path that does not exist; the hint lists the shorthands as an alternative. |
| `PATH_NOT_ALLOWED` | The output path is outside the workspace. Writes are confined there on purpose. |

## Reporting

After an export, tell the developer: which projects were exported, where the artifacts landed, the
lint result, and any setting worth questioning (nonessential off, clean-up on, a `+pack` shorthand
that ignored `pack.json`).
