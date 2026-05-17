---
id: "feat-124"
title: "Admin production core sync restore fix"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-05-15"
duration: 1
depends_on:
  - "feat-123"
blocks: []
tags:
  - "admin"
  - "infrastructure"
  - "database"
---

## Problem

Production admin needs an authenticated way to enqueue a full Core sync run so
the Railway worker can populate the production admin database over private
networking. The restore path also filtered `pg_restore` tables with
schema-qualified names, which caused custom archive restores to match no data.

## Scope

1. Allow `POST /api/core-sync/scheduled` callers with
   `CORE_SYNC_CRON_SECRET` to pass `incremental` and `scope`.
2. Keep the existing default behavior as incremental all-scope sync.
3. Restore custom archive table data with unqualified `pg_restore --table`
   selectors while keeping backup dumps schema-qualified.

## Verification

```bash
pnpm --filter @forge/admin test src/app/api/core-sync/scheduled/route.test.ts src/scripts/video-db-backup.test.ts
pnpm --filter @forge/admin typecheck
```
