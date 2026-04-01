---
title: "PostgreSQL effective_io_concurrency on macOS Homebrew"
category: "platform"
date: "2026-04-01"
severity: "medium"
tags:
  - postgresql
  - macos
  - homebrew
  - strapi
  - migrations
  - graceful-degradation
modules:
  - apps/cms
related_issues:
  - "feat-036"
---

# PostgreSQL effective_io_concurrency on macOS Homebrew

## Problem

The CMS added a migration to persist SSD planner tuning with `random_page_cost = 1.1` and `effective_io_concurrency = 200`. That is a good default for Railway/Linux PostgreSQL, but local Homebrew PostgreSQL 16 on macOS rejects any non-zero `effective_io_concurrency`, causing the migration to fail during local CMS startup.

## Root Cause

On this macOS/Homebrew PostgreSQL build, PostgreSQL reports:

```text
ERROR: invalid value for parameter "effective_io_concurrency": 200
DETAIL: effective_io_concurrency must be set to 0 on platforms that lack posix_fadvise().
```

The important nuance is that `pg_settings` still shows a nominal `max_val` of `1000`, so metadata alone is not enough to prove the setting is actually usable on the current host. A second nuance is that Strapi wraps user migrations in a transaction. If a migration probes an unsupported setting with a failing statement and only catches the exception in JavaScript, PostgreSQL still marks the transaction aborted and rolls back the earlier migration work at commit time.

## Solution

Keep `random_page_cost = 1.1` unconditionally, but gate `effective_io_concurrency = 200` behind a savepoint-wrapped `ALTER DATABASE` in the migration:

1. Persist `random_page_cost = 1.1` with `ALTER DATABASE`
2. Create a savepoint before attempting `ALTER DATABASE ... SET effective_io_concurrency = 200`
3. If the statement succeeds, release the savepoint and keep the database-level setting
4. If it fails with the `lack posix_fadvise()` error, roll back to the savepoint, release it, and continue the migration
5. Re-throw any other error so real misconfigurations are not masked

The detector should key off structured PostgreSQL context, not the server's English prose. Matching SQLSTATE `22023` together with the `effective_io_concurrency` parameter name keeps the unsupported-host guard narrow without depending on localized `detail` text.

## Why This Pattern

- It keeps the SSD tuning in supported deployed environments.
- It avoids brittle OS-name branching.
- It preserves local developer startup on unsupported platforms.
- It keeps the failure handling narrow to the known PostgreSQL capability error.
- It avoids aborting Strapi's outer migration transaction on unsupported local platforms.

## Prevention

- Do not assume PostgreSQL tuning values that are valid on Linux are portable to local macOS builds.
- For database tuning migrations, prefer capability probes over host-name checks when PostgreSQL can reject a setting at runtime.
- When the framework wraps migrations in a transaction, use savepoints around expected-to-fail probes so PostgreSQL does not roll back the whole migration.
- Treat `pg_settings` metadata as advisory; verify behavior with a real `SET` or `set_config()` when platform support is in doubt.

## Verification

- `psql -d postgres -c "SET effective_io_concurrency = 200"` reproduces the macOS/Homebrew failure on unsupported local installs
- A fresh local CMS startup on macOS/Homebrew leaves `random_page_cost = 1.1` with `source = database`
- The same local branch, run against a PostgreSQL 16 Docker container on this Mac, accepts `SET effective_io_concurrency = 200`
- A fresh CMS startup against that Docker database persists:
  - `random_page_cost = 1.1` with `source = database`
  - `effective_io_concurrency = 200` with `source = database`

## Key Files

- `apps/cms/database/migrations/2026.03.31T00.00.00.tune-ssd-planner-costs.ts`
- `docs/roadmap/platform/feat-036-cms-local-postgres-io-concurrency-compatibility.md`
- `docs/plans/2026-04-01-002-fix-cms-local-postgres-io-concurrency-plan.md`
