---
title: Admin Core Sync Recurring Background Job
type: feat
status: active
date: 2026-04-29
origin: docs/roadmap/platform/feat-110-admin-core-sync-recurring-job.md
---

# Admin Core Sync Recurring Background Job

## Overview

Turn the newly expanded admin Core sync into an operational background process.
The existing `runSync()` orchestrator remains the only sync engine. This phase
adds a durable execution wrapper, switches manual triggers to enqueue that
wrapper, adds a machine-authenticated scheduled trigger, and makes Core Sync the
center of the dashboard/system-status experience with a visible work log.

The important boundary: this is not a second sync implementation. It is a
production execution path for the Core sync that already landed in `feat-109`.

## Problem Frame

`apps/admin` can now ingest Core coverage directly, including reference locale
rows, video media children, subtitles, dubs, editions, downloads, Mux metadata,
and a coverage audit. The current trigger points are still inline/manual:

- `apps/admin/src/app/dashboard/workflows/page.tsx` calls `runSync(prisma, {
incremental: true })` in a server action.
- `apps/admin/src/graphql/queries/sync-status.ts` exposes `triggerSync`, which
  also calls `runSync(ctx.prisma, ...)`.
- `apps/admin/src/db/client.ts` already exports `syncPrisma`, a dedicated pool
  intended for the Core sync background workflow.

Recurring sync should therefore wrap the existing orchestrator, not change the
data mapping or phase behavior. The UI should also stop treating Core Sync as a
generic operational matrix. `/dashboard/system-status` should become the place
where an operator sees Core Sync freshness, entity coverage, lock state, audit
posture, and the recent work log for scheduled/manual runs.

## Requirements Trace

- R1. Scheduled Core sync runs in the background on an externally controlled
  recurring cadence.
- R2. Scheduled runs are incremental by default.
- R3. Full sync remains an explicit operator action, not the normal recurrence.
- R4. All execution paths use the existing DB-backed `SyncLock` to prevent
  overlap across instances.
- R5. Background execution uses `syncPrisma` / `DATABASE_URL_SYNC` so sync
  cannot starve normal admin traffic.
- R6. The production workflow backend is explicit and durable on Railway. Local
  filesystem/in-memory workflow storage is acceptable only for local
  development and tests.
- R7. Manual UI and GraphQL triggers dispatch background work instead of
  running long syncs inline.
- R8. Machine-triggered scheduling is authenticated and does not create a user
  or `SYSTEM` principal from public request data.
- R9. Operators can see the latest sync status, lock state, phase result, and
  coverage audit outcome.
- R10. `/dashboard/system-status` visualizes Core Sync data as first-class
  product information rather than generic infrastructure rows.
- R11. Operators can review a work log/run log showing scheduled and manual
  workflow attempts, trigger type, subject, timestamps, phase/step counts,
  skipped-lock status, errors, and audit outcome where applicable. Core Sync is
  the first full consumer of the ledger, but the shape should support
  experience dumps, embeddings, transcript/scene backfills, and future
  user-initiated workflows.
- R12. `/dashboard/workflows` reads Postgres World runtime run/step/event data
  and joins it with the admin-owned workflow ledger so operators can see where
  every user/operator workflow ended up.
- R13. The work produces local full-sync and incremental-sync timing evidence
  so the team can decide whether developer machines should run sync directly or
  restore a seeded admin data snapshot.
- R14. The plan does not depend on Strapi and does not change Core data
  mapping.

## Scope Boundaries

- No new Core entity coverage or schema mapping in this phase.
- No consumer app migration.
- No Strapi deletion or Strapi fallback.
- No in-process `setInterval` or app-memory scheduling.
- No retries beyond the retry semantics already present in Core fetches and
  workflow runtime behavior.

## Context & Existing Patterns

- `apps/admin/src/services/core-sync/orchestrator.ts` already provides phase
  ordering, lock acquisition, fetch-start watermarks, zero-error watermark
  advancement, post-phase `ANALYZE`, and coverage audit return values.
- `apps/admin/src/db/client.ts` already provides `syncPrisma` with optional
  `DATABASE_URL_SYNC`.
- `apps/admin/docs/patterns/workflow-authoring.md` says workflows live in
  `apps/admin/src/workflows/`, use `"use workflow"` / `"use step"`, and should
  keep step granularity coarse.
- Existing embedding backfill mutations dispatch workflows with `start()` from
  `workflow/api`; tests use `apps/admin/src/test-helpers/workflow-dispatch.ts`.
