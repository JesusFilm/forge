---
id: "feat-554"
title: "Roll out compact recommendation traces and verify production headroom"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-09-28"
duration: 2
depends_on:
  - "feat-558"
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
  - "operations"
---

## October 2 NZDT status: loaded retention still open

The October 1 22:51 UTC production read confirmed 25,630,932,992 B of direct
PGDATA availability, 553,648,128 B of WAL files, healthy compact Admin HTTP and
worker processes, zero recent legacy writes/missing compact payloads, and an
empty 24,576-B legacy stage relation. Feat-555/575 are complete; U1–U3 storage
efficiency is complete in feat-574. See
`docs/reports/2026-10-02-recommendation-storage-efficiency-closeout.md` for exact
format, capacity and retention evidence.

October 1's scheduled retention eventually committed 7,846 roots and 27,216
served descendants, but four attempts failed first. That day is **not** a
qualifying failure-free loaded cycle; neither was September 30. Current count:
zero. The next normal starts are October 2 and 3 at 10:30 UTC (23:30 NZDT each
date). Each must remove actual expired roots and descendants without failure,
with acceptable lock skips, backlog and headroom. Do not substitute a manual or
zero-deletion run. The daily monitor remains active. No supported monthly growth
forecast follows from the post-reclamation snapshot; preserve this gate until
two real normal loaded cycles pass or a proved defect is repaired and retested.

## Problem

The remediation preserves full 29-day trace history and reduces new trace
storage. PR #2429 is deployed on both production Admin roles, migrations
0100–0102 passed, and removing the redundant index returned approximately
2.37 GB of allocation (2.34 GB net additional filesystem space over the measured
interval). PR #2433 activated compact writes through the normal release path; both
actual processes were verified on the new revision with compact flags and
healthy roles at 23:25:17 UTC.
A local synthetic benchmark and immediate disk relief do not prove live
cascade deletion throughput or full-transition headroom.

## Entry Points — Read These First

1. `docs/reports/2026-09-28-production-db-storage/storage-remediation-runbook.md`.
2. `docs/reports/2026-09-28-production-db-storage/README.md` and `probes.sql`.
3. `apps/admin/prisma/migrations/0100_recommendation_candidate_compact_trace/migration.sql`.
4. `apps/admin/prisma/migrations/0102_recommendation_candidate_stage_duplicate_index_drop/migration.sql`.
5. `apps/admin/src/config/env.ts` — `RECOMMENDATION_CANDIDATE_TRACE_FORMAT`.
6. `apps/admin/src/workflows/recommendationRetention.ts` — bounded continuation.

## Grep These

- `RECOMMENDATION_CANDIDATE_TRACE_FORMAT|trace_format_version`
- `recommendation_candidate_trace_format_check`
- `recommendation_candidate_stage_run_stage_idx`
- `batchLimitReached|catchUpNeeded|overdueAfterRun`

## What To Build

- Refresh read-only disk, relation, index, WAL, and growth measurements. Coordinate
  capacity protection before the remaining operational headroom is exhausted.
- Deploy through PR-to-main with the default legacy writer; verify migrations,
  constraints, duplicate-index removal, and legacy detail on every Admin replica.
- Confirm a reader-capable rollback image, then enable compact writes through
  the normal configuration/deployment process. Verify representative complete
  traces, outcomes, evaluation, and default behavior on all serving lanes.
- Measure write latency, error rate, daily storage growth, purge batch duration,
  deleted roots and descendants, WAL, lock waits, oldest expired age, and vacuum
  reuse through the first nonempty production request purge and the next daily
  cycle. Preserve 29-day retention and all detail.
- Record the last legacy write and any rollback. Once all legacy traces expire,
  plan a separate migration to retire old storage and reclaim its allocation.
  Do not rewrite a nearly full live table or perform unreviewed retained-trace
  backfills. The separately reviewed feat-560 ten-run lossless conversion pilot
  preserved all observations and expiry; it does not authorize bulk conversion
  or establish immediate filesystem savings.

