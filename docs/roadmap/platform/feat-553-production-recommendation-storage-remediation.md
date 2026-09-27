---
id: "feat-553"
title: "Reduce recommendation trace storage and improve retention catch-up"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-09-28"
duration: 2
depends_on:
  - "feat-552"
blocks:
  - "feat-554"
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
  - "operations"
---

## Problem

The September 28 investigation measured 82% disk use, 9.09 GB available, and
1.55 GB/day growth. Recommendation tables occupy 28.38 GB; candidate-stage
evidence occupies 20.60 GB, including a redundant 2.36 GB index. First request
expiry is September 30, but production has never purged an expired request
root and current daily evidence volume exceeds the first expiring cohorts.

## Entry Points — Read These First

1. `docs/reports/2026-09-28-production-db-storage/README.md` — verified evidence.
2. `apps/admin/prisma/schema.prisma` — `RecommendationCandidateStageEvidence`.
3. `apps/admin/prisma/migrations/0058_recommendation_candidate_platform/migration.sql`.
4. `apps/admin/src/services/recommendations/orchestration.ts` and
   `candidate-evidence-persistence.ts` — repeated source evidence and row creation.
5. `apps/admin/src/services/recommendations/retention.service.ts` and
   `apps/admin/src/workflows/recommendationRetention.ts` — purge and scheduling.
6. `docs/operations/semantic-recommendation-tracer.md` — current lifecycle contract.

## Grep These

- `recommendation_candidate_stage_run_stage_idx`
- `recommendation_candidate_stage_ordinal_key`
- `platform.evidence|sourceEvidence|MAX_CANDIDATE_NOMINATIONS`
- `overdueAfterRun|RECOMMENDATION_RETENTION_CATCH_UP|take: batchSize`

## What To Build

- Prepare the rollout contract and capacity handoff; feat-554 owns live
  headroom refresh, activation, and post-deploy verification.
- Remove only the redundant non-unique index and its Prisma declaration through
  a forward migration with a reviewed production lock/transaction strategy.
- Implement lossless compact candidate traces while preserving every request's
  complete 29-day debugging history, outcome, attribution, and aggregate contracts.
- Drain expired backlog in bounded work without waiting for it to become a
  privacy/serving incident. Preserve failed deletion/cascade visibility and
  prepare loaded production throughput verification for feat-554.
- Measure isolated storage, deletion, and vacuum behavior and document the
  production measurements required by feat-554.

## Constraints

- No production deletes, index changes, capacity changes, or serving-control
  changes were performed by the investigation. This ticket is follow-up work.
- Preserve the unique `(run_id, stage, ordinal)` constraint and its index.
- Never edit an applied migration. Production code deploys through PR-to-main.
- Do not assume plain DELETE/VACUUM returns relation space to the filesystem;
  do not use an unplanned `VACUUM FULL` as emergency capacity relief.
- Preserve all trace detail and the existing 29-day retention. Sampling and
  shorter detail retention are outside the user-approved scope.
- Preserve Admin trace readers, evaluation consumers, privacy expiry, and
  erasure behavior across mixed legacy and compact records.
- Keep broader feat-396 capacity graduation separate from this urgent scope.

## Verification

- Test unique enforcement, indexed run/stage reads, and cascade deletion on a
  real isolated Postgres fixture after the new migration.
- Test backlog scheduling while expired records are still less than 24 hours
  overdue, including crossing the health threshold before the next daily wake.
- Measure synthetic deletion duration and disk reuse across representative
  cohorts; test migration contention and rollback. Loaded throughput, WAL,
  live lock waits, and transaction budgets are verified under feat-554.
- Preserve saved read-only probes for feat-554 to reconcile deployed storage.
- Run affected Admin tests, lint, typecheck, migration checks, and formatting
  before the remediation PR. Record deployment verification and rollback.

## Resolution

Implemented complete versioned JSONB traces, mixed-format readers, a default-
legacy activation flag, bounded retention continuation, and the duplicate-index
migration. The isolated PostgreSQL benchmark measured 75.1% less trace storage
with complete field and Admin detail parity. Full Admin tests, focused database
tests, typecheck, lint, production build, and independent review passed.

See `docs/reports/2026-09-28-production-db-storage/implementation-validation.md`
for evidence and `storage-remediation-runbook.md` in the same directory for
deployment and rollback. Production remains unchanged. Live capacity protection,
activation, loaded deletion throughput, and storage verification remain open in
feat-554.
