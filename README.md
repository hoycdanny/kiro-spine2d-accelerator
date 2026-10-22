# kiro-spine2d-accelerator

A Kiro Power for Spine 2D asset work: inspect and lint exported skeleton data, generate texture
packer settings, batch export through the Spine CLI, build a rig from a layered PSD, render
animations headlessly, catch visual regressions, and scaffold runtime integration for Unity, web
and Godot.

[繁體中文](README_ZH.md) · [简体中文](README_CN.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

## Why this exists, and what shapes it

**Spine has no in-editor API.** Its only official automation surface is the command line interface,
which starts a *separate* Spine process, performs a whole-file operation, and exits. You cannot
drive an open editor window, add a bone, or select a slot.

So this Power puts its value where value is actually available:

- **CLI orchestration** — export, pack, unpack, import, clean-up, batched into single invocations,
  with editor version pinning
- **A deterministic data layer** — parse, inspect, lint and diff exported skeleton and atlas data in
  code, rather than having a model edit JSON
- **Generation** — a layered PSD to an importable rig, bypassing the editor entirely
- **Verification** — headless rendering and pixel regression that CI can gate on
- **Integration** — the per-runtime file naming rules and glue code that silently break imports

Two behaviours verified on a real install that the tooling now handles explicitly:

1. **A running Spine editor hangs the CLI.** The launcher hands the request to the open instance,
   prints `Started.`, and never returns. Every CLI tool here has a timeout and reports this case.
2. **The trial blocks every write.** Saving, texture packing and all exports are disabled. Write
   tools check the edition first and refuse with the exact command line they would have run.

## Try it in two minutes

```bash
npm install
npm run build
npm run demo
```

A scripted run that drives the real server over stdio and narrates itself: PSD to rig, audit,
render, baseline, a deliberately broken atlas caught with a diff image, Unity scaffold, and the
licensing boundary. Safe on a trial license, writes only into `demo/out/`.

See [`demo/README.md`](demo/README.md) for what to say at each step
([繁體中文](demo/README_ZH.md) · [简体中文](demo/README_CN.md) · [日本語](demo/README_JP.md) · [한국어](demo/README_KR.md)).

## Install

```bash
npm install
npm run build

# optional — PSD to rig generation
uv sync --project python

# optional — headless preview and visual regression
npx playwright install chromium
```

Register the server with the MCP client (`mcp.json`):

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["./dist/server.js"],
      "transport": "stdio"
    }
  }
}
```

The server speaks stdio and opens no network port, so there is no listening surface to
authenticate.

| Environment variable | Purpose |
|---|---|
| `SPINE_EXECUTABLE` | Explicit Spine CLI path. On Windows this must be the `.com` build, which returns an exit code. |
| `SPINE_USER_DATA` | Explicit Spine user data directory (`spine.log`, `version.txt`, `examples/`). |
| `SPINE_WORKSPACE_ROOT` | Write-confinement root. Defaults to the working directory. |

## Tools

### CLI orchestration

| Tool | Needs a license |
|---|---|
| `spine_env_probe` — edition, version, capability matrix, runtime branch, sidecar state | no |
| `spine_project_info` — Spine version, skeleton and animation counts | no |
| `spine_export` — export skeleton data | yes |
| `spine_pack` / `spine_unpack` — texture atlas packing | yes |
| `spine_import` — import data into a `.spine` project | yes |
| `spine_cleanup` — animation clean up, saves the project; needs `confirm: true` | yes |
| `spine_export_settings_capture` — write out a project's real export settings | no |
| `spine_batch` — several commands in one invocation | depends |

### Data layer (no Spine installation required)

| Tool | What it gives you |
|---|---|
| `skeleton_inspect` | Bones and depth, slots and blend modes, skins, attachment types, mesh vertex counts, constraints, events, animation durations and timeline counts, nonessential-data presence, and an optional atlas cross-check |
| `atlas_inspect` | Pages, formats, filters, premultiplied alpha, rotated and stripped regions, packing efficiency, duplicates, non power-of-two pages |
| `skeleton_diff` | Semantic diff of two exports, separating "the hash changed" from "the data changed" |
| `skeleton_lint` | Structural invariants, naming, budgets, export settings and atlas problems, each with a fix. Gates CI |
| `export_settings_build` | Export settings by template diff, refusing unknown keys |
| `pack_settings_build` | `pack.json` with every documented field validated |

### Generation, verification, integration

| Tool | What it does |
|---|---|
| `psd_to_skeleton` | Layered PSD to skeleton JSON + atlas + page image, then inspect and lint it |
| `skeleton_animate` | Generate `idle`, `walk`, `wave`, `jump` or `turn_head` into an exported rig, writing a second JSON file. A rig missing a required bone fails with the bones it does have rather than substituting one. This is mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it |
| `render_preview` | Render animation frames with spine-ts in headless Chromium |
| `visual_regression` | Compare against baselines, write diffs, gate on failure |
| `preview_export_html` | One self-contained HTML file that plays the skeleton in any browser, with play/pause, a timeline scrub, an animation selector, speed and debug bones. Runtime, skeleton, atlas and page images embedded — no server, nothing fetched. Distributing it needs your own Spine license |
| `skeleton_document` | Write a `.spine-doc.md` and `.spine-doc.json` saying what a rig does: hierarchy with world transforms, constraints resolved per bone from the data, per-bone influence measured by re-rendering, and a motion profile per animation. Records a content fingerprint, because `skeleton.hash` alone does not detect change |
| `runtime_scaffold` | Per-target file naming, controller code with a mix table, and a README |

## A walk through

```
spine_env_probe                       # what can this machine actually do?
skeleton_inspect  input, atlas        # what is in the data, and does the atlas cover it?
skeleton_lint     input, atlas        # is it correct, by team rules and budgets?
render_preview    skeleton, atlas     # does it render?
visual_regression skeleton, atlas     # does it still look the same?
preview_export_html skeleton, atlas   # one file a client opens, no server
runtime_scaffold  target=unity        # what does the engine need?
```

Everything above works on a trial license. Export, pack and import need a purchased one.

## CI

`templates/ci/` ships a GitHub Actions workflow and a PowerShell script, and `dist/ci-cli.js`
exposes the same gates as subcommands:

```bash
node dist/ci-cli.js lint       --export-dir export --fail-on error
node dist/ci-cli.js regression --export-dir export --baseline-dir baseline --diff-dir diff
node dist/ci-cli.js export     --projects-dir art --out-dir export --update 4.2.xx
node dist/ci-cli.js diff       --from old.json --to new.json
```

Exit codes: 0 pass, 1 gate failed, 2 usage or operational error. The default CI shape assumes the
exported artifacts are committed, so the runner needs no license — see `steering/ci-pipeline.md`.

## Repository layout

```
POWER.md              the Power definition: architecture, behaviours, tool surface, workflows
steering/             13 domain guides the AI reads before acting
templates/            export-settings, pack-settings, lint-rules, ci
hooks/                prompt-submit hook that activates the Power
src/                  the execution layer (TypeScript, stdio MCP server)
python/               PSD to rig sidecar (uv, psd-tools, Pillow, rectpack)
tests/                unit, property and integration tests
```

## Development

```bash
npm run typecheck
npm test                      # 559 tests
npm run test:unit
npm run test:integration      # exercises the real Spine CLI and real Chromium when present
uv run --project python pytest   # 66 tests
```

Integration tests skip themselves when Spine or Chromium is absent, so the suite stays green on a
bare machine. The opt-in `SPINE_CLI_LIVE=1` tier additionally requires every Spine editor window to
be closed.

## Honest status

| Verified against the real thing | How |
|---|---|
| Trial detection, capability matrix, CLI `--version` | A real Spine 4.3.26 Trial install |
| The editor-handoff hang | Reproduced, then encoded as a timeout with a specific hint |
| Headless rendering, determinism, regression detection | Real headless Chromium |
| PSD to skeleton + atlas | A real PSD file built with psd-tools |
| Python sidecar bridge | A real `uv run` round trip |

| Not yet verified | Why |
|---|---|
| Export / pack / import / clean-up succeeding | No licensed editor available here. The command lines are assembled, gated and unit-tested, but no successful licensed run has been observed. |
| Export settings field names | Not publicly documented. The templates are shaped from the documented dialog; calibrate with `spine_export_settings_capture`. `pack.json` has no such gap. |
| Binary `.skel` parsing | Out of scope for now; the data layer reads JSON exports. |
| Godot integration | The naming rules and install paths come from Esoteric's docs; not run against a Godot project. |

## License

MIT. See [LICENSE](LICENSE).

Spine itself is commercial software by Esoteric Software, and the Spine Runtimes carry their own
license: every user of software that integrates them needs their own Spine license. This Power
neither bundles nor redistributes Spine, its runtimes, or its example assets.

A Spine editor license is required at the time the Spine Runtimes are integrated into a product,
and after that the product may continue to be distributed even if the license later expires.
Integrating the Runtimes into a development tool, SDK or library free of charge is explicitly
allowed, but every user of that tool needs their own Spine license. A Spine license is needed to
distribute any software containing the Spine Runtimes, even when the Spine editor itself is not
used. This repository installs `@esotericsoftware/spine-webgl` from npm as an optional dependency
and vendors no Spine code; the HTML file `preview_export_html` writes embeds that runtime, so
distributing that file needs your own license. See https://esotericsoftware.com/spine-purchase.