- `apps/admin/src/app/api/workflows/[...workflow]/route.ts` owns workflow
  callback authentication.
- `apps/admin/src/app/dashboard/system-status/page.tsx` already renders a
  generic status matrix from `loadSystemStatusData()`; this phase should
  reshape it into a Core Sync health and coverage view.
- `apps/admin/src/app/dashboard/workflows/page.tsx` currently shows
  workflow-adjacent persisted state; the recurring sync work log can live here
  or be linked from system status, but it should be visibly about Core Sync
  runs.
- The `workflow` runtime stores mechanical execution data as workflow runs,
  steps, hooks, events, and streams. The admin dashboard should treat that as
  runtime evidence and keep its own small product-facing ledger keyed by
  workflow runtime `runId` where durable operator/user history is needed.
- In the installed `workflow` package, the local world stores workflow data as
  JSON files and uses in-memory queuing. That is fine for development but not a
  durable production answer on Railway's ephemeral filesystem.
- The selected production backend is the official/self-hosted
  `@workflow/world-postgres` adapter. It uses Postgres for durable workflow
  storage and `graphile-worker` for job processing. This package is not
  currently installed in `apps/admin`; this phase should add and configure it
  before building scheduled sync.
- `/dashboard/workflows` should become the primary user/operator workflow
  dashboard. Its base facts should come from Postgres World's runtime data, with
  the admin workflow ledger adding subject, actor, trigger, and domain summary.
- `docs/solutions/platform/admin-core-sync-entity-coverage.md` captures the
  Core sync invariants that the background path must preserve.

## Key Decisions

- **Use an external scheduler to trigger the app.** Railway cron, GitHub
  Actions, or another scheduler should call a protected admin endpoint. The
  Next.js process should not own production recurrence with timers.
- **Use Postgres World for production workflow execution.** Do not build the
  recurring sync on top of useworkflow local-world storage in production.
  Configure `@workflow/world-postgres` for Railway because it preserves the
  existing useworkflow programming model while moving storage/queueing into
  Postgres.
- **Dispatch, then run in background.** Manual UI and GraphQL triggers should
  enqueue the Core sync workflow and return dispatch metadata, not wait for the
  entire sync.
- **Keep `runSync()` synchronous inside the worker step.** The workflow step can
  call `runSync(syncPrisma, input)` and rely on the existing DB lock and
  watermarks. If useworkflow step persistence makes one giant step too opaque,
  a later phase can split by phase; do not split per record.
- **Scheduled runs are delta only.** Recurring jobs call
  `{ incremental: true, scope: "all" }`. Full sync stays manual because it can
  soft-delete Core-sourced rows that are absent from a complete Core response.
- **Expose run evidence.** The current dashboard infers state from `SyncLock`
  and `SyncState`; this phase should either persist a small Core sync run record
  or expose workflow-returned last-result data through the same operational
  surface.
- **System status becomes Core Sync status.** The system-status page should
  visualize the data the sync and audit already produce: phase watermarks,
  record counts, changed-row counts, error counts, lock state, and audit
  coverage. Generic labels can remain only where they help frame operator
  posture.
- **Work log is durable and generic.** A work log should survive page reloads
  and process restarts. Prefer a small admin-owned workflow ledger keyed by the
  runtime `runId`, with Core Sync-specific summaries stored in a JSON/detail
  column or companion table. Do not make the dashboard depend solely on
  useworkflow internals for product semantics.
- **Workflows page reads Postgres World first.** The workflows page should show
  real runtime state from Postgres World: runs, statuses, timestamps, workflow
  names, step/event counts, and errors. The admin workflow ledger should enrich
  those records with user-facing context, not replace runtime truth.

## Implementation Units

- [x] **Unit 0: Configure Workflow Postgres World**

**Goal:** Install and configure `@workflow/world-postgres` as admin's durable
Railway workflow backend.

**Requirements:** R1, R6, R11

**Files:**

- Reference: `apps/admin/next.config.ts`
- Reference: `apps/admin/src/app/api/workflows/[...workflow]/route.ts`
- Reference: `apps/admin/docs/patterns/workflow-authoring.md`
- Modify: `docs/plans/2026-04-29-001-feat-admin-core-sync-recurring-job-plan.md`
- Modify: `docs/roadmap/platform/feat-110-admin-core-sync-recurring-job.md`
- Consider: `apps/admin/package.json`
- Consider: `apps/admin/src/config/env.ts`
- External reference: `https://workflow-sdk.dev/worlds`
- External reference: `https://useworkflow.dev/worlds/postgres`

