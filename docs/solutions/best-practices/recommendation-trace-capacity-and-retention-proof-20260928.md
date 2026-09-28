---
title: "Budget recommendation traces by stage amplification and prove loaded retention"
date: "2026-09-28"
last_updated: "2026-09-29"
module: "apps/admin recommendation tracing"
category: "best-practices"
problem_type: "best_practice"
component: "database"
severity: "high"
applies_when:
  - "Adding candidate generators or detailed recommendation evidence"
  - "Setting trace retention or validating a purge scheduler"
  - "Investigating PostgreSQL volume growth"
  - "Reclaiming empty legacy trace allocation while preserving its schema"
tags:
  - "recommendations"
  - "postgresql"
  - "capacity"
  - "retention"
  - "indexes"
  - "reclamation"
  - "truncate"
  - "lock-budget"
---

## Context

The September 28 production investigation found recommendation tables using
28.38 GB of a 39.51 GB database. Candidate-stage evidence alone used 20.60 GB,
including a redundant 2.36 GB index. Production had 29 successful retention
runs but had never deleted an expired request root: its first 29-day cohort
had not expired. The follow-up implementation passed production migration and fleet checks;
removing the duplicate index returned approximately 2.37 GB of allocation.
Loaded retention and full-transition capacity verification remain separate work.

The detailed measurements and attribution are in
`docs/reports/2026-09-28-production-db-storage/README.md`; operational follow-up
is `docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md`.
Actual release evidence is in
`docs/reports/2026-09-28-production-db-storage/production-rollout.md`; this
document distinguishes established storage behavior from still-open capacity
and loaded-retention proof.

## Guidance

### Count persisted observations, not displayed cards

Use the complete storage model:

```text
retained bytes ≈ requests/day × observations/request × bytes/observation
                 × retention days + indexes + other tables + maintenance margin
```

`orchestration.ts` repeats candidate provenance across nominated,
canonicalized, deduplicated, rejected, scored, ordered, and composed stages.
A pool capped at 64 candidates is not a cap of 64 evidence rows. At the measured
traffic mix, semantic runs averaged 63 observations, hybrid runs 196, and
curated fallback runs 324. Bulk-inserting the same observations improves write
overhead without reducing retained data.

Before changing a generator, measure its full stage-row count and serialized
evidence bytes through `delivery.service.ts`. Include actual PostgreSQL index
sizes, and reconcile run counters with a bounded sample of persisted rows.

### Compare live indexes with constraint-backed indexes

Inspect `pg_index`, `pg_constraint`, and `pg_get_indexdef`, not only explicit
`CREATE INDEX` statements. A UNIQUE constraint already creates an index.
The candidate evidence model declared both `@@unique([runId, stage, ordinal])`
and `@@index([runId, stage, ordinal])`; the latter duplicated an existing
access path. Preserve the constraint and verify validity, columns, predicates,
opclasses, included columns, and dependencies before removing an index.

### Distinguish retention freshness from retention capacity

A successful zero-root purge proves scheduling and a no-expired-root path.
It does not prove cascade deletion, throughput, transaction budgets, or vacuum
behavior under load. Keep freshness, backlog age, roots deleted, and deletion
throughput as separate observations.

Use an isolated production-shaped fixture with expired roots, realistic
descendant counts, active writes, and a backlog that is expired but not yet
24 hours overdue. Gating catch-up on `overdueAfterRun` can defer remaining work
until the next daily wake even though those roots can breach the serving-health
threshold before then. The remediation uses capped-selection saturation as a
separate continuation signal, preserves health semantics, and accepts replayed
workflow results from before the signal existed.

### Compact immutable traces without discarding evidence

When the only detailed consumer loads one complete run, one versioned JSONB
document can avoid per-stage tuple and index overhead and compress repeated
provenance. Keep operational summary columns relational; let the existing
request ownership and cascade own the payload. Preserve bounded SQL projections
for Admin detail, database shape checks, and atomic issuance.

Deploy mixed-format readers first, keep new writes disabled by default, and
retain a reader-capable rollback image after activation. Disabling compact
writes does not make old row-only readers safe while compact traces remain.
Measure complete physical relations with indexes and TOAST against a legacy
baseline with redundant indexes already removed. Assert equal population before
comparing vacuum/replacement behavior and report latency tradeoffs alongside
space savings. The implementation's synthetic fixture measured 75.1% less trace
storage. Write timings varied and full detail reads were slightly slower;
production savings and latency remain to be measured. Select only the needed
columns after ORM inserts so storing a large payload does not also return it to
the application unnecessarily.

