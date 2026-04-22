---
id: "feat-036"
title: "CMS local PostgreSQL I/O concurrency compatibility"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-04-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "cms"
  - "tooling"
---

## Problem

The CMS added an SSD planner-tuning migration that persists `random_page_cost = 1.1` and `effective_io_concurrency = 200` at the database level. That works on Linux/PostgreSQL hosts that support `posix_fadvise()`, but local Homebrew PostgreSQL 16 on macOS rejects `effective_io_concurrency > 0` with `must be set to 0 on platforms that lack posix_fadvise()`. The result is a local migration failure even though the Railway-targeted tuning is otherwise correct.

## Entry Points — Read These First

1. `apps/cms/database/migrations/2026.03.31T00.00.00.tune-ssd-planner-costs.ts` — current migration that persists `random_page_cost = 1.1` and conditionally sets `effective_io_concurrency = 200` inside a savepoint
2. `apps/cms/config/database.ts` — Strapi/Knex PostgreSQL migration configuration
3. `apps/cms/src/index.ts` — CMS startup/bootstrap flow after migrations complete
4. `docs/solutions/platform/cms-database-snapshot-restore-automation.md` — local-vs-Railway CMS operational precedent

## Grep These

- `effective_io_concurrency\|random_page_cost` in `apps/cms/` — current planner tuning callsites
- `current_database\(` in `apps/cms/database/migrations/` — migration pattern for database-scoped settings
- `posix_fadvise` in local `psql` error output — unsupported-platform signal to preserve

## What To Build

1. Keep the SSD-friendly `random_page_cost = 1.1` database setting unchanged.
2. Change the migration so it attempts `ALTER DATABASE ... SET effective_io_concurrency = 200` inside a savepoint, which keeps Strapi's outer migration transaction valid on unsupported hosts.
3. If the attempt fails with the unsupported-platform error, roll back to the savepoint, skip persisting `effective_io_concurrency`, and continue the migration.
4. Preserve the existing `down()` behavior of resetting both planner settings so supported environments can roll back cleanly.
5. Document the local PostgreSQL/macOS limitation in `docs/solutions/` after the fix is verified.

## Constraints

- Do NOT special-case by OS name alone if capability probing is available.
- Do NOT remove the SSD tuning entirely; Railway/Linux environments should still receive `effective_io_concurrency = 200`.
- Do NOT introduce generated-file changes or unrelated CMS config edits.
- Keep the migration idempotent for fresh local databases and existing Railway databases.

## Verification

- `psql -d postgres -c "SET effective_io_concurrency = 200"` on this macOS/Homebrew machine should still error, confirming the local limitation.
- The updated migration logic should catch that case and continue instead of failing.
- A local PostgreSQL 16 Docker container should accept `SET effective_io_concurrency = 200`, confirming the supported-host path.
- A fresh CMS startup against that Docker database should persist both `random_page_cost = 1.1` and `effective_io_concurrency = 200` with `source = database`.
- `cd apps/cms && pnpm typecheck`
- `cd apps/cms && pnpm lint`
- If needed, run the migration path against local PostgreSQL and confirm `random_page_cost` applies while `effective_io_concurrency` is skipped on unsupported platforms.