**Approach:**

- Install `@workflow/world-postgres` and any required peer/runtime dependencies.
- Add validated env configuration for `WORKFLOW_TARGET_WORLD`,
  `WORKFLOW_POSTGRES_URL`, worker concurrency, pool size, and job prefix.
- Configure Railway to use Postgres World in production while preserving
  local-world behavior for local development unless explicitly overridden.
- Verify that workflow runs, steps, events, hooks, and streams are persisted in
  Postgres and survive process restart.
- Confirm how `graphile-worker` processing starts in the admin runtime and
  whether it needs a separate Railway worker process or can run safely in the
  web service.
- Keep the admin-owned workflow ledger regardless of backend, because the
  dashboard needs product semantics, not only runtime internals.
- Implementation note: `apps/admin/src/instrumentation.ts` starts the selected
  Postgres World only in the Node runtime when
  `WORKFLOW_TARGET_WORLD="@workflow/world-postgres"`. Local development can
  keep using the bundled local world by leaving the target unset.
- Implementation note: Postgres World schema setup is exposed as
  `pnpm --filter @forge/admin workflow:setup:postgres`. Run it after
  provisioning `WORKFLOW_POSTGRES_URL` and before enabling scheduled workflow
  dispatch in Railway.
- Verification note: focused instrumentation/env tests, typecheck, and lint
  pass. Live Postgres persistence smoke was not run in this worktree because
  local Postgres/Docker is unavailable; keep the setup command and persisted
  run-row check in deployment verification.

**Test Scenarios:**

- Admin config validates the Postgres World env vars.
- Existing useworkflow jobs still dispatch through `start()`.
- A test or local verification proves run metadata persists outside the process.
- Documentation states whether workflow processing runs in the web service or a
  separate Railway worker service.

- [ ] **Unit 1: Background Sync Wrapper**

**Goal:** Add the reusable background execution path around `runSync()`.

**Requirements:** R1-R5, R14

**Files:**

- Create: `apps/admin/src/workflows/coreSync.ts`
- Consider: `apps/admin/src/services/core-sync/job.ts`
- Modify: `apps/admin/src/services/core-sync/orchestrator.test.ts`
- Add: `apps/admin/src/workflows/coreSync.test.ts`

**Approach:**

- Define typed input for `scope`, `incremental`, and `trigger`.
- Call `runSync(syncPrisma, { scope, incremental })` from a coarse workflow
  step.
- Return the existing `SyncResult`, including coverage audit when available.
- Keep imports compatible with `workflow/next`; if top-level sync imports prove
  too heavy, move the orchestration call behind a small service function and
  test that boundary directly.

**Test Scenarios:**

- Scheduled input defaults to `incremental: true` and all phases.
- Manual full-sync input can set `incremental: false`.
- Lock-held results return `skipped: true` without throwing.
- Coverage audit result is preserved in the workflow return payload.

- [ ] **Unit 2: Dispatch Surfaces**

**Goal:** Make manual admin triggers enqueue background sync instead of running
inline.

**Requirements:** R3, R5, R7

**Files:**

- Modify: `apps/admin/src/graphql/queries/sync-status.ts`
- Modify: `apps/admin/src/app/dashboard/workflows/page.tsx`
- Add or modify: `apps/admin/src/graphql/queries/sync-status.test.ts`
- Modify: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Add a dispatch helper that calls `start(runCoreSync, [input])`.
- Have GraphQL `triggerSync` return dispatch/run metadata rather than blocking
  on sync completion.
- Have the dashboard action dispatch the same background path and revalidate the
  workflow/status pages.
- Keep `system:trigger-workflow` as the human permission gate.

**Test Scenarios:**

- ADMIN can dispatch an incremental sync.
- Non-admin users cannot dispatch.
- Resolver/server action uses `start()` and the Core sync workflow.
- Invalid scope input is normalized consistently with `resolveScope()`.

- [ ] **Unit 3: Scheduled Trigger Endpoint**

**Goal:** Provide a machine-authenticated HTTP trigger for Railway cron or an
equivalent external scheduler.

**Requirements:** R1-R2, R4-R8

**Files:**