The first expiring cohorts may be smaller than current incoming cohorts.
Compare cohorts by bytes or stage rows, not just request counts. In this case,
September 1 recorded 487,000 observations while September 26 recorded
1.02 million. Reaching day 29 therefore did not imply an immediate plateau.

### Measure logical storage and physical headroom separately

Record `pg_database_size`, relation totals, table/index split, WAL, `df`
available bytes, and platform volume history with timestamps. Label estimated
row counts and keep GB/GiB units explicit. A platform series can use different
accounting from the database and filesystem.

Ordinary DELETE and vacuum generally make space reusable inside PostgreSQL;
they do not guarantee the filesystem chart shrinks. Avoid prescribing a table
rewrite on a nearly full volume without the additional capacity and locking
plan it needs. See
[PostgreSQL vacuum guidance](https://www.postgresql.org/docs/18/routine-vacuuming.html#VACUUM-FOR-SPACE-RECOVERY).

### Treat fleet state and config state as separate release evidence

A staged Railway variable is not proof of the existing process's value.
Verify both the HTTP service and durable worker by active deployment inventory,
actual process revision, effective flag, health, and workflow-runner role.
The deployment inventory can contain a building release alongside the old live
release; wait for convergence and old-process drain before advancing a reader
compatibility barrier. Record a compatible rollback image for each role.

After every legacy writer drains, its last write establishes an earliest
reclamation horizon, not permission to delete. Any resumed legacy writing
moves the horizon. Once retention has made the legacy table exactly empty,
a guarded empty-table `TRUNCATE` can reclaim its allocation while retaining
schema and reader compatibility. Keep the emptiness assertion and truncate
under the same lock/transaction, fail closed, and omit `CASCADE`.

### Prove empty-relation reclamation before scheduling it

The inactive preparation asset at
`apps/admin/src/services/recommendations/sql/reclaim-empty-legacy-stage-relation.sql`
is outside automatic migrations and deployment hooks. It obtains `ACCESS
EXCLUSIVE`, asserts exact emptiness, and truncates in one transaction, with a
one-second lock timeout and ten-second statement timeout. Default restrictive
semantics refuse new inbound foreign keys. A late legacy writer waits for the
lock and can insert after commit; the operation does not retire a writer.

The dedicated `legacy-stage-reclamation.db.test.ts` passed six PostgreSQL 18
cases covering retained-row refusal, reader contention, writers before and
after lock acquisition, normal expiry, allocation recovery and transaction
rollback. The final fixture retained 1,425,408 allocated bytes after deletion;
truncate reduced that to 32,768 bytes. Compact detail, items, outcomes,
evaluation and expiry stayed unchanged, and fresh legacy issuance still worked.
These are local relation bytes, not production filesystem savings or proof of
scan latency on an 18 GB empty relation.

Because this proof truncates a whole relation, require a separately owned
loopback `forge_legacy_reclamation_*` database. Reject connection-string query
parameters and fragments: the PostgreSQL driver can honor a `host` query
override even when the parsed URL hostname is loopback. A network-free guard
case verifies this boundary before the database proof can run.

Promote the asset only in a later reviewed migration after loaded retention,
actual expiry and purge, compact-fleet convergence, rollback-reader and capacity
gates pass. Keep all observations for their 29-day lifetime and preserve the
schema and dual reader. See
`docs/validation/recommendation-legacy-reclamation-20260929/README.md` for the
bounded proof and outstanding production gates.

## When to Apply

Apply these checks before expanding candidate pools, retaining additional
provenance, enabling a new fallback generator, or treating a retention
watermark as proof that a fixed-size volume can support steady-state traffic.
The original recommendation capacity plan already names database growth,
purge duration, and index size as measurements; run those gates before the
first expiry boundary rather than postponing them to broad infrastructure
graduation.

## Related Documentation

- `docs/operations/semantic-recommendation-tracer.md` — current lifecycle contract.
- `docs/roadmap/content-discovery/feat-396-recommendation-privacy-capacity-graduation.md` — broader capacity exercises.
- `docs/solutions/performance-issues/semantic-recommendation-retrieval-bounded-pgvector-fanout.md` — serving latency, a separate budget from retained storage.
