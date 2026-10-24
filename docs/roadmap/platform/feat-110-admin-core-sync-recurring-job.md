---
id: "feat-110"
title: "Admin Core Sync Recurring Background Job"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-04-29"
duration: 2
depends_on:
  - "feat-109"
blocks:
  - "feat-132"
  - "feat-157"
tags:
  - "platform"
  - "admin"
  - "core-sync"
  - "workflow"
  - "operations"
---

## Problem

Admin now has direct Core entity coverage, but the sync is still primarily a
manual operation and the operations UI only gives generic sync signals. To make
admin a trustworthy Core projection, delta sync must run in the background on a
recurring cadence, avoid overlapping runs across Railway instances, use the
dedicated sync database pool, and take over the dashboard/system-status
experience with Core Sync visuals and a durable work log.

## Entry Points - Read These First

1. `docs/plans/2026-04-29-001-feat-admin-core-sync-recurring-job-plan.md`
2. `docs/solutions/platform/admin-core-sync-entity-coverage.md`
3. `apps/admin/AGENTS.md`
4. `apps/admin/docs/patterns/workflow-authoring.md`
5. `apps/admin/src/services/core-sync/orchestrator.ts`
6. `apps/admin/src/db/client.ts`
7. `apps/admin/src/graphql/queries/sync-status.ts`
8. `apps/admin/src/app/dashboard/workflows/page.tsx`

## Grep These

- `runSync(` in `apps/admin/src/`
- `syncPrisma|DATABASE_URL_SYNC` in `apps/admin/src apps/admin/.env.example`
- `"use workflow"|start(` in `apps/admin/src/workflows apps/admin/src/graphql/mutations`
- `system:trigger-workflow` in `apps/admin/src/`
- `syncLock|SyncState|coverageAudit` in `apps/admin/src/app/dashboard/ops-data.ts`

## What To Build

1. Add a durable/background Core sync execution path that calls the existing
   `runSync()` engine with `syncPrisma`.
2. Configure the official `@workflow/world-postgres` adapter as the production
   workflow backend for Railway. Do not rely on filesystem-local workflow
   storage in production.
3. Move manual admin triggers to dispatch the background path rather than
   running the whole sync inline in a page action or GraphQL resolver.
4. Add a machine-authenticated scheduled trigger endpoint that can be called by
   Railway cron or another external scheduler.
5. Keep recurring runs incremental by default and keep full sync as an explicit
   manual/operator action.
6. Preserve overlap safety through the existing DB-backed `SyncLock`.
7. Persist or expose enough run result state for operators to see last run,
   errors, skipped-lock runs, and coverage audit status.
8. Make `/dashboard/system-status` a Core Sync health surface that visualizes
   phase freshness, lock state, coverage audit data, entity coverage, and error
   posture.
9. Add a generic workflow work log/run log surface, with Core Sync as the first
   full consumer, including trigger, timestamps, status, subject, phase counts,
   skipped-lock state, and errors.
10. Take over `/dashboard/workflows` as the user/operator workflow dashboard by
    reading Postgres World run/step/event data and joining it with the
    admin-owned workflow ledger for product context.
11. Benchmark full and incremental sync runtimes on local Docker Postgres so the
    team knows whether developers can run sync directly on low-spec machines or
    should use a seeded snapshot.
12. Document the Railway/env setup required to activate the cadence.

## Constraints

- Do not fork or duplicate Core sync phase logic; `runSync()` remains the only
  sync engine.
- Do not reintroduce Strapi dependencies.
- Do not rely on in-memory timers in the Next.js process for production
  scheduling.
- Do not let public HTTP input mint a `SYSTEM` principal.
- Do not make the recurring path block normal GraphQL/UI database traffic; use
  `syncPrisma` and `DATABASE_URL_SYNC`.

## Verification

- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- Auth tests prove the scheduled endpoint rejects missing/bad secrets.
- Dispatch tests prove manual triggers enqueue the background sync path.
- Workflow/service tests prove `runSync(syncPrisma, { incremental: true })` is
  used for scheduled delta runs.
- Operational UI/status tests prove the Core Sync system-status takeover and
  `/dashboard/workflows` Postgres World dashboard show lock-held, runtime run
  status, last result, phase counts, and audit state after background
  execution.
- Verification records local full-sync and incremental-sync timings, including
  whether a dev-data snapshot path is required for underpowered machines.

## Completion Evidence

Verified on 2026-05-24:

- Production `@forge/admin` has `WORKFLOW_TARGET_WORLD=@workflow/world-postgres`
  and `WORKFLOW_RUNNER_ENABLED=false`.
- Production `@forge/admin/worker` has
  `WORKFLOW_TARGET_WORLD=@workflow/world-postgres` and
  `WORKFLOW_RUNNER_ENABLED=true`.
- Both services are deployed with Railway status `SUCCESS`.
- Production `workflow_worker_heartbeat` has a current online worker heartbeat.
- Production `workflow_run` and `core_sync_run` contain scheduled Core Sync
  rows with runtime run IDs, phase summaries, lock release, and coverage audit
  data.
- Latest coverage audit from 2026-05-20 is `pass`; the latest run still
  reported two row-level phase errors, tracked separately in `feat-132`.
- Focused local verification passed:
  `pnpm --filter @forge/admin test src/services/core-sync/job.test.ts src/workflows/coreSync.test.ts src/app/api/core-sync/scheduled/route.test.ts src/app/api/core-sync/manual/route.test.ts src/services/workflow-run-log.service.test.ts src/services/workflow-runtime.service.test.ts src/instrumentation.test.ts`.
  Also passed: `pnpm --filter @forge/admin typecheck` and
  `pnpm --filter @forge/admin lint`.
