---
id: "feat-555"
title: "Reclaim legacy recommendation trace storage after expiry"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-29"
duration: 3
depends_on:
  - "feat-554"
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
  - "operations"
---

## Problem

Compact writes reduce new candidate-trace storage, but pre-activation legacy
stage rows remain until their request roots expire after 29 days. Ordinary
cascade deletion and vacuum make their table pages reusable; they need not
return the historical `recommendation_candidate_stage_evidence` allocation to
the filesystem. A separately reviewed, guarded `TRUNCATE` of a proven-empty
legacy relation may reclaim its files while preserving the dual reader and
rollback capability. Removing the table and reader is a larger, optional
retirement decision.

At the September 27 snapshot, dropping the 2.358 GB duplicate index would
leave roughly 37.15 GB of the 39.51 GB database allocated, including about
18.24 GB in the old stage relation. The synthetic compact sample used 53.8 KB
per run; at the observed 10,580 daily requests, 29 more days of writes would
be about 16.5 GB if that synthetic mix held, or about 10.5 GB when scaled to
the latest observed 113.4 rather than 178.25 stages per run. This illustrative
10–17 GB overlap explains why capacity above 50 GB may be needed while old
files remain. It is not a production forecast: traffic, evidence length,
compression, expiry, vacuum reuse, WAL, and other tables may change the peak.
Feat-554 must establish live margin, including on a 75 GB volume if resized.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md`
   — actual activation time, last legacy write, first purge, and headroom proof.
2. `docs/reports/2026-09-28-production-db-storage/storage-remediation-runbook.md`
   — rollback floor, index state, and physical-space behavior.
3. `apps/admin/prisma/schema.prisma` —
   `RecommendationCandidateStageEvidence` and `RecommendationCandidateRun`.
4. `apps/admin/src/services/recommendations/admin-ops/detail.service.ts` —
   mixed-format detail and trace-access audit.
5. `apps/admin/src/services/recommendations/retention.service.ts` and
   `apps/admin/src/workflows/recommendationRetention.ts` — request-root cascade
   and bounded catch-up.
6. `docs/reports/2026-09-28-production-db-storage/probes.sql` — guarded,
   aggregate-only production measurements.

## Grep These

- `recommendation_candidate_stage_evidence|RecommendationCandidateStageEvidence`
- `trace_format_version|trace_payload|usesCompactCandidateTrace`
- `recommendation_candidate_stage_ordinal_key|candidateStageEvidence`
- `RECOMMENDATION_CANDIDATE_TRACE_FORMAT|retention_run|roots_deleted`

## What To Build

- Establish the exact last legacy write and demonstrate that every request
  created under the legacy format has passed the 29-day expiry and was purged.
  Reconcile active legacy runs, stage rows, the retention ledger, and
  request-root cascade with bounded read-only probes. Statistics and row-count
  estimates cannot establish emptiness.
- Choose the minimum-risk forward migration from then-current measurements.
  Prefer `TRUNCATE recommendation_candidate_stage_evidence` only if the legacy
  stage relation is exactly empty and all active HTTP/workflow writers are
  compact. It preserves the table, unique constraint, Prisma model, dual-reader
  branch, and reader-capable rollback image. Use a short lock timeout and a
  strict statement budget; `TRUNCATE` takes `ACCESS EXCLUSIVE` and can briefly
  block readers/writers. In **the same migration transaction**, take the lock,
  assert `NOT EXISTS (SELECT 1 FROM recommendation_candidate_stage_evidence
LIMIT 1)`, raise an error if any row remains, then `TRUNCATE` **only this
  table, without `CASCADE`**. Test the exact probe plan and lock behavior on an
  isolated production-shaped fixture before deploying. If the lock or exact
  check exceeds its budget, fail closed and investigate; never delete retained
  rows to make the migration pass.
- Consider coordinated table/reader retirement only when there is a separate
  benefit beyond returning physical bytes. Before any `DROP TABLE`, deploy a
  no-reference reader to every Admin HTTP/workflow process and retain a
  compatible rollback image. Explicitly record the new rollback floor. Preserve
  version 1 compact detail, full evidence, request expiry, outcomes,
  evaluation, and access audit under either option.
- Measure filesystem and PostgreSQL relation bytes before and after the
  migration. Confirm actual reclaimed bytes and sustainable free-space margin;
  re-evaluate volume capacity separately if other data still grows.

## Constraints

- Depends on feat-554 production verification and a completed 29-day legacy
  lifetime. Do not infer readiness from the activation date alone if retention
  is backlogged or a legacy writer remained active afterward.
- The migration's exact in-transaction emptiness check is the final gate.
  Never substitute an estimated tuple count or a predeploy check for it, and
  never use `TRUNCATE ... CASCADE`.
- Do not delete live trace detail, backfill retained records in place, shorten
  retention, sample evidence, or run an unplanned `VACUUM FULL` on a nearly full
  production volume.
- Do not drop a table still referenced by any active Admin HTTP/workflow image
  or rollback image. Deploy through the normal PR-to-main path; do not run
  `railway up`, trigger a direct redeploy, or hand-edit an applied migration.
- Preserve the authorized Admin trace contract and audit behavior. Keep broader
  recommendation capacity graduation in feat-396.

## Verification

- Saved aggregate-only, time-bounded production probes establish the last
  legacy write, no active legacy runs, no remaining stage rows, healthy
  retention, and adequate headroom before the migration; the migration repeats
  the exact empty-table assertion while holding its lock.
- Isolated PostgreSQL tests cover compact detail/outcomes/evaluation, expired
  request cascade, a nonempty table causing migration rollback with all rows
  intact, lock-timeout recovery, successful empty-table physical reclamation,
  and rollback-floor compatibility.
- Run Admin migration, test, lint, typecheck, production-build, formatting,
  and PR-focused CI checks. After the normal deployment, verify catalog state,
  active revisions on both Admin roles, health, compact reader parity, and
  filesystem bytes reclaimed. Record timing and operator in the storage report.

## Observed Activation Horizon

At the September 27, 23:25:17 UTC fleet check, both production Admin roles ran
`ea13e146faf4c188f9fb8d40c2b9dc1e33440751` with effective compact flags and prior
processes drained. The last observed legacy write was September 27 at
23:24:43.215 UTC, expiring October 26 at 23:24:43.126 UTC (October 27 at
12:24:43 NZDT). This is an earliest expiry horizon, not an assertion that
retention will have cleared every row at that instant. Recheck the live writer
fleet, last legacy timestamp, and exact emptiness before any reclamation.
Evidence: `docs/reports/2026-09-28-production-db-storage/production-rollout.md`.
