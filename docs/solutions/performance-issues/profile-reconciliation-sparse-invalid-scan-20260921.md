---
title: "Keep sparse-invalid profile reconciliation within its transaction budget"
date: "2026-09-21"
module: "apps/admin recommendation profile reconciliation"
problem_type: "performance_issue"
component: "background_job"
severity: "high"
symptoms:
  - "Reconciliation heartbeat reports unavailable after a five-second transaction expiry"
  - "Discovery scans roughly 167,000 pointers while returning zero or very few invalid profiles"
root_cause: "wrong_api"
resolution_type: "code_fix"
tags: [recommendations, postgres, reconciliation, query-planning, jit, profiles]
---

# Sparse-invalid reconciliation needs a batch query

## Problem

The worker discovered invalid current profile generations by evaluating the
single-generation serving predicate for every pointer. `LIMIT 100` bounded the
returned profiles, not the lineage work needed to find them. The September 20
22:52:48 UTC production batch expired its 5,000 ms transaction at 5,182–5,371 ms.
Later successful heartbeats did not erase that failed batch.

## Causal evidence

The read-only aggregate production inventory contained 167,367 durable pointers,
187,793 published generations, 147,565 contributions and 42,575 interests. The
owned PostgreSQL 18 fixture uses 167,000 pointers, 126,000 qualified contributions,
42,000 interests and 28,000 session links, with synthetic identities and the real
migrations/constraints. It models a large mostly healthy population, not an exact
copy of production's distribution. It contains no exported production evidence.

The original Prisma batch failed with `P2028` at **5,033 ms**. The corrected
complete transaction passed in **1,664 ms** on the same two-CPU, 1.5 GiB database.
Three further transactions completed while an independent connection performed
reads and committed profile writes; the three tests together took 4,091 ms.
These are bounded samples, not latency percentiles or an arbitrary-load guarantee.

## What did not work

- Earlier JIT-off-only and metadata-reuse controls did not establish adequate
  transaction headroom; see the preceding execution report.
- A naive set-based invalid-ID query still hit the production five-second guard,
  both with JIT enabled and disabled. Its plan combined a sparse result with a
  LIMIT-driven nested loop over a materialized relation estimated to contain
  about 92,000 generations. Most of those predicted matches did not exist.
- The revised query materializes affected pointers before the final ordered
  batch. Two production reads completed in 2,584/2,548 ms with JIT enabled and
  1,457/1,451 ms with JIT disabled locally to their transactions.
- Local `EXPLAIN ANALYZE` for the naive candidate attributed 3,370 of 3,840 ms to
  JIT generation/inlining/optimization/emission. This is a measured compilation
  cost for this query, not a reason to disable JIT for the whole database.

## Correction

`profiles/profile-lineage.ts` retains the single-generation serving predicate and
shares its version, unsupported-interest and invalid-contribution rules with a
batch invalid-generation query. Contribution cardinalities are grouped once.
The four rules remain: current versions, exact contribution count, supporting
lineage for every interest, and eligibility of every contribution/source.

`profiles/reconciliation.service.ts` materializes that invalid set and its exact
current-pointer matches before applying the existing deterministic order and
100-pointer cap. Session links are loaded only for that batch. The existing
active-run exclusion, advisory transaction lock, 256-source bound, classification,
dispatch, privacy and pointer-generation fences remain intact.

The batch uses `SET LOCAL jit = off` after obtaining the advisory lock. The
five-second transaction budget remains unchanged. PostgreSQL restores the setting
on both commit and rollback; real-database tests verify both paths on a
single-connection pool, including a failed lock acquisition with no dispatch.

Bounded read-only production checks of the exact parameterized final query at
23:46:48 UTC returned one affected pointer in **1,520/1,440/1,397 ms**. No rows or
identifiers were exported. `SHOW jit` returned `on` before and after rollback.
These diagnostics do not deploy code or exercise the complete worker transaction.
Automatic release and sustained post-release evidence are separate gates.

## Regression and prevention

The existing CI entry `profiles/profile-projection.service.db.test.ts` includes:

- The full-scale five-second transaction regression and concurrent read/write
  control, rather than only a mocked query or successful small fixture.
- Batch-versus-serving parity for all four lineage rules, expiry boundaries,
  superseded decisions, removed contribution rows and unsupported interest kinds.
- Exact active-run/pointer-generation exclusion, deterministic dispatch order,
  available session links, 100-pointer and 256-source limits.
- Transaction-local setting restoration on success and rollback.

Existing real PostgreSQL projection/serving tests pass; deterministic cold/warm
profile retrieval measured 123/15 ms within its unchanged 1.5-second deadline.
The full Admin unit suite passed 7,281 tests. Lint and types also passed.

Inspect actual cardinality, join choice and compilation time separately. A LIMIT
is not a scan budget. Do not accept a fast query-only sample as proof that its
entire mutation transaction fits, or treat an eligibility shortcut as an
optimization. Preserve the canonical rules and test their equivalence.

## Related

- [Preceding release and rejected experiments](../../operations/watch-ticket-execution-2026-09-21.md)
- [Recommendation outcome accounting boundaries](../logic-errors/recommendation-outcome-accounting-boundaries-20260921.md)
- [Profile reconciliation ticket](../../roadmap/content-discovery/feat-459-recommendation-profile-eligibility-reconciliation.md)

This correction addresses reconciliation discovery. It does not establish the
cause of feat-496's earlier selection capability-budget delay or close feat-464's
independent operational and browser evidence gates.
