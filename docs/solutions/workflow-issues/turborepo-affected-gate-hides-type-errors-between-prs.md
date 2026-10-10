---
module: CI / Turborepo affected-gating
date: 2026-06-25
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "A PR merges origin/main and the merge expands the Turborepo affected set to include an app the PR never touched"
  - "CI fails on build/lint/typecheck of a project the PR's diff did not modify"
  - "The error is a Cannot-find-name / implicit-any cascade on a symbol that looks recently renamed elsewhere"
symptoms:
  - "CI fails on build (@forge/web) / lint (@forge/web) right after a main-merge on a PR that only touched another app"
  - "apps/web/src/lib/content.ts -> error TS2552 Cannot find name AdminVideoShellRaw"
tags:
  - turborepo
  - affected-gating
  - monorepo
  - ci
  - main-merge
  - typecheck
  - cross-file-rename
  - pre-existing-breakage
---

# Affected-gated CI hides latent type errors on main; a main-merge surfaces them in an unrelated PR

## Context

This is a pnpm + Turborepo monorepo. CI builds/lints/typechecks each project gated
by an **affected set**: only projects whose files a PR's diff touches are re-checked.
That is efficient, but it creates a blind spot — a latent compile/type error can land
on `main` and sit there **green** as long as no later PR's affected set re-checks that
project.

Merging `main` into a feature branch can **expand** the PR's affected set to include
projects the PR never touched. When that happens, the merging PR's CI becomes the first
to re-check a previously-skipped project, and it fails on a **pre-existing** bug it did
not introduce.

Concrete instance: a TV-app perf PR (`#1365`, branch `perf/tv-android-optimizations`)
that only changed `apps/tv` merged `main` to resolve conflicts. CI then failed on
`build (@forge/web)` and `lint (@forge/web)`:

```
apps/web/src/lib/content.ts(1589,14): error TS2552:
  Cannot find name 'AdminVideoShellRaw'. Did you mean 'AdminVideoRaw'?
apps/web/src/lib/content.ts(1599,33): error TS7006:
  Parameter 'relation' implicitly has an 'any' type.
```

A prior PR (`#1358`) had renamed the type `AdminVideoShellRaw` -> `AdminVideoRaw`
across `content.ts` (removed the `type AdminVideoShellRaw = ...` definition, updated
most references) but missed one: the param annotation at line 1589. That stale
reference reached `main` while `main` stayed green — `@forge/web` was simply not
re-typechecked by any intervening PR. The TV PR's main-merge pulled `@forge/web` into
its affected set, so it was the first run to typecheck web after the regression, and it
surfaced the error.

## Guidance

When CI fails on a file or app your PR never touched, **right after a merge**, confirm
pre-existing vs. merge-introduced **before** assuming your merge resolution is at fault:

1. Confirm your branch never edited the failing file:
   ```bash
   git log --oneline <merge-base>..<your-head> -- apps/web/src/lib/content.ts
   # empty output -> your branch did not touch it
   ```
2. Check whether the broken symbol exists on the base branch:
   ```bash
   git grep -n "AdminVideoShellRaw" origin/main
   # appears at a USE site but no DEFINITION anywhere -> latent bug already on main
   ```
3. Sanity-check that main's recent CI was affected-green, not whole-repo green:
   ```bash
   gh run list --branch main --limit 4   # green runs that didn't re-check this project
   ```

If the symbol is used-but-undefined on `origin/main` and your branch never touched the
file, the bug predates your merge. Then:

- **If you own the affected app**, apply the one-line correction. It also un-breaks
  `main` once your PR merges. (Here: `AdminVideoShellRaw["parents"]` ->
  `AdminVideoRaw["parents"]`, matching the call site `mergeParentRelationsShellAndCopy(shell.parents, ...)`
  where `shell: AdminVideoRaw`. The implicit-any cascade at `:1599` clears with it.)
- **If you don't own it**, open a tracking issue and hand it off.
- **Do not revert your merge** — the merge is correct; the bug is older than it.

Verify scoped to the package before pushing:

```bash
pnpm --filter @forge/web exec tsc --noEmit   # clean
```

## Why This Matters

- **"main is green" is not a whole-repo compile guarantee.** Under affected-gating it
  means only that the projects re-checked by _recent_ PRs compile. A project nobody has
  re-checked since a regression can be broken and still show green.
- **Blame misattribution wastes time.** Without the `git grep` + `git log` check, the
  engineer who merged `main` assumes their resolution caused it — and may revert a
  correct merge or chase a phantom conflict.
- **Latent breakage compounds.** The longer the stale reference sits on `main`, the more
  PRs that merge `main` will hit it, each needing the same fix before their CI can pass.
- **Cross-file renames are the classic seed.** A symbol renamed at its definition and
  most references but missed at one reference (commonly a _type position_ an
  IDE rename-symbol didn't reach) lands a used-but-undefined symbol. Whether the
  renaming PR's check slipped or a later affected-gate simply never re-ran that project,
  the result is the same: it waits on `main` for a merge to surface it. After a rename,
  grep the old name repo-wide (`git grep <OldName>`) rather than trusting the IDE.

## When to Apply

Run this diagnosis whenever **all** of these hold:

- CI fails on a project your PR's diff does not touch, and only after a
  `Merge branch 'main'` commit appears in your history.
- The error is a "Cannot find name" / "implicitly has any type" cascade on a symbol
  that looks recently renamed elsewhere.
- The repo uses Turborepo, Nx, or any pipeline with `--filter` / `--affected` / task-graph pruning.

Do **not** assume your merge resolution is at fault before running the three-command check.

## Examples

```bash
# 1. Did my branch touch content.ts? (base..head, scoped to the file)
git log --oneline d95bcbff..HEAD -- apps/web/src/lib/content.ts
# -> (empty) — not my change

# 2. Is the symbol defined on main, or only used?
git grep -n "AdminVideoShellRaw" origin/main
# -> content.ts:1589: relations: AdminVideoShellRaw["parents"]   (used)
# -> (no definition line anywhere)                                (undefined -> latent)

# 3. main CI history — green, but affected-gated
gh run list --branch main --limit 4
```

```typescript
// apps/web/src/lib/content.ts — the one-line fix
// Before (stale ref left by #1358's partial rename; type no longer defined):
function mergeParentRelationsShellAndCopy(
  relations: AdminVideoShellRaw["parents"],
// After (matches the renamed type and the call site's `shell: AdminVideoRaw`):
function mergeParentRelationsShellAndCopy(
  relations: AdminVideoRaw["parents"],
```

## Related learnings

- `docs/solutions/build-errors/ts-source-package-js-extension-bundler-vs-nodenext-20260610.md`
  — same affected-gating detection gap (a shared-package change breaks consumer apps the
  breaking PR didn't re-check); different root cause (`.js` extension vs. partial rename).
  Its "Detection gap" note and this doc's `git grep origin/main` recipe are the same move.
- `docs/solutions/workflow-issues/new-app-package-name-must-be-forge-scoped-for-ci.md`
  — the affected-filter mechanism itself (`@forge/`-scope predicate) and the
  "green check that never ran = false confidence" framing.
