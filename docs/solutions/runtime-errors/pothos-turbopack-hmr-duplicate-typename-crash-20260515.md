---
title: "Pothos duplicate-typename crash under Turbopack HMR in local dev"
date: "2026-05-15"
category: "runtime-errors"
module: "apps/admin"
problem_type: "runtime_error"
component: "development_workflow"
symptoms:
  - "POST /api/graphql 500 from web runSearch server action after an admin file save"
  - "Web UI shows: Search failed. Please try again."
  - "Admin dev log: PothosSchemaError — Duplicate typename — Another type with name <TypeName> already exists"
  - "Crash recurs on different enum/object names (HybridSearchContentType, VideoLabel, …) — same shape each time"
root_cause: "config_error"
resolution_type: "environment_setup"
severity: "medium"
tags: [pothos, turbopack, hmr, local-dev, graphql, apps-admin]
---

# Pothos duplicate-typename crash under Turbopack HMR in local dev

## Problem

After extended local-dev sessions with Turbopack HMR, admin's `/api/graphql`
endpoint starts returning 500 on every request. Pothos's singleton type
registry accumulates a duplicate registration when HMR re-evaluates a
GraphQL-schema module, and `ConfigStore.addTypeRef` throws on the second
registration of any type name — taking the whole endpoint down until the
admin dev process is restarted.

## Symptoms

- Browser: web's floating search shows `Search failed. Please try again.`
- Web dev log:
  ```
  POST /?q=... 500 in N ms
  └─ ƒ runSearch({...}) in N ms src/lib/search-actions.ts
  ⨯ Error [ServerError]: Response not successful: Received status code 500
      url: 'http://127.0.0.1:3003/api/graphql'
  ```
- Admin dev log, first occurrence (e.g., after several hours of HMR cycles):
  ```
  ⨯ PothosSchemaError: Duplicate typename: Another type with name HybridSearchContentType already exists.
      at ConfigStore.addTypeRef (.next/dev/server/chunks/...)
      at Module.eval (src/graphql/queries/hybrid-search.ts:28:33)
   POST /api/graphql 500 in 30ms
  ```
- Admin dev log, second occurrence (different file triggered the re-eval):
  ```
  ⨯ PothosSchemaError: Duplicate typename: Another type with name VideoLabel already exists.
      at ConfigStore.addTypeRef (.next/dev/server/chunks/...)
      at Module.eval (src/graphql/types/video.ts:69:39)
   POST /api/graphql 500 in 26ms
  ```
- The specific type name varies per session; the shape is always
  `Duplicate typename: Another type with name X already exists`.

## What Didn't Work

- **Checking `/api/health`** returned `200`, so the process appeared
  healthy. This initially looked identical to the earlier ECONNREFUSED
  failure (admin not running at all). It ruled out a dead process but
  didn't point at the real cause.
- **Verifying `ADMIN_GRAPHQL_URL` in `apps/web/.env.local`** confirmed
  web was hitting the right host (`http://127.0.0.1:3003`) and was a
  dead end.
- The distinction only became clear after inspecting admin's dev
  terminal output directly.

## Solution

Restart the admin dev process:

```bash
# In the admin dev terminal
Ctrl-C
pnpm --filter @forge/admin dev
```

The endpoint recovers in roughly 2 seconds. No data changes; no code
changes; the freshly-booted builder registers each type exactly once.

## Why This Works

Pothos holds a singleton `builder` instance at module scope. Calls
like `builder.enumType("HybridSearchContentType", {...})` register
the type name in `ConfigStore` on that singleton. Under Turbopack HMR
each file save re-executes the changed module's body; if that body
contains type-registration calls, they fire AGAIN on the same
already-populated `ConfigStore`. `addTypeRef` rejects any name it
already knows and throws `PothosSchemaError: Duplicate typename`. From
that point the entire `/api/graphql` route is broken until the
process restarts and the builder is constructed fresh.

**Production is unaffected.** Production builds load every module
exactly once at request time; there is no HMR. Verified:

- `grep -rnE 'builder\.(enumType|objectRef|prismaObject)\("<name>"'`
  on `apps/admin/src/` returns exactly one declaration per type name
  (no duplicates in source).
- `pnpm --filter @forge/admin schema:print` builds the full Pothos
  schema in one shot (same code path `next build` runs at
  production-bundle assembly time) and succeeds without error.
- Production deploys boot once, load every module once, register
  every type once.

## Prevention

When `Search failed` appears in the browser during local development,
work through this diagnostic in order:

1. Open admin's dev terminal.
2. Scan recent output for a `PothosSchemaError`.
3. If it reads `Duplicate typename`: `Ctrl-C` → `pnpm --filter @forge/admin dev`. Done.
4. If it reads `Field '<x>' not found in model '<Model>'`: this is a
   _stale generated Prisma client_ (not HMR) — run
   `pnpm --filter @forge/admin exec prisma generate`, then restart. After a
   pull that touched Prisma the local DB may also be behind its migrations;
   see `docs/solutions/database-issues/admin-prisma-client-and-db-migration-drift-after-pull-20260603.md`.
5. If there's no `PothosSchemaError`: check that
   `ADMIN_GRAPHQL_URL=http://127.0.0.1:3003` in `apps/web/.env.local` and
   that admin's `/api/health` returns `200`.

**Eliminate the symptom at the source** — the admin owner can ship
either of these (not yet implemented):

- **`globalThis` singleton for `builder`** — store the Pothos
  `builder` on `globalThis` so HMR re-evaluation reuses the existing
  instance instead of constructing a new one. This is the standard
  Pothos + Next.js community pattern for HMR-tolerant builders.
- **Register-once guard** — wrap each `enumType` / `objectRef` /
  `prismaObject` call with a check against the builder's existing
  type map and skip the call if the name is already registered.

Either change converts the runtime crash into a no-op, with the
trade-off that an in-place edit to a type definition (e.g., adding a
new enum value) won't take effect until the next process restart —
acceptable because schema edits are rare relative to other dev edits.

## Related Issues

- `docs/solutions/graphql/pothos-prisma-shared-enum-module.md` — same
  Pothos no-deduplication behavior, surfaced via a different trigger
  (static multi-module import vs. HMR re-evaluation). The two failure
  modes share an underlying mechanism in `ConfigStore`. That doc's
  Prevention guidance ("centralize in `reference.ts`") is correct for
  the static case but does not prevent this HMR variant — even a
  centralized shared module gets re-evaluated by HMR and re-registers.
- `docs/solutions/database-issues/admin-prisma-client-and-db-migration-drift-after-pull-20260603.md`
  — the _other_ `PothosSchemaError` variant in local admin dev:
  `Field '<x>' not found in model '<Model>'`, caused by a stale generated
  Prisma client (fixed by `prisma generate`, not a restart). Covered in
  step 4 of the diagnostic above.
