---
id: "feat-327"
title: "Admin Prisma adapter pool config"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-03"
duration: 1
depends_on:
  - "feat-326"
blocks: []
tags:
  - "admin"
  - "database"
  - "backup"
  - "core-sync"
---

## Problem

Admin production database URLs were carrying Prisma-only pool parameters. That
made the same URL unsafe for Postgres CLI tools and required a second
`DATABASE_URL_SYNC` just to give Core Sync different Prisma pool settings.

## Entry Points

1. `apps/admin/src/db/client.ts` - main and Core Sync Prisma client singletons.
2. `apps/admin/src/db/prisma-pool-config.ts` - adapter pool profile mapping.
3. `apps/admin/src/config/env.ts` and `apps/admin/.env.example` - runtime env
   contract.
4. `apps/admin/docs/core-sync-recurring-job.md` - operator guidance.

## What To Build

1. Use `@prisma/adapter-pg` for Admin Prisma clients.
2. Keep `DATABASE_URL` as a plain Postgres URL.
3. Move the main Admin pool sizing into the main Prisma client.
4. Move the Core Sync pool sizing into `syncPrisma`.
5. Remove `DATABASE_URL_SYNC` from the Admin runtime env contract.

## Verification

```bash
pnpm --filter @forge/admin test src/db/prisma-pool-config.test.ts src/scripts/video-db-backup.test.ts src/app/dashboard/ops-data.test.ts
pnpm --filter @forge/admin typecheck
```
