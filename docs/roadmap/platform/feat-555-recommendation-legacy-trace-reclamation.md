---
id: "feat-555"
title: "Reclaim legacy recommendation trace storage after expiry"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-29"
duration: 3
depends_on: []
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
  - "operations"
---

## Problem

Preparation started September 29: review and test the guarded SQL outside the
automatic migration path. Production execution remains blocked by fresh
fleet, capacity, source and exact-emptiness checks. Ordinary legacy expiry and
purge is one route to exact stage-table emptiness; the
separately authorized feat-575 finite early-retirement campaign is another.
Preparing this operation does not complete this ticket or authorize an early
deployment. Feat-554's two loaded normal-retention cycles remain required to
close retention/capacity verification, but an independently proven early-empty
relation need not wait for those cycles before a separately reviewed guarded
migration.

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
7. `docs/operations/legacy-recommendation-stage-reclamation.md` — inactive
   preparation asset, dedicated fixture and future migration entry gates.

## Preparation Evidence

The inactive SQL and dedicated PostgreSQL proof are documented in
`docs/validation/recommendation-legacy-reclamation-20260929/README.md`.
Six real-database cases and a connection-target guard case passed, including
retained-row refusal, writer races, lock timeout, atomic rollback, restrictive
foreign-key behavior and preservation of compact detail and expiry. Normal
retention left 1,425,408 local relation bytes allocated; guarded reclamation
reduced that fixture to 32,768 bytes. These are local relation bytes, not
production filesystem savings or production-sized scan/lock timing proof.

No numbered migration or deployment hook is added. The later promotion PR must
re-establish all production gates and rerun the dedicated proof and current
migration/build checks. This ticket remains in progress through actual
production reclamation and measured filesystem recovery.

## Grep These

- `recommendation_candidate_stage_evidence|RecommendationCandidateStageEvidence`
- `trace_format_version|trace_payload|usesCompactCandidateTrace`
- `recommendation_candidate_stage_ordinal_key|candidateStageEvidence`
- `RECOMMENDATION_CANDIDATE_TRACE_FORMAT|retention_run|roots_deleted`

## What To Build

- Establish the exact last legacy write and reconcile legacy runs, stage rows,
  the retention ledger, and request-root cascade with bounded read-only probes.
  Under ordinary expiry, demonstrate every legacy request passed 29 days and
  was purged. Under the authorized early route, demonstrate every remaining
  unexpired stage detail was either safely retired or converted losslessly;
  expired roots still require ordinary bounded retention. Retired run metadata
  and request roots remain until original expiry, so zero legacy-format runs
  is not an early-route prerequisite. Statistics and row-count estimates
  cannot establish stage-table emptiness.
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

- The ordinary route requires a completed 29-day legacy lifetime; the
  authorized feat-575 early route
  requires finite, reviewed retirement/conversion receipts and exact empty
  stage-table proof while preserving original root/item/run expiry. Neither
  route can infer readiness from the activation date if retention is backlogged
  or a legacy writer remained active afterward. The early route requires
  measured batch throughput, WAL and live headroom, normal bounded cleanup of
  expired roots, converged compact writers, compatible readers and rollback,
  and the native guarded-migration proof. Feat-554's first two loaded normal
  retention cycles remain open until measured; they are a closure requirement
  for that ticket, not an early-empty migration prerequisite.
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
  legacy write, no remaining stage rows, healthy retention, and adequate
  headroom before the migration; the migration repeats the exact empty-table
  assertion while holding its lock. Under the early route, remaining retired
  run metadata is expected and must not be mistaken for retained stage rows.
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

## September 30 Authorized Exception

Feat-575 (formerly feat-572) separately permits finite early retirement of
unprotected legacy stage detail while preserving exact protected observations,
request roots, served items and ordinary privacy expiry. The first ten-run pilot
removed 1,063 stage rows with zero immediate filesystem savings; see
`docs/reports/2026-09-30-recommendation-storage-rollout.md`. This supersedes the
expiry-only route solely for that explicitly reviewed category. Remaining
protected/uncertain legacy detail still blocks reclamation until converted under
separate review or normally expired. All exact-emptiness, fleet, locking,
current retention health, expired-root cleanup, capacity and separately
reviewed deployment gates remain. Feat-554's two loaded normal cycles stay
open as subsequent monitoring/closure proof, even if the early empty-table
migration succeeds first.
