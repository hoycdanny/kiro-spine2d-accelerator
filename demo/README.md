# Demo — two minutes, ten steps

[繁體中文](README_ZH.md) · [简体中文](README_CN.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

A scripted run that drives the real MCP server over stdio and narrates itself. Safe to run in
front of a client: it works on a Spine **trial**, writes only into `demo/out/`, and resets that
folder on every run.

## Run it

```bash
npm install
npm run build
npm run demo
```

Two optional dependencies make the demo complete. Without them it still runs and says what it
skipped:

```bash
uv sync --project python          # step 2, the PSD step
npx playwright install chromium   # steps 5-7, the visual steps
```

Takes about 5 seconds on a warm machine. Then open these — they are the demo:

```
demo/out/generated/images/  one loose PNG per attachment — what File -> Import Data resolves against
demo/out/preview/           four rendered frames of the animation
demo/out/regression-diff/   the diff image that caught a 3-pixel atlas shift
demo/out/preview/hero.html  double-click it: the animation plays in any browser, no server needed
```

## What to say, step by step

| Step | On screen | The line that lands |
|---|---|---|
| 1. Environment | Trial detected, seven operations blocked, Python sidecar ready | "It tells you what it cannot do *before* you waste time on it." |
| 2. PSD → rig | 20 bones, 16 attachments, 4 virtual bones (`root`, `neck`, `shoulder_left`, `shoulder_right`), `cape` skipped, plus a `generated/images/` folder of 16 loose PNGs | "Artwork in, rig out — and it never opened the Spine editor, which is why this part works on a trial. The `images/` folder next to the JSON is what makes `File -> Import Data` work; the editor resolves attachments against those files, not the atlas." |
| 3. Inspect + lint | Atlas cross-check passes; two warnings with fixes | "The cross-check is the valuable one: a region the skeleton needs but the atlas lacks renders as *nothing*, with no error anywhere." |
| 4. Animator adds movement | `+ animations: idle, wave` | "A text diff of exported JSON is unreadable. This answers the question a reviewer actually has." |
| 5. Render | 4 frames at 240×240, pixel coverage reported | "Rendered with the real Spine web runtime, headless. Coverage means 'it silently rendered nothing' is detectable." |
| 6. Baseline + check | 4/4 frames within tolerance | "This is the gate a pipeline runs on every change." |
| 7. Break it | 4/4 frames FAIL, with pixel counts and diff images | "I moved one atlas region by three pixels. The skeleton data did not change at all — only a visual check can catch that." |
| 8. Unity scaffold | `hero.atlas → hero.atlas.txt`, mix table, controller | "spine-unity cannot load a plain `.atlas`. That rule is in the tool, not in someone's head." |
| 9. Licensing | `CAPABILITY_DENIED`, with the exact command line | "On a trial it refuses — and hands you the command it would have run, so the work repeats verbatim after purchase." |
| 10. One file to hand over | `demo/out/preview/hero.html`, about 236 KB | "Double-click it. The runtime, the skeleton, the atlas and the image are inside that one file — no server, no install, nothing fetched. Drag the timeline. It does embed the Spine Runtimes, so giving it to anyone needs your own Spine license." |

## Showing it live instead

With the Power installed in Kiro, these prompts produce the same path in conversation. Run
`npm run demo` once beforehand so `demo/out/` already has the files.

```
What can my Spine setup actually do right now?

Turn demo/out/hero.psd into a Spine rig under demo/out/generated.

Audit demo/out/generated/hero.json against its atlas and tell me what is wrong.

Render four frames of the wave animation and save them.

Record a visual baseline, then check against it.

What does my Unity project need in order to use this?
```

The last one is a good closer: it answers with the required file renames, the runtime branch, and
a controller script with a mix table derived from this skeleton's own animations.

## Honest framing

Say these out loud rather than waiting to be asked:

- **The sample character is drawn by code**: every shape, outline and shade comes from the
  coordinates in `make-sample-psd.py`, with no external art asset and nothing traced from
  anyone's artwork. It is there to demonstrate the rigging rules (joint pivots, virtual bones,
  draw order), not art direction.
- **Export, pack and import need a purchased license.** Step 9 shows that boundary deliberately.
  Everything else in the demo works on a trial.
- **The rendered frames come from the Spine web runtime**, not from Spine's own image export.
  Spine's export is the authoritative visual output; this path exists so a pipeline can check
  itself without a desktop session.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `dist/server.js is missing` | `npm run build` |
| Step 2 says uv is unavailable | `uv sync --project python`, or let it synthesise a small rig instead |
| Steps 5-7 are skipped | `npx playwright install chromium` |
| The Spine editor shows a blank canvas after `File -> Import Data` | The editor resolves each attachment as `<skeleton.images>/<attachmentName>.png` relative to the imported JSON and never reads the `.atlas`. Check that `demo/out/generated/images/` sits next to `hero.json` with one PNG per attachment; re-run with `emitLooseImages` true (the default) if it is missing. A PNG you added to that folder yourself is reported in `foreignImagesKept` and left alone: only images named after a known body part are pruned |
| A step reports `CLI_TIMEOUT` | Close any open Spine editor window; the launcher hands CLI requests to a running editor and never returns |
| You want the transcript as plain text | `NO_COLOR=1 npm run demo > demo-transcript.txt` |
