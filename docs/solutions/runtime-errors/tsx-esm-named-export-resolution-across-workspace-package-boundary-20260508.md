---
title: tsx ESM static-link fails on named exports across workspace package boundary
date: 2026-05-08
last_refreshed: 2026-06-24
category: runtime-errors
module: packages/graphql
problem_type: runtime_error
component: tooling
severity: high
symptoms:
  - "SyntaxError: The requested module '@forge/admin/domain/blocks' does not provide an export named 'BlocksSchema' when running tsx scripts/capture-parity-fixture.ts"
  - "All 113 vitest tests pass, but a smoke script crashes at module load"
  - "Crash only surfaces when the import chain transitively reaches a workspace package's exports-map pointing at a raw .ts file"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - tooling
  - testing_framework
tags:
  - tsx
  - esm
  - exports-map
  - workspace-package
  - vitest-vs-tsx
  - parity-harness
  - consumer-migration
  - module-resolution
---

# tsx ESM static-link fails on named exports across workspace package boundary

> **Refresh note (2026-06-24).** The `packages/graphql` parity harness this incident occurred in has since been **removed** (Strapi→admin migration cleanup; see root `CLAUDE.md`). The harness-specific specifics below are historical, but the generalizable lesson — a raw-`.ts` workspace boundary fails differently under bare Node vs tsx vs a bundler — remains live and recurs in [mastra-dev-tsx-loader-for-raw-ts-workspace-deps](../tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md).

## Problem

Adding the first `exports` map entry to `apps/admin/package.json` (`"./domain/blocks": "./src/domain/blocks.ts"`) caused `tsx packages/graphql/scripts/capture-parity-fixture.ts` to crash at module load with a misleading `does not provide an export named 'BlocksSchema'` error. The export exists. All 113 vitest tests passed. Admin's Next.js build and `tsc --noEmit` were both green. The runtime crash hit only the tsx-driven script — and only because its transitive import chain reached `normalize-admin.ts`, which statically imports `BlocksSchema` from a `.ts` source file reached through the workspace `exports` map.

Context: this surfaced while shipping U4 of the Strapi → admin consumer migration (`apps/admin` exposed via workspace package for the first time; `packages/graphql/parity` is the consumer). Migration ownership: Urim, end-to-end (auto memory [claude]).

## Symptoms

- Hard crash at module load (before any user code runs):
  ```
  SyntaxError: The requested module '@forge/admin/domain/blocks' does not provide an export named 'BlocksSchema'
      at #asyncInstantiate (node:internal/modules/esm/module_job:319:21)
  ```
- Surfaces ONLY when invoking the script via `tsx packages/graphql/scripts/capture-parity-fixture.ts` (or any other tsx-driven entry point whose import graph transitively reaches the cross-workspace import).
- Hidden by: vitest (113/113 green, including tests that exercise the same `BlocksSchema` import via `normalize-admin`), `next build` for admin, `tsc --noEmit`, and `pnpm install`.
- The error message implies the export is missing — it is not. `grep -n 'export.*BlocksSchema' apps/admin/src/domain/blocks.ts` confirms the export.

## What Didn't Work

- **Verifying the source export.** Re-read `apps/admin/src/domain/blocks.ts` and confirmed `BlocksSchema` is exported. The error message lied about the cause.
- **Re-running `pnpm install`.** Lockfile was already in sync; no resolver state to fix.
- **Trusting the test suite.** Vitest's Vite-based resolver handles workspace `.ts` imports through a different code path. Green tests gave false confidence that the runtime entry point was fine. _(session history: "vitest hid this; tsx exposed it.")_
- **Trusting `next build` and `tsc`.** Next's bundler and TypeScript's checker each have their own resolution layers — neither validates Node's runtime ESM static-link.

## Solution

Split the parity surface so the script-level entry point does NOT pull `normalize-admin` (and therefore does NOT pull the cross-workspace `.ts` import) into its static import graph.

**New file** `packages/graphql/src/parity/live-config.ts` — pure env/URL utilities, zero `normalize-*` imports:

- `assertLiveModeEnabled` (env validation for `FORGE_PARITY_LIVE` etc.)
- `validateHost` (host blocklist check)
- `LiveModeDisabledError`, `LiveModeConfigError` (typed errors)

**Refactored** `packages/graphql/src/parity/live.ts` — keeps `runLiveComparison` and its `normalize-admin` import, but now imports `assertLiveModeEnabled` / `validateHost` / errors from `./live-config` and re-exports them so the public `@forge/graphql/parity` surface is unchanged.

**Capture script** `packages/graphql/scripts/capture-parity-fixture.ts` — switched its single import:

```ts
// Before — transitively pulls normalize-admin → BlocksSchema
import { assertLiveModeEnabled } from "../src/parity/live"

// After — flat import, zero cross-workspace path in the graph
import { assertLiveModeEnabled } from "../src/parity/live-config"
```

After the fix: capture script runs cleanly under tsx, exits 2 with the documented "wiring deferred to U5" message; tests still 113/113.

## Why This Works

