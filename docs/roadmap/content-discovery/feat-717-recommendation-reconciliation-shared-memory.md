---
id: "feat-717"
title: "Bound recommendation reconciliation shared memory"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-10-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "recommendations"
  - "admin"
  - "postgres"
  - "reliability"
---

## Problem

Production Admin Postgres repeatedly raises SQLSTATE `53100` while the
five-minute recommendation profile reconciliation batch runs. In a bounded
2026-10-16 Railway window, Postgres logged 43 failed 8 MiB dynamic shared-memory
allocations in approximately 24 minutes, and Admin worker exhausted the
workflow's retries. The batch disables JIT inside its transaction but still
allows PostgreSQL to choose parallel plans for the lineage scan.

## Entry Points — Read These First

1. `apps/admin/src/services/recommendations/profiles/reconciliation.service.ts`
   — advisory-locked transaction, lineage discovery, and transaction-local
   query settings.
2. `apps/admin/src/services/recommendations/profiles/reconciliation.service.test.ts`
   — unit harness for the discovery transaction and dispatch behavior.
3. `docs/operations/watch-catalog-memory-recovery-2026-09-22.md` — prior
   production SQLSTATE `53100` investigation and bounded-query precedent.
4. `docs/roadmap/content-discovery/feat-590-precomputed-video-recommendation-experiment.md`
   — independent catalog-proof path that already fences parallel workers inside
   its transaction after the same Railway shared-memory failure class.

## Grep These

`runRecommendationProfileReconciliationBatch`,
`max_parallel_workers_per_gather`, `SQLSTATE 53100`,
`recommendation-profile-reconciliation-scheduler`.

## What To Build

- Set `max_parallel_workers_per_gather = 0` locally inside the existing
  advisory-locked reconciliation transaction before the lineage scan.
- Preserve the existing JIT guard, batch bounds, lock, classification,
  redispatch, and publication behavior.
- Add a regression test that pins both transaction-local settings so a future
  refactor cannot silently restore parallel shared-memory allocation.
- After normal deployment, verify at least two scheduler intervals with no new
  reconciliation SQLSTATE `53100`, no exhausted workflow retry, and a healthy
  reconciliation result.

## Constraints

- Do not change global PostgreSQL settings, Railway service resources, database
  volume configuration, query semantics, batch size, or retry counts.
- Do not weaken recommendation eligibility, lineage fencing, publication
  integrity, or the advisory lock.
- Production release must use the normal reviewed PR-to-main deployment path.

## Verification

- `pnpm --filter @forge/admin test -- src/services/recommendations/profiles/reconciliation.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter roadmap generate:readme`
- `pnpm --filter roadmap lint`
- Post-deploy Railway observation for the exact scheduler and SQLSTATE signals
  over at least two five-minute intervals.
