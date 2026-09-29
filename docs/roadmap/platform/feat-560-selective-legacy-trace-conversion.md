---
id: "feat-560"
title: "Convert selected legacy traces and remove redundant stage rows"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-09-28"
duration: 2
depends_on: []
blocks: []
tags: [admin, recommendations, database, capacity, operations]
---

## Problem

The user requested selective legacy cleanup while retaining useful development
evidence. Removing detail loses diagnostic value and does not guarantee physical
disk recovery. Existing compact payloads can preserve representable traces while
redundant legacy stage rows are removed atomically.

## Entry Points — Read These First

1. `docs/plans/2026-09-28-002-fix-recommendation-traffic-isolation-plan.md`, U3/U4.
2. `apps/admin/src/services/recommendations/candidate-trace.ts` and
   `admin-ops/detail.service.ts`.
3. `apps/admin/prisma/migrations/0100_recommendation_candidate_compact_trace/migration.sql`.
4. `docs/roadmap/platform/feat-555-recommendation-legacy-trace-reclamation.md`.

## Grep These

`trace_format_version`, `trace_payload`, `EXCEPT ALL`,
`recommendation_candidate_stage_evidence`, `evidenceComplete`.

## What To Build

Implement dry-run-first bounded candidate selection and a lossless per-run
conversion command. Freeze quality-audit/active-investigation exclusions first.
Validate exact stored-value/reader parity before deleting redundant rows in the
same transaction. Keep root/run/items/outcomes and expiry unchanged. Supply
bounded pilot, restart and stop guidance with measured allocation/WAL tradeoffs.

## Constraints

No blanket deletion or invented bot attribution. Skip unsupported traces.
Preserve incomplete/failure/curated and linked investigation cohorts initially.
No automatic production execution on deploy. DELETE is not filesystem reclamation;
feat-555 remains a separately guarded exact-empty operation. No extended retention.

## Verification

Disposable PostgreSQL parity, precision/expiry/counter failures, rollback,
idempotency, manifest/hold validation and retention concurrency. Before any
production pilot refresh exact target identity, compact fleet, headroom and
retention health. Record actual rows/bytes converted and current filesystem
headroom; never substitute logical estimates for recovered disk.

## Completion

PR #2441 merged and reached both Admin roles on September 28. The reviewed
ten-run production pilot converted 689 redundant stages with zero skips;
SQL fingerprints and parent/item/expiry hashes matched exactly afterward.
All 689 observations remain in compact payloads. The original 64 quality holds
and linked investigation exclusions remained protected from this operation.
No larger batch followed. Filesystem headroom remained approximately 11.21 GB;
legacy relation allocation was unchanged. See
`docs/validation/recommendation-traffic-isolation-20260928/README.md` for precise
times, shared WAL/allocation measurements, serving samples and their limits.
Existing 29-day retention remains; physical reclamation is still feat-555.
