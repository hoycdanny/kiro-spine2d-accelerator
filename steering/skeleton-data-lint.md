# Skeleton Data Lint Steering
<!-- File Purpose / 本檔案用途: 匯出骨架資料的檢視與稽核指引，涵蓋 lint 規則家族、嚴重度判讀、預算設定與 CI gate 用法。 -->

> **Context**: For AI assistants auditing exported Spine data. Everything here reads files
> directly: no Spine installation or license is required.

## Role and Purpose

An export can succeed and still be broken. The data layer exists to make that detectable before an
artist is told "it works on my machine": structural invariants the runtimes rely on, team naming
conventions, complexity budgets, and the atlas pairing that the skeleton JSON alone cannot reveal.

## Standard audit flow

```
skeleton_inspect (with atlas) → skeleton_lint (with atlas) → report by severity
```

Always pass the atlas. The most valuable single check in this Power is the cross-check between the
regions a skeleton needs and the regions an atlas provides, because a missing region renders as
*nothing* — no error, no warning, just an invisible character.

## Rule families

| Family | Catches |
|---|---|
| `structure/*` | More than one root bone, parents referenced but never declared, duplicate bone or slot names, slots bound to missing bones |
| `naming/*` | Bone, slot, skin, animation, event and attachment names against a team pattern |
| `skins/*` | No default skin, slots no skin provides an attachment for, slots with no attachments at all |
| `animation/*` | Animations with no timelines, timelines with zero duration, duration outliers against the median |
| `budget/*` | Bone count, hierarchy depth, slot count, per-mesh and total mesh vertices, animation duration, timelines per animation, atlas pages, packing efficiency |
| `export/*` | Missing nonessential data, missing hash, missing Spine version |
| `atlas/*` | Regions the skeleton needs but the atlas lacks, unused regions, duplicate region names, mixed premultiplied alpha, PMA disagreeing with the runtime, non power-of-two pages |

## Reading severities

- **error** — the data is wrong, or will not load, or will render nothing. Act on these.
- **warning** — a real risk, or a budget overrun. Decide deliberately.
- **info** — context. `skins/slot-without-attachment` is often correct for slots driven by
  attachment timelines.

`failOn` controls the gate: `error` by default, `warning` for a stricter pipeline. A failed gate
comes back as `GATE_FAILED` with the findings in the details, so CI can branch on it without
parsing text.

## Interpreting the findings that need judgement

**`structure/root-bone`** — exactly one root is expected. More than one usually means a truncated
export or hand-edited data; it is an error because the runtimes assume a single root.

**`export/nonessential-missing`** — not a defect for a shipping export. It *is* a defect when the
data is meant to round-trip into Spine. Ask which case it is before recommending a re-export.

**`animation/duration-outlier`** — the common cause is a stray keyframe far out on the timeline,
which is worth a look even when the duration is intentional.

**`budget/*`** — these are team choices, not Spine limits. The defaults in
`templates/lint-rules/budgets.json` are a starting point; mobile targets usually tighten mesh
vertex and atlas page budgets. Raise a budget deliberately rather than disabling the rule.

**`atlas/unused-region`** — harmless when the atlas is shared between skeletons. Wasted texture
space when it is not. Ask which.

**`naming/*`** — the default pattern is kebab-case with optional slash namespaces, matching Spine's
own example projects (`front-upper-arm`, `blue/pelvis`). Generated rigs use underscores, so
`psd_to_skeleton` turns the bone, slot and attachment naming rules off for its own output. If a team
uses a different convention, change the pattern rather than suppressing the rule.

## Configuring rules

Pass `rules` with one or more files, applied in order over the built-in defaults:

```
skeleton_lint(input: "export/hero.json", atlas: "export/hero.atlas",
              rules: ["templates/lint-rules/naming.json", "team/budgets.json"],
              failOn: "warning")
```

`naming.json` and `budgets.json` in `templates/lint-rules/` are exact copies of the built-in
defaults, so they are a safe starting point for a team file. `disabled` takes rule ids.

Naming patterns are regular expressions and are validated before use: patterns longer than 200
characters, or that nest a quantifier directly around a single quantified atom (`(a+)+`), are
rejected with a finding rather than risking catastrophic backtracking.

## What `skeleton_inspect` reports, and why each field is there

- **Bones**: count, root count, max depth, the deepest chain, missing parents, duplicates. Depth
  matters because every level compounds floating-point error and per-frame work.
- **Slots**: count, how many have a setup-pose attachment, non-default blend modes, dangling bone
  references. Slot order is draw order.
- **Skins**: names, whether `default` exists, attachment count per skin, slots no skin covers.
- **Attachments**: count by type, how many are retargeted via `name`/`path`, every mesh with its
  vertex and triangle count and whether it is weighted, and the region keys the skeleton needs.
- **Constraints**: IK, transform, path and physics by name.
- **Events**: names, and how many carry audio.
- **Animations**: duration, timeline count, keyframe count, timelines per group, animated bones,
  event count.
- **Nonessential markers**: which ones were found, which is what decides round-trip capability.

## Comparing two exports

`skeleton_diff` answers "what did the artist change": bones added, removed or reparented; slots
added, removed, rebound or reordered; attachments retargeted; constraints and events; and per
animation, duration, timeline and keyframe changes plus which bones it gained or lost.

It also separates two things that look the same in a text diff:

- **The hash changed but nothing semantic did.** A re-export can do that on its own. Say so.
- **The exporting Spine version changed.** That means the runtime needs updating too.

Run the diff *before* a visual regression. A semantic diff explains what changed; pixels only show
that something did.

## Reporting

Group by severity, lead with errors, and give each finding its fix. When the fix belongs in the
editor — a duplicate bone name, a missing attachment — say that explicitly instead of offering to
edit the exported JSON. Hand-editing exported data desynchronises it from the project, which is a
worse problem than the one being fixed.
