---
title: "Prove storage semantics and physical recovery separately"
date: "2026-09-30"
module: "apps/admin recommendation storage"
category: "best-practices"
problem_type: "best_practice"
component: "database"
severity: "high"
applies_when:
  - "Removing recommendation indexes or retiring historical detail"
  - "Measuring storage improvements before production activation"
tags:
  - "recommendations"
  - "postgresql"
  - "retirement"
  - "indexes"
  - "migration-testing"
---

## Context

The September 30 rollout combined index removal, new lossless formats and a finite
exception for unprotected legacy detail. Each required different proof. This
addendum records what the broader trace-capacity guidance does not cover; the
timestamped results are in `docs/reports/2026-09-30-recommendation-storage-rollout.md`.

## Guidance

Inspect constraints, foreign-key targets, ORM selectors and live consumer query
paths before removing indexes. Logical uniqueness does not imply ORM redundancy:
Prisma still requires some composite request/item selectors even when an individual
column is unique. A zero scan count is insufficient evidence. The standalone stage
expiry index had six historical scans; removal relied on root-cascade/run-leading
plans, a consumer audit and bounded lock/rollback proof.

Keep main heap, indexes, TOAST, relation total, database size, WAL and filesystem
availability as separately timestamped measurements. An index belongs to its
relation total. Removing rows can create reusable space without shrinking files;
an index drop can shrink allocation while unrelated writes hide the net filesystem
benefit. Do not extrapolate a short pre-retention interval to steady-state growth.

Protect source semantics before measuring bytes. A finite early-retirement manifest
pins the target, source, holds and cutoff; recheck them under the mutation locks.
Preserve operational roots, issued cards, expiry, lineage and protected observations.
Admin must distinguish retired detail from missing or incomplete evidence. Abort on
new investigation/owner links, contention or changed source. A successful manifest
does not authorize replay, a larger cohort or physical reclamation.

Measure DDL blocking against the serving budget. The exposure index's narrower key
was smaller locally, but an ordinary build took 2.06 seconds against a 1.5-second
budget; a one-second bounded attempt failed safely. Defer it to a separately
reviewed online-build design instead of treating potential bytes as realized savings.

Runtime-backed native tests need the current schema. Use
`apps/admin/src/services/recommendations/current-schema.test-fixture.ts` and its
`recommendationRuntimeMigrationSql` helper when tests import current application
code. Keep intentionally historical migration-upgrade tests on their fixed chains.

## Why This Matters

Disk recovery and application correctness are independent outcomes. A cleanup can
delete valuable audit history without returning files; a smaller index can stall
serving; a green test with stale schema can fail after unrelated main migrations.
Reader-capable rollback images must outlive all data written in new formats.

## When to Apply

Apply these checks when changing persistence formats, removing constraints/indexes,
authorizing finite cleanup, or forecasting capacity before retained cohorts expire.

## Examples

The first retirement pilot removed 1,063 legacy rows: 1,062 unprotected observations
were intentionally retired, and one protected observation was converted losslessly.
All 64 original holdouts and 8,621 observations remained preserved. Exact retained
metadata fingerprints matched for 73 runs. Legacy relation allocation stayed
18,393,112,576 bytes. No immediate filesystem saving was credited.

## Related

- `docs/solutions/best-practices/recommendation-trace-capacity-and-retention-proof-20260928.md`
- `docs/solutions/database-issues/recommendation-retention-cascade-lock-order-20260929.md`
- `docs/solutions/logic-errors/shadow-cohort-receipts-must-survive-retention-20260929.md`
- `docs/operations/early-legacy-recommendation-detail-retirement.md`
- `docs/reports/2026-09-30-recommendation-fact-index-efficiency.md`
- `docs/reports/2026-09-30-recommendation-stage-expiry-index.md`
- `docs/reports/2026-09-30-watch-exposure-index-feasibility.md`
