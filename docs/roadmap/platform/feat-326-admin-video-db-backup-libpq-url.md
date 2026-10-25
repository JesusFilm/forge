---
id: "feat-326"
title: "Admin video DB backup libpq URL boundary"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-03"
duration: 1
depends_on:
  - "feat-255"
blocks: []
tags:
  - "admin"
  - "database"
  - "backup"
  - "workflow"
---

## Problem

Scheduled Admin `video-core` and `video-search` database backups failed before
S3 upload because `pg_dump` was handed a Prisma-shaped `DATABASE_URL`. Admin now
keeps Prisma pool config in client code so `DATABASE_URL` can remain a plain
Postgres URL.

## Entry Points

1. `apps/admin/src/scripts/video-db-backup.ts` - backup command planning and
   scheduled backup entry point.
2. `apps/admin/src/scripts/video-db-backup.test.ts` - backup command planning
   coverage.
3. `apps/admin/src/app/dashboard/ops-data.ts` - system-status workflow incident
   detail mapping.
4. `apps/admin/src/app/dashboard/ops-data.test.ts` - status data regression
   coverage.

## What To Build

1. Use the clean Postgres `DATABASE_URL` connection boundary for `pg_dump`.
2. Keep database credentials out of process arguments and displayed plan output.
3. Preserve PostgreSQL 18 client invocation through `pg_dump`.
4. Show failed workflow ledger errors in Admin system status instead of masking
   them with the queued/started summary.

## Verification

```bash
pnpm --filter @forge/admin test src/scripts/video-db-backup.test.ts src/app/dashboard/ops-data.test.ts
pnpm --filter @forge/admin typecheck
```
