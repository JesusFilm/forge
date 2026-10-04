---
title: Bound recommendation retention's profile tail under the existing deadline
type: bugfix
status: active
date: 2026-10-03
---

# Recommendation retention profile-tail repair

## Scope and observed failure

Platform feat-554 remains in progress. The October 2 10:30 UTC normal
retention attempt failed after committing 100 expired request roots, 371 served
items and 8,265 expired profile projection runs. Its next transaction was
admitted with 80 ms left on the existing five-second whole-run deadline, then
expired at commit after 94 ms. The workflow wrapper took 5,069 ms. Later
scheduled attempts recovered the day, but the cycle is not failure-free.
September 30 and October 1 also recovered after failures. Aggregate-only
production evidence is in the October 2 daily receipt.

The service deletes expired projection runs, contributions, interests and
generations with unrestricted `deleteMany` calls. The failed row has a committed
projection-run count and no committed contribution count. This establishes a
large tail phase and the immediately following timeout; it does not prove the
exact SQL statement that consumed every millisecond.

## Repair and acceptance

1. Reproduce the loaded first batch and subsequent root-free continuation in
   an owned loopback PostgreSQL fixture. Assert that all profile-tail families
   are processed in bounded pages and that the success/continuation state
   remains truthful until the expired auxiliary backlog drains.
2. Bound each profile-tail delete by the configured batch size, selecting
   ordered IDs and deleting the selected set within one existing advisory-locked
   transaction. Keep the five-second whole-run deadline, 29-day expiry,
   committed counters and privacy/lock order unchanged. A full selected page
   must request continuation even when request roots are already drained.
3. Run the native regression, adjacent retention tests, scoped format/type
   checks and required CI. Open one scoped PR. Parent reviews and merges;
   production changes use normal PR-to-main only.
4. Preserve feat-554 in progress and the existing daily monitor. The repair
   requires two subsequent normal failure-free loaded cycles before ticket
   closure. Do not trigger a manual purge for acceptance.

## Limits

No production fault injection, manual purge, budget increase, scheduler change
or unrelated recommendation change is part of this repair. Historical recovery
and a native fixture do not count as a qualifying production cycle.

## Local verification

On an owned loopback PostgreSQL 18 database with all 128 current migrations,
the new profile-tail fixture, adjacent composition-retention fixture and
service/job tests passed together (57 tests). The loaded native test drained
3,000 expired projection runs in thirty 100-row passes: two alongside request
roots and 28 with no roots, followed by an empty drain check. A second native
fixture proved that 120 live recommendation
decisions and four live projection runs survive bounded reference detachment
while expired generation children and parents finish. Admin typecheck, scoped
ESLint, Prettier and diff whitespace checks passed. These are local tests;
the two normal failure-free loaded production cycles are still outstanding.