> **Root-cause correction (2026-06-24 refresh).** The precise cause is the **imported package's module type**, not a tsx-transformer inconsistency. `apps/admin` has no `"type": "module"`, so Node 24 classifies its `.ts` source as **CommonJS**; an ESM importer then cannot see a CJS module's named exports through static-link, and no loader (`tsx` included) bridges that. This was pinned in [parity-harness-prod-gate-defects](../workflow-issues/parity-harness-prod-gate-defects-20260514.md) (Defect 1) six days later. The layering fix above still works because it _removes_ the cross-workspace import entirely — which is exactly why the original "transformer doesn't apply across the exports-map" framing below was never falsified at the time. The original as-diagnosed account is retained for the record:

Node's ESM `#asyncInstantiate` runs a static-link pass BEFORE any module body executes — it checks every named import resolves to a real export on the source module. tsx's loader transforms `.ts` files so named exports become visible to that static-link, but the transformer does not consistently apply across workspace `exports`-map boundaries that point at raw `.ts` source paths. When the static-link asks "does `@forge/admin/domain/blocks` export `BlocksSchema`?", it sees a module whose exports haven't been materialized by the transformer and reports the export as missing.

Vitest avoids this because Vite owns its own resolver and module graph — it never delegates to Node's ESM static-link for workspace `.ts` files. Next's build avoids it because the bundler inlines and rewrites these imports before runtime. Only `tsx` + Node's runtime ESM hits the broken seam.

The fix breaks the chain at the script entry point: `capture-parity-fixture.ts` now has zero transitive path to `normalize-admin`, so the cross-workspace `.ts` import is never reached during the script's static-link pass. The `live.ts` runtime path still imports `normalize-admin` for `runLiveComparison`, but that path is only loaded by vitest and Vite-resolved consumers — never by raw tsx invocations.

## Prevention

- **Treat tsx + workspace `exports` map pointing at raw `.ts` files as a known broken combination.** When a workspace package adds its first `exports` map entry — or any new entry pointing at a `.ts` source path — audit every `tsx`-invoked script for transitive imports that cross that boundary. Anything else added to admin's `exports` map carries the same hazard for any tsx-run script in the repo.
- **Smoke-test scripts with the actual runtime, not just the test runner.** A `pnpm tsx <script> --help`-style fast-exit invocation in CI catches static-link failures vitest cannot. For `packages/graphql`, this lives alongside `pnpm test`. The Vitest-clean status was NOT treated as sufficient on its own during U4 verification — the tsx smoke test was the gating signal that caught this. _(session history)_
- **Layer modules so the env-validation surface has zero domain imports.** `live-config.ts` (env/URL utilities, typed errors) is a stable layer below `live.ts` (orchestration with `normalize-*` imports). Scripts that only need validation import the lower layer; the public re-export from `live.ts` keeps the API stable. This is a generalizable pattern: when a script-level entry point shares a module with runtime orchestration, the script-level needs MUST live in a leaf module that doesn't import the runtime chain.
- **Distrust "export not found" messages from Node's static-link** when the export demonstrably exists. The real question is whether the loader transformer reached the source file, not whether the source file is correct. Check the loader (tsx, ts-node, swc) and the resolution path (workspace `exports`, conditional exports, `.ts` vs compiled `.js`) before re-reading the source.
- **Compile-to-`.js` is the bombproof escape hatch.** If a script must cross this boundary, point the workspace's `exports` at a built `.js` artifact instead of raw `.ts`. This eliminates the tsx-transformer-vs-static-link race entirely. Keep this in mind for U5 if the layered split ever becomes insufficient as the parity harness wires real transport.
- **Meta-pattern**: this is another worked instance of [mocked-shape-vs-real-contract-discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — vitest passed (mocked shape), tsx production-runtime contract failed. Add tsx-runnable smoke tests anywhere a `.ts` source path crosses a workspace `exports` boundary.

## Related Issues

- [`docs/solutions/best-practices/experience-embeddings-backfill-strapi-v5-tsx-compat-20260414.md`](../best-practices/experience-embeddings-backfill-strapi-v5-tsx-compat-20260414.md) — sibling tsx + module-resolution pattern (Strapi v5 CJS init ordering). Different mechanism, complementary prevention rule (smoke-run the actual script in CI).
- [`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — META home. Register this doc as a sixth worked instance: vitest's transformer is the "mock" that hid tsx's "production contract" gap.
- [`docs/solutions/tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md`](../tooling-decisions/mastra-dev-tsx-loader-for-raw-ts-workspace-deps.md) — the generalized, still-live form of this lesson: same raw-`.ts`-workspace-boundary territory, but the _missing-extension_ failure mode (which tsx fixes) rather than this _named-export/CJS_ one (which it does not). Carries the discriminator.
- [`docs/solutions/best-practices/throwaway-operator-harness-deletion-contract-20260430.md`](../best-practices/throwaway-operator-harness-deletion-contract-20260430.md) — the parity harness lifecycle / architecture frame. The capture script that surfaced this bug ships under that pattern.
- [`docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md`](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md) — direct upstream context. The cross-workspace `.ts` source path being imported (`@forge/admin/domain/blocks` → `BlocksSchema`) is a consumer-side artifact of this pattern.
- PR #912 — the parity harness Unit 4 PR where the fix landed.