- Create: `apps/admin/src/app/api/core-sync/scheduled/route.ts`
- Modify: `apps/admin/src/config/env.ts`
- Modify: `apps/admin/.env.example`
- Add: `apps/admin/src/app/api/core-sync/scheduled/route.test.ts`

**Approach:**

- Add `CORE_SYNC_CRON_SECRET` or an equivalent env-gated bearer token.
- Accept only `POST`.
- Reject missing or invalid credentials.
- Dispatch the Core sync workflow with `{ incremental: true, trigger:
"scheduled" }`.
- Return accepted/dispatch metadata, not the full sync result.

**Test Scenarios:**

- `GET` is rejected.
- `POST` without auth is rejected.
- `POST` with the wrong secret is rejected.
- `POST` with the correct secret dispatches exactly one incremental all-scope
  workflow run.

- [ ] **Unit 4: Generic Workflow Ledger and Core Sync Run State**

**Goal:** Persist the run/work-log data needed for recurring sync operations
and future user/operator workflows.

**Requirements:** R9, R11

**Files:**

- Consider migration/model: `apps/admin/prisma/schema.prisma`
- Consider migration/model: `apps/admin/prisma/migrations/<next>_workflow_runs/migration.sql`
- Consider service: `apps/admin/src/services/workflow-run-log.service.ts`
- Consider service: `apps/admin/src/services/core-sync/run-log.ts`
- Modify: `apps/admin/src/app/dashboard/ops-data.ts`
- Modify: `apps/admin/src/graphql/queries/sync-status.ts`
- Add: `apps/admin/src/services/core-sync/run-log.test.ts`

**Approach:**

- Prefer the smallest durable state that answers, for any workflow: runtime
  run id, workflow key/name, trigger, actor or system source, subject/type,
  start/end, status, duration, summary, and error.
- Add Core Sync-specific detail for skipped-lock status, phase errors, phase
  counts, and coverage audit status.
- If the workflow runtime already exposes sufficient run history through a
  stable API, use it as an enrichment source; still keep an admin-owned ledger
  for product semantics and dashboard querying.
- Continue showing `SyncLock` and `SyncState` because they are the source of
  truth for overlap and phase watermarks.
- Record both scheduled and manual dispatches/runs so operators can distinguish
  cadence health from human-triggered incident response.

**Test Scenarios:**

- `systemStatus` includes enough data for external monitoring.
- A scheduled run writes trigger type, started/finished timestamps, status,
  phase summaries, and audit status.
- A non-Core workflow can write a generic run entry without Core-specific phase
  fields.
- A lock-held run writes or exposes a skipped-lock entry distinct from success.
- A failed run preserves error status without advancing a misleading success
  marker.

- [ ] **Unit 5: System Status Core Sync Takeover**

**Goal:** Make `/dashboard/system-status` visually explain Core Sync health,
freshness, coverage, and drift risk.

**Requirements:** R9-R10

**Files:**

- Modify: `apps/admin/src/app/dashboard/system-status/page.tsx`
- Modify: `apps/admin/src/app/dashboard/ops-data.ts`
- Modify: `apps/admin/src/i18n/messages.ts`
- Modify: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Replace the generic system matrix with a Core Sync-centered layout:
  freshness cards, lock/runner state, phase table, coverage audit summary, and
  entity coverage counts.
- Surface the real data operators care about: last successful run, latest
  attempted run, per-phase watermark age, per-phase created/updated/deleted
  counts, errors, and audit `pass`/`review`.
- Keep visual density appropriate for an operations surface: compact tables,
  clear status pills, and no marketing-style explanation blocks.
- Link or embed the recent work log so an operator can move from "status is
  stale" to "which run failed?" without hunting through logs.

**Test Scenarios:**

- System status shows Core Sync-focused copy and sections.
- Healthy audit renders as ready/pass.
- Stale or errored phase renders as warning/review.
- Lock-held state renders as running rather than failure.
- Recent work-log entries appear or are linked from the system-status surface.

- [ ] **Unit 6: Postgres World Workflow Dashboard**

**Goal:** Give operators a readable recent history of scheduled, manual, and
user-initiated workflow work, backed by Postgres World runtime data and enriched
with admin workflow ledger context.

**Requirements:** R9, R11-R12

**Files:**

