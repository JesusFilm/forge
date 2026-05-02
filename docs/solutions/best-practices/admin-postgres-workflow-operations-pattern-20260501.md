---
title: Admin Postgres Workflow Operations Pattern
date: 2026-05-01
category: best-practices
module: apps/admin
problem_type: best_practice
component: background_job
severity: high
applies_when:
  - Running admin workflows through Postgres World in production.
  - Adding recurring background jobs that need dashboard visibility.
  - Showing whether a workflow worker process is alive, idle, or stale.
  - Joining Workflow runtime state to admin-owned business context.
tags:
  - admin
  - workflow
  - postgres-world
  - graphile-worker
  - core-sync
  - dashboard
  - heartbeat
---

# Admin Postgres Workflow Operations Pattern

## Context

`apps/admin` uses Workflow for durable background work. The Core sync recurring
job moved that runtime from local/in-memory behavior to `@workflow/world-postgres`
so scheduled and manual syncs survive process restarts and can be inspected from
Postgres-backed dashboard pages.

The important operational distinction is that Workflow/Postgres World owns the
runtime facts, while admin owns product context. Runtime tables can tell us that
a run, step, or event exists. They do not know that a run was a manual Core sync,
which Core phases changed rows, whether the sync lock was skipped, or whether an
idle admin process is currently available to pick up work.

Session history reinforced two constraints: earlier admin planning established
Workflow as the background-job spine, and previous production work showed that
workflow call sites must test `start()` dispatch rather than direct invocation.
This PR added the next production layer: Postgres World runtime reads, an
admin-owned workflow ledger, and a worker heartbeat because Graphile Worker does
not persist idle worker slots.

## Guidance

Use three data surfaces for admin workflow operations:

1. **Workflow/Postgres World runtime data** for run, step, and event state.
2. **Admin-owned ledger tables** for product context and summaries.
3. **Admin-owned worker heartbeat rows** for "is a worker process alive?"

Do not try to make the Workflow runtime table carry product-specific context.
Instead, create a ledger row before dispatch, pass the ledger id into the
workflow input, and attach the runtime run id after `start()` returns.

```ts
const ledgerRun = await createWorkflowRunLog({
  workflowKey: "core-sync",
  workflowName: "Core Sync",
  trigger: "scheduled",
  subjectType: "sync",
  subjectId: "core",
  summary: "Core Sync workflow queued.",
})

const run = await start(runCoreSync, [
  {
    incremental: true,
    trigger: "scheduled",
    ledgerRunId: ledgerRun.id,
  },
])

await attachWorkflowRuntimeRunId(ledgerRun.id, run.runId)
```

Inside the workflow step, mark the ledger as started, run the existing service,
and record business-level output when it completes.

```ts
export async function runCoreSyncJob(input: CoreSyncWorkflowInput = {}) {
  if (input.ledgerRunId) {
    await markWorkflowRunStarted(input.ledgerRunId)
  }

  const result = await runSync(syncPrisma, {
    scope: normalized.scope,
    incremental: normalized.incremental,
  })

  if (input.ledgerRunId) {
    await recordCoreSyncRunResult(input.ledgerRunId, result)
  }

  return result
}
```

Start Postgres World from Next instrumentation only in the Node runtime and only
when the target world is configured. Keep this gate explicit so local previews
and edge contexts do not accidentally spawn workers.

```ts
export function shouldStartWorkflowWorld(): boolean {
  return (
    env.NEXT_RUNTIME !== "edge" &&
    env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  )
}
```

For worker visibility, write a heartbeat from the admin process after
`world.start()` succeeds. Graphile Worker exposes locked jobs while work is
processing, but its tables do not persist idle workers. The heartbeat table is
therefore the source for "online/stale"; Graphile locked jobs are only an
additional "processing" signal when present.

```sql
CREATE TABLE "workflow_worker_heartbeat" (
  "worker_id" TEXT PRIMARY KEY,
  "service" TEXT NOT NULL DEFAULT 'admin',
  "status" TEXT NOT NULL DEFAULT 'online',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "current_job" TEXT,
  "current_run_id" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}'
);
```

The Workflows dashboard should compose these facts:

- recent runtime runs from Postgres World,
- ledger summaries from `workflow_run` and workflow-specific detail tables,
- lock state from `sync_locks` when relevant,
- worker heartbeat rows for online/stale status,
- Graphile locked jobs for currently processing work.

Keep the dashboard copy generic. The Workflows page is not only a Core sync
page; it will also show scheduled jobs, manual jobs, embedding backfills, and
future workflow-backed operations.

## Why This Matters

The runtime/ledger split keeps the system durable without losing domain
meaning. Workflow remains responsible for execution state, while admin can
summarize what an operator actually cares about: who triggered a run, what
subject it affected, whether it was skipped by a lock, and how many rows changed.

The heartbeat solves a gap in Graphile Worker observability. Without it, the
dashboard can show that jobs have run, but it cannot answer the operational
question "is a worker currently alive and polling?" That matters before trusting
a scheduled sync or debugging a queue that appears quiet.

The explicit runtime gate avoids accidental worker starts in the wrong context.
This is especially important in Next apps where dev servers, builds, route
handlers, and edge/runtime boundaries can execute different subsets of code.

The pattern also preserves the existing Core sync invariants. The workflow path
dispatches the existing `runSync()` engine; it does not create a second sync
implementation.

## When to Apply

- A workflow needs to run in production or staging with restart durability.
- Operators need to see run status, recent failures, or row-level summaries.
- A dashboard needs to distinguish "no work is running" from "no worker is
  alive."
- A workflow has business-specific output that does not belong in generic
  runtime tables.
- A manual or scheduled endpoint dispatches a `"use workflow"` function.

Do not apply the ledger table to throwaway scripts or one-off local-only
commands. For local benchmarks, direct service scripts can still call the sync
engine directly when they are intentionally outside the Workflow runtime.

## Examples

For recurring Core sync, the production path is:

1. `/api/core-sync/scheduled` verifies `CORE_SYNC_CRON_SECRET`.
2. `dispatchCoreSync()` creates a queued `workflow_run` row.
3. `start(runCoreSync, [input])` dispatches Workflow/Postgres World.
4. The workflow step calls `runCoreSyncJob()`.
5. The job calls the existing `runSync(syncPrisma, ...)`.
6. `core_sync_run` records phase totals and lock-skipped status.
7. `/dashboard/workflows` joins runtime rows, ledger rows, and worker heartbeat.

For local worktree previews, copy the database first, run Prisma migrations, run
Workflow Postgres setup, and set a worktree-specific `AUTH_COOKIE_PREFIX` before
starting the admin server. This keeps dashboard testing isolated from the shared
source database and from other localhost sessions.

## Related

- `apps/admin/src/instrumentation.ts`
- `apps/admin/src/services/core-sync/job.ts`
- `apps/admin/src/services/workflow-run-log.service.ts`
- `apps/admin/src/services/workflow-runtime.service.ts`
- `apps/admin/src/services/workflow-worker-heartbeat.service.ts`
- `apps/admin/docs/core-sync-recurring-job.md`
- `apps/admin/docs/worktree-preview-setup.md`
- `docs/plans/2026-04-29-001-feat-admin-core-sync-recurring-job-plan.md`
- `docs/solutions/platform/admin-core-sync-entity-coverage.md`
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
- `docs/solutions/database-issues/db-lock-must-be-atomic-update-not-select-for-update.md`
