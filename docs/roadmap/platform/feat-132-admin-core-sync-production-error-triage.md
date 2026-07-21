---
id: "feat-132"
title: "Admin Core Sync Production Error Triage"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-05-24"
duration: 1
depends_on:
  - "feat-110"
blocks: []
tags:
  - "platform"
  - "admin"
  - "core-sync"
  - "operations"
  - "database"
---

## Problem

Recurring Core Sync is deployed and writing production workflow evidence, but
the latest production scheduled run failed because two phases reported row-level
errors. The workflow path itself completed: the lock cleared, runtime run IDs
were persisted, phase summaries were written, and coverage audit status was
`pass`. The remaining work is to identify and resolve the row-level data errors
so the next scheduled run lands `succeeded`.

Production evidence captured on 2026-05-24:

- Latest `workflow_run.workflow_key = 'core-sync'` row:
  `runtime_run_id = wrun_01KS3KK4VFHJ4H24AJQQ76NN5Y`, `trigger = scheduled`,
  `status = failed`, `created_at = 2026-05-20T21:10:14.701Z`,
  `finished_at = 2026-05-20T22:02:23.101Z`.
- Latest summary:
  `10 phase(s), 0 created, 1595212 updated, 8438 soft-deleted, 2 error(s).`
- Phase summary shows `videos.errors = 1` and `video-editions.errors = 1`.
- `core_sync_run.coverage_audit.status = pass`.
- `sync_locks.key = core-sync` has `held_by = null`, so the run did not leave
  the production lock stuck.
- `workflow_worker_heartbeat` has a current online worker heartbeat.

## Entry Points - Read These First

1. `apps/admin/src/services/core-sync/orchestrator.ts` - run lifecycle,
   watermark advancement, phase result aggregation, and lock release.
2. `apps/admin/src/services/core-sync/phases/sync-videos.ts` - the latest run's
   `videos` phase reported one error.
3. `apps/admin/src/services/core-sync/phases/sync-video-editions.ts` - the
   latest run's `video-editions` phase reported one error.
4. `apps/admin/src/services/core-sync/job.ts` - workflow ledger recording and
   `CoreSyncRun` result persistence.
5. `apps/admin/src/app/dashboard/system-status/page.tsx` and
   `apps/admin/src/app/dashboard/ops-data.ts` - operator-visible Core Sync
   health and phase summaries.
6. `apps/admin/docs/core-sync-recurring-job.md` - production verification
   checklist.

## Grep These

- `errors:` in `apps/admin/src/services/core-sync/phases/sync-videos.ts`
- `errors:` in `apps/admin/src/services/core-sync/phases/sync-video-editions.ts`
- `phaseSummary|coverageAudit|recordCoreSyncRunResult` in `apps/admin/src`
- `workflow_run|core_sync_run|sync_state|sync_locks` in `apps/admin/src`

## What To Build

1. Pull the production phase-level error detail for the failed
   `wrun_01KS3KK4VFHJ4H24AJQQ76NN5Y` run from workflow/runtime logs or the
   relevant persisted phase details.
2. Classify the two errors as one of:
   - upstream Core data shape issue,
   - admin transform/validation bug,
   - transient Core API/network failure,
   - database constraint/mapping issue.
3. Fix the smallest code or data-handling path that lets the affected rows sync
   without regressing existing Core Sync invariants.
4. If the errors are legitimate bad upstream records, make the phase projection
   surface the offending Core IDs clearly in the run summary/operator logs.
5. Run a targeted sync for the affected phase or a scheduled incremental sync
   and confirm the next `core-sync` ledger row is `succeeded` with
   `error_count = 0`.

## Constraints

- Do not change the recurring workflow architecture from `feat-110`.
- Do not bypass `SyncLock`, `syncPrisma`, or phase watermarks.
- Do not mark phases successful when row-level errors still occurred.
- Do not run a production full sync unless the operator explicitly intends it;
  prefer incremental or phase-targeted verification.
- Do not print Core API tokens, database URLs, bearer tokens, or raw secrets in
  logs or docs.

## Verification

- Query production `workflow_run` / `core_sync_run` for the next Core Sync run
  and confirm `status = succeeded`, `error_count = 0`, and
  `runtime_run_id IS NOT NULL`.
- Query `sync_locks` and confirm `held_by IS NULL` after the verification run.
- Query `sync_state` for `videos` and `video-editions` and confirm both phases
  have zero errors in their latest `stats`.
- Confirm `/dashboard/system-status` reports Core Sync coverage audit `pass`.
- Confirm `/dashboard/workflows` shows the verification run and its runtime
  detail view.
- Run focused local tests for any touched phase:
  `pnpm --filter @forge/admin test src/services/core-sync/phases/<phase>.test.ts`.