- Modify: `apps/admin/src/app/dashboard/workflows/page.tsx`
- Modify: `apps/admin/src/app/dashboard/ops-data.ts`
- Modify: `apps/admin/src/i18n/messages.ts`
- Modify: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`
- Consider service: `apps/admin/src/services/workflow-runtime.service.ts`

**Approach:**

- Reframe the workflows page around Postgres World runtime runs: workflow name,
  runtime run id, status, created/started/completed timestamps, duration,
  step/event counts, and runtime error.
- Join runtime runs to the admin workflow ledger by `runtimeRunId` to add
  trigger, actor/system source, subject, domain summary, and links to related
  admin records.
- Render Core Sync entries with richer detail: phase summary, skipped-lock
  status, audit status, and changed-row counts.
- Keep existing workflow readiness signals only if they help explain why a run
  can or cannot be dispatched.
- Show skipped-lock runs as useful operational evidence, not noise.
- Include filters/tabs for status and workflow type if the first data set is
  large enough to need scanning support.

**Test Scenarios:**

- Work log lists scheduled, manual, and user-initiated runs in reverse
  chronological order.
- Each entry shows workflow name, runtime run id, trigger type, subject, status,
  duration or running state, and summary.
- Runtime-only records still render even when the admin ledger row is missing.
- Core Sync entries show phase summary.
- Failed/skipped runs use distinct status labels.
- Empty state tells the operator no workflow work has run yet.

- [ ] **Unit 7: Deployment Notes and Verification**

**Goal:** Make the recurrence activatable without tribal knowledge.

**Requirements:** R1-R2, R5-R13

**Files:**

- Modify: `docs/roadmap/platform/feat-110-admin-core-sync-recurring-job.md`
- Consider: `apps/admin/docs/v1-operational-surfaces.md`
- Consider: `apps/admin/CLAUDE.md`

**Approach:**

- Document the recommended cadence and the exact scheduled endpoint.
- Document required env vars: `DATABASE_URL_SYNC`, scheduler secret, workflow
  callback keys, Core credentials.
- Add a deployment checklist for Railway cron or the chosen scheduler.
- Include post-deploy verification: call scheduled endpoint, confirm dispatch,
  confirm `SyncLock` clears, confirm watermarks advance, confirm coverage audit
  remains `pass`.
- Include UI verification: system status shows Core Sync health, and the work
  log records the scheduled run.
- Record local benchmark evidence for:
  - clean/full sync runtime,
  - no-op incremental runtime,
  - typical delta runtime if sample Core changes are available,
  - peak row-volume phases, especially videos and video dubs/downloads.
- If full sync is too slow for low-spec developer machines, create or reference
  a follow-up plan for an admin Core data snapshot/restore path.

**Test Scenarios:**

- Documentation names every required env var and verification step.
- Verification commands match existing package scripts.
- Documentation includes the dashboard/system-status and work-log checks.
- Documentation includes benchmark results and a recommendation for direct sync
  vs seeded snapshot restore in local development.

## Risks

- **Workflow runtime boundary:** Existing tests cover `start()` dispatch, but
  implementation should verify the production workflow endpoint actually runs
  callbacks for this job shape.
- **Wrong workflow backend:** useworkflow local-world storage writes JSON files
  and uses in-memory queueing. That is not enough for Railway production
  durability. Unit 0 must configure `@workflow/world-postgres` before scheduled
  sync ships.
- **Long-running sync duration:** A single coarse step is simple, but if full
  all-phase sync exceeds runtime expectations, split by phase rather than by
  record.
- **Scheduler duplicate calls:** External schedulers can retry. The DB lock
  should make duplicates safe; run state should still mark skipped-lock runs
  clearly.
- **Secret drift:** The scheduled endpoint adds another machine secret. Keep it
  in `env.ts`, `.env.example`, and deployment docs so it is visible.

## Verification Commands

```bash
pnpm --filter @forge/admin test
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
```

## Done When

- A recurring external scheduler can trigger an incremental Core sync without a
  human session.
- Manual admin triggers enqueue the same background path.
- The sync uses `syncPrisma`.
- Overlapping runs are skipped by the existing DB lock.
- Operators can see the latest scheduled run health and coverage audit result.
- `/dashboard/system-status` visualizes Core Sync freshness, coverage, audit,
  lock state, and drift/error posture.
- The work log shows recent scheduled, manual, and user-initiated workflows,
  using Postgres World runtime data plus enough Core Sync detail to debug a
  stale or failed sync.
- The plan records whether developers can reasonably run full sync locally, or
  whether local development should prefer a seeded admin data snapshot.
- Deployment docs explain how to turn the cadence on and verify it.
