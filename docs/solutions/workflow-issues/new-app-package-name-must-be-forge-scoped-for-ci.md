---
title: New workspace app must be @forge/-scoped or CI silently skips it
date: 2026-06-12
category: workflow-issues
module: ci
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Scaffolding a new app or package in the pnpm + Turborepo monorepo
  - Choosing the package.json `name` for a new workspace member
  - Deciding which existing app to model a new app's lint/tsconfig/test config on
tags:
  - ci
  - turborepo
  - pnpm
  - monorepo
  - scaffolding
  - affected-filter
---

# New workspace app must be @forge/-scoped or CI silently skips it

## Context

When scaffolding a new workspace app, the `package.json` `name` field looks like a free choice. It is not — it determines whether CI runs for the app at all. The affected-package job in `.github/workflows/ci.yml` filters changed packages with a `startswith("@forge/")` predicate, so a package whose name lacks the `@forge/` scope never enters the lint / typecheck / test / build matrix. The failure is silent: CI goes green because the app was never selected, not because it passed.

This surfaced while scaffolding `apps/chat` (feat-200). It is also why `apps/roadmap` — named `"roadmap"`, with no scope — has never run in CI, and why its lint/tsconfig setup could not be trusted as a scaffold template even though it is otherwise a fine minimal app.

## Guidance

- **The package name controls CI inclusion.** A `@forge/`-scoped name opts the app into the CI matrix; an unscoped name opts it out. Scope to `@forge/<name>` whenever you want CI to run — which is almost always (`apps/chat` → `@forge/chat`, `apps/web` → `@forge/web`). Leaving it unscoped is a deliberate opt-out, and the _only_ reason `apps/roadmap` (named `"roadmap"`) has never run in CI — fine for that filesystem-only viewer, a silent footgun anywhere you actually wanted coverage.
- **Model CI-exercised config on a `@forge/`-scoped app that actually runs in CI** (e.g. `apps/web`), not on one that is invisible to CI (e.g. `apps/roadmap`). A config that has never been exercised by CI is unproven regardless of how clean it looks.
- **Corollary — `vitest run` fails on zero test files** (`"No test files found"`, non-zero exit). Combined with CI invoking `test` via `pnpm --filter <pkg> run --if-present test`, this means: if you add a `test` script before any test file exists, the first CI run for the app fails. Land the `test` script together with its first test file, not before. (An app with no `test` script at all is fine — `--if-present` skips it.)

## Why This Matters

A silently-skipped app is worse than a failing one: a red check gets fixed, but a green check that never ran gives false confidence. Broken lint, type errors, or failing tests ship undetected because the app was never in the matrix. The naming convention is the enforcement mechanism — there is no separate registration step that would catch the omission.

## When to Apply

- Creating any new `apps/*` or `packages/*` workspace member.
- Reviewing a new-app PR: confirm the `package.json` `name` is `@forge/`-scoped before trusting a green CI run as evidence the app's lint/typecheck/test/build actually pass.
- Choosing a template app to copy CI-exercised config (eslint, tsconfig, vitest, scripts) from.

## Examples

CI affected-filter (`.github/workflows/ci.yml`) — only `@forge/`-scoped packages enter the matrix:

```bash
pnpm turbo ls --affected --output=json \
  | jq 'map(select(type == "string" and startswith("@forge/")))'
```

Opted in vs. silently skipped:

```jsonc
// apps/chat/package.json — runs in CI
{ "name": "@forge/chat" }

// apps/roadmap/package.json — never runs in CI (no @forge/ scope)
{ "name": "roadmap" }
```

Test-script timing (the zero-files trap):

```jsonc
// WRONG: this `test` script in a commit with no test files fails the
// first CI run ("No test files found", non-zero exit).
{ "scripts": { "test": "vitest run" } }
// RIGHT: add the `test` script in the same commit as the first *.test.ts(x).
```

## Related

- `docs/solutions/platform/adding-new-apps.md` — the scaffold checklist for this monorepo.
- `docs/plans/2026-06-10-006-feat-chat-app-scaffold-plan.md` — the feat-200 plan whose hybrid-template decision (model CI config on `apps/web`, footprint on `apps/roadmap`) is grounded in this learning.
