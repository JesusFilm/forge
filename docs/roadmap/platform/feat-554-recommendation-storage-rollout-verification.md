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

## Problem

The local remediation preserves full 29-day trace history and reduces new trace
storage, but production remains at the investigation's reported capacity risk
until the change is reviewed, deployed, and compact writes are enabled. A local
synthetic benchmark is not proof of live cascade deletion throughput or volume
headroom.

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
  Do not rewrite a nearly full live table or backfill retained traces in place.

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
