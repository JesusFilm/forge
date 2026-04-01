---
title: "fix: guard CMS SSD planner tuning on unsupported PostgreSQL platforms"
type: fix
status: complete
date: 2026-04-01
origin: docs/roadmap/platform/feat-036-cms-local-postgres-io-concurrency-compatibility.md
---

# fix: guard CMS SSD planner tuning on unsupported PostgreSQL platforms

## Overview

The CMS planner-tuning migration should keep the Railway-targeted SSD benefits while no longer failing on local Homebrew PostgreSQL 16 for macOS, where `effective_io_concurrency` is forced to `0`.

## Problem Statement

- `apps/cms/database/migrations/2026.03.31T00.00.00.tune-ssd-planner-costs.ts` currently unconditionally persists `effective_io_concurrency = 200`.
- Local PostgreSQL 16.13 on `aarch64-apple-darwin` rejects that with `must be set to 0 on platforms that lack posix_fadvise()`.
- Developers can no longer rely on migrations succeeding across supported local and deployed environments.

## Proposed Solution

1. Add a tiny helper inside the existing migration that wraps `ALTER DATABASE ... SET effective_io_concurrency = 200` in a savepoint so unsupported platforms can roll back only that statement.
2. Treat the specific unsupported-platform failure as a graceful no-op so the migration still applies `random_page_cost = 1.1` and completes successfully.
3. Re-throw any other database error so real permission, syntax, or connection issues do not get hidden.
4. Leave `down()` as a straight reset of both settings.

## Files In Scope

- `apps/cms/database/migrations/2026.03.31T00.00.00.tune-ssd-planner-costs.ts`
- `docs/roadmap/platform/feat-036-cms-local-postgres-io-concurrency-compatibility.md`
- `docs/solutions/` learning doc to add after implementation

## Acceptance Criteria

- Local macOS/Homebrew PostgreSQL no longer blocks CMS migration startup on `effective_io_concurrency`.
- Supported PostgreSQL hosts still receive `effective_io_concurrency = 200`.
- Unsupported-platform handling is capability-based and narrow to the known error.
- The repo includes a durable learning describing why this local mismatch happens.

## Verification

- Reproduce locally with `psql -d postgres -c "SET effective_io_concurrency = 200"` and confirm the unsupported-platform error.
- Reproduce the supported-host path with PostgreSQL 16 in Docker and confirm `SET effective_io_concurrency = 200` succeeds there.
- Run a fresh CMS startup against the Docker PostgreSQL database and verify:
  - `random_page_cost = 1.1` with `source = database`
  - `effective_io_concurrency = 200` with `source = database`
- Run `cd apps/cms && pnpm typecheck`.
- Run `cd apps/cms && pnpm lint`.
- Inspect the migration diff to confirm only the tuning guard was added and `random_page_cost` behavior remains unchanged.