## Verification

- Migrations 0100–0102 are finished; compact check is validated; the unique
  stage-ordinal index remains and the duplicate index is absent.
- Mixed-format detail matches the established Admin contract. Compact runs have
  complete payloads and no new legacy rows; default-legacy rollback remains
  readable on the reader-capable release.
- Loaded retention removes expired roots and their descendants at a rate above
  incoming volume without request errors or transaction-budget failures.
- Available disk and its slope support the 29-day overlap with explicit margin.
- Store timestamps, measurements, release versions, activation time, operator,
  rollback trigger, and final decision in the storage investigation report.

## Constraints

No production deployment, index change, deletion, or capacity change is authorized
by a local test result. Follow the normal release process and existing access
policy. Wider recommendation capacity graduation remains feat-396.

## Rollout Record and Open Gates

`docs/reports/2026-09-28-production-db-storage/production-rollout.md` is the
timestamped release and evidence record. The reader-compatible rollback floor
is `2cc8105ffb00a9f595cefe10594bd8537561099f` on both roles; production activation
release is `ea13e146faf4c188f9fb8d40c2b9dc1e33440751`. Compact fleet convergence
and bounded parity passed for the latest 100 compact and 100 legacy runs,
with no new legacy writes after fleet convergence. Initial operational logs
showed no observed recommendation errors/timeouts in the ten-minute window;
see the report for sample sizes, latency, and coverage limits. The last observed legacy
write expires October 26 at 23:24:43.126 UTC, subject to a later legacy rollback
and actual retention purge; feat-555 must re-establish the live horizon.

Keep this ticket in progress until the remaining gates are demonstrated:

- Authenticated compact detail smoke passed September 28; protected compact and
  retired-detail smoke passed September 29. Repeat against the eventual
  reclamation release; these bounded samples do not prove universal quality.
- Full 29-day capacity margin; the proposed nominal 75 GB buffer is not applied.
- September 30's first nonempty purge and the following daily cycle, including
  actual deletion throughput, continuation, errors, oldest-expired age, and WAL.

The existing `recommendation-storage-follow-up` local Codex heartbeat checks
every six hours and reports meaningful changes or failures. It requires the
computer to be on and Codex running. Physical empty-table reclamation remains
feat-555: it may follow proven natural expiry/purge or the separately authorized
finite early retirement and lossless conversion path. Feat-554 still requires
two loaded normal retention cycles and capacity monitoring before it can be
marked complete, even if feat-555 reclaims a proven-empty relation first.

## October 2 Reclamation and Remaining Retention Gate

`docs/reports/2026-10-02-legacy-stage-reclamation.md` records completed owner-authorized
bulk legacy disposal: 16.431 GB relation recovery and 25.512 GB available filesystem
space. Feat-555 and feat-575 are complete; this ticket stays in progress.
September 30 and October 1 normal loaded cycles recovered after failures, so neither
qualifies as failure-free acceptance. Require two normal loaded cycles with no
failures, sufficient descendant throughput, acceptable expired backlog/lock skips
and continued headroom. The next scheduled cycle is October 2 at 10:30 UTC.

The active `recommendation-storage-daily-check` monitor runs every 24 hours and
supersedes the earlier heartbeat schedule described above. The old finite deletion
job is permanently stopped. Follow `unattended-latest.json` and its bulk-disposal
receipt; never restart the expired campaign. No new monthly steady-state forecast
or universal quality claim follows from the reclamation measurement.

## September 30 Supplement

`docs/reports/2026-09-30-recommendation-storage-rollout.md` records further index
work and the first owner-authorized early-retirement pilot. Feat-575 (formerly
feat-572) permits early retirement of unprotected legacy stage detail only; all
protected evidence and operational records keep normal expiry. This exception
does not satisfy the two loaded-retention cycles or capacity gates above.
