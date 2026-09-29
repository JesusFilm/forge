---
title: "Skipping empty profile bootstrap must preserve first-source recovery"
date: "2026-09-30"
category: "architecture-patterns"
module: "Admin recommendation profiles"
problem_type: "architecture_pattern"
component: "background_job"
severity: "high"
applies_when:
  - "Avoiding initial empty projection jobs to reduce storage"
  - "Combining serializable classifiers with ordinary dispatch transactions"
tags:
  - "recommendations"
  - "profiles"
  - "postgresql"
  - "serializable"
  - "reconciliation"
  - "storage"
---

# Skipping empty profile bootstrap must preserve first-source recovery

## Context

Most first durable profile generations in the measured production cohort declared
no evidence. Avoiding their creation can save a job, generation and pointer, but
the existing initial job also provides a narrow recovery opportunity: it can read
an eligible source committed before its evidence load even when asynchronous
feedback fails. Removing the job without replacing that opportunity changes
learning behavior. Empty counters also do not prove that pending raw evidence is
absent or that an old generation can safely be deleted.

This learning describes the preparatory implementation and its release gates.
The skip remains disabled until validation, review and actual fleet convergence;
no production saving or completed activation is implied.

## Guidance

Admit an ordinary first empty skip only under the existing dispatch scope lock,
with a valid active profile/privacy generation and session link, no pointer or
retained generation/run, and no raw source across active linked sessions. Raw
selection and playback episodes matter even before eligibility or embeddings are
available. Check all current evidence-loader channels too; a new persisted source
channel requires a corresponding raw absence guard. Feedback, explicit
reconciliation, forced work and later empty replacements keep their normal path.

Reserve an existing pending projection run in the same transaction as the first
profile-eligible decision. Acquire the scope and profile/link authority before
writing eligibility, following retention's authority order. Recheck prior state
under those locks. Exact decision replay may repair a missing reservation. The
existing indexed stale-run reconciler can then discover an unstarted reservation
after callback failure; this needs neither a marker for every empty profile nor
an unbounded raw-source sweep. Classification that never succeeds remains a
separate, pre-existing best-effort limitation.

An advisory lock does not refresh a Serializable snapshot. A classifier can start
its snapshot, wait for an ordinary dispatch to create the first run, and still
read the old no-run state after acquiring the lock. A try-lock does not cover the
case where dispatch commits between snapshot creation and lock acquisition.
The first ordinary run creation therefore performs a profile row-version fence
under the scope lock:

```sql
UPDATE recommendation_profile
SET updated_at = updated_at
WHERE /* active matching scope, no prior generation or run */;
```

The actual query has all of those predicates. It preserves recency and expiry,
but is a physical write with WAL cost. A classifier's later `FOR SHARE` on a
changed row causes a serialization conflict and a fresh bounded transaction
retry. A successfully skipped scope does not perform this update. Two competing
Serializable classifiers require their own native proof; do not assume either
duplicate writes or successful SSI retry from the advisory lock alone.

Reuse an unstarted reservation across a later evidence watermark only while no
generation exists, and only for ordinary status/feedback work. Forced rebuilds
and explicit reconciliation causes must retain their requested semantics.

Deploy the additive reservation and row-version fence with the skip disabled.
Verify every HTTP and worker replica before activating the skip in a separate
reviewed release. Rollback images must retain recovery as well as the existing
mixed vector and served-item readers. Turning the flag off restores future
initial dispatches; it does not justify returning to an image without recovery.

## Why This Matters

A storage optimization can remove an incidental recovery mechanism while passing
happy-path tests. Mocked transactions cannot prove snapshot visibility, lock
ordering or retry behavior. Native tests must use the production PrismaPg adapter
and set both ORM schema and raw SQL search path: the adapter's error wrapping is
part of the retry contract. SQLSTATE `40001` and deadlock `40P01` are different;
do not broaden retries to hide an incorrect lock order.

Allocation proof is separate from correctness. Preserve the common profile,
consent and session-link footprint in a comparison. State whether workflow-engine
rows are included, measure WAL separately, and disclose extra empty-status reads.
A local fixture reduction is not reclaimed production disk or a steady-state
monthly forecast.

## When to Apply

Use this pattern when removing initial empty work from a system whose callbacks
are asynchronous and whose durable recovery scans existing jobs or pointers.
Keep retained history, privacy lifetimes and later empty state transitions intact.

## Examples

The native suite in
`apps/admin/src/services/recommendations/profiles/profile-projection.service.db.test.ts`
is the verification entry point. Its release checks must cover both status-lock
orders, both stale-snapshot interleavings, distinct concurrent first sources,
callback/start failure followed by reconciliation and nonempty publication,
retention authority overlap, force/late-watermark behavior, privacy reset and
erasure. Scope lock-wait assertions to the actual lock identity and database;
unrelated CI lock waiters must not satisfy the concurrency precondition.

Final counts, adapter coverage, timing and allocation results belong in
`docs/validation/recommendation-storage-20260930/initial-profile-bootstrap.md`.

## Related

- [Raw Prisma serialization retries](../database-issues/prisma-raw-serialization-retry-and-token-error-boundaries-20260916.md)
- [Retention cascade authority order](../database-issues/recommendation-retention-cascade-lock-order-20260929.md)
- [Bounded profile reconciliation](../performance-issues/profile-reconciliation-sparse-invalid-scan-20260921.md)
- [Separate semantic and physical storage proof](../best-practices/recommendation-storage-semantic-and-physical-proof-20260930.md)
- [Storage efficiency roadmap](../../roadmap/platform/feat-574-recommendation-storage-efficiency.md)
