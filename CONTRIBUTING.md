# Contributing

## Getting set up

```bash
npm install
npm run build
npm test

# optional halves
uv sync --project python && uv run --project python pytest
npx playwright install chromium
```

The integration tests skip themselves when Spine or Chromium is absent, so a clean machine still
gets a green suite. If you have a **licensed** Spine, the tests that have never been verified
against one are the most valuable contribution available — see "Known gaps" in `POWER.md`.

## Architecture rules

These are the constraints that keep the codebase testable. Breaking one is the main thing to avoid.

1. **`src/*.ts` modules are pure.** File IO, subprocess spawning and browser control arrive as
   injected collaborators (`SpineHost`, `SpawnFn`, `BrowserLauncher`, `SidecarRunner`). A module
   that imports `node:fs` directly needs a reason, and `host.ts`, `cli-runner.ts`, `sidecar.ts`,
   `server.ts` and `ci-cli.ts` are the ones that have it.
2. **Results, not exceptions.** Tools return `SpineResult<T>`: either `ok(data, summary)` or
   `err(code, message, hint)`. Every failure carries a `hint` that says what to do next. Add a new
   code to `SpineErrorCode` rather than reusing an ill-fitting one.
3. **No shell string interpolation.** Subprocess arguments are arrays. `formatCommandLine` exists
   for display only.
4. **Reads anywhere, writes only inside the workspace.** Use `resolveReadTarget` and
   `resolveWriteTarget`; never join paths by hand for a write.
5. **Capability gate before subprocess.** Any new CLI command must be mapped in
   `COMMAND_CAPABILITY` so the trial refusal happens before the process starts.
6. **Version-agnostic data parsing.** Spine renames timeline fields between versions. The
   inspector walks the timeline tree structurally rather than matching key names; keep it that way.

## Testing expectations

- **New logic needs unit tests**, and the bar is behavioural: assert the reported numbers and
  messages, not just that a function returned something.
- **Fixtures are synthetic.** `tests/helpers/fixtures.ts` builds skeletons and atlases by hand.
  Do not add Spine's example assets to this repository; they are licensed for use with Spine, not
  for redistribution.
- **Integration tests must self-skip** when their dependency is missing.
- **Document facts with their source.** When a comment states a Spine behaviour, say where it came
  from: the official documentation, or an observed run. Several comments in this codebase record
  behaviour that is not documented anywhere else (the editor-handoff hang, the shader failure under
  a forced GL backend); that provenance is the point.

## When adding a tool

1. Implement the logic as a pure module in `src/`.
2. Add the tool in the matching `src/tools/*-tools.ts` group, with a description that explains the
   *consequences* of getting it wrong, not just the parameters.
3. Register it in `src/tools/index.ts`.
4. Add it to the expected list in `tests/integration/mcp-server.contract.test.ts`.
5. Add it to the tool table in `POWER.md` and the README.
6. Point the relevant steering file at it.

Steps 4 to 6 are enforced: `tests/unit/docs-consistency.test.ts` fails when the documentation and
the registered tools disagree.

## Documentation

`POWER.md` and `steering/*.md` are read by an AI before it acts, so they are code-adjacent rather
than marketing. Two habits that matter:

- **State the trap, not just the feature.** "`-e json+pack` ignores `pack.json`" is worth more than
  a parameter list.
- **Separate verified from unverified.** If something has not been run against the real thing, say
  so in the same breath. An overstated capability costs more than a missing one.

## Commits and pull requests

- Keep `npm run typecheck`, `npm test` and `pytest` green.
- One concern per pull request.
- Describe what you verified and how, including what you could not verify.
