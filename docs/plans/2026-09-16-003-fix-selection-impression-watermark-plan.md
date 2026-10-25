---
title: Preserve impression receipt ordering during selection attribution
type: fix
status: completed
date: 2026-09-16
roadmap: feat-496
---

# Preserve impression receipt ordering during selection attribution

Production trace `2089744889511763809` fails selection creation with PostgreSQL
`P0001`: attribution requires an eligible impression. Selection captures `now`
before database and token work. An impression can commit with a later receipt
while selection waits, then selection reads it under the item lock but uses its
older `now` as `attributionEligibleAt`. Migration 0075 correctly rejects a marker
older than the impression receipt. The existing real database concurrency test
uses the same timestamp for both operations and cannot distinguish this race.

## Scope

- Reproduce creation with different receipt times against the actual PostgreSQL
  trigger; cover creation and both replay reconciliation paths in unit tests.
- Derive attribution eligibility from the later server receipt timestamp,
  preserving the selection receipt, browser occurrence time, expiration,
  immutable attribution, advisory lock, and exact replay/conflict rules.
- Carry that eligibility watermark into asynchronous profile feedback.
- Retain existing timeouts and constraints. No migration, relaxed validation,
  client API change, homepage activation, or native UI change.
- Review sibling evidence reconciliation for the same ordering assumption.

## Validation and release

Run focused unit and real PostgreSQL regressions red/green, Admin tests, types,
lint/build and formatting. Review data integrity, concurrency, API compatibility
and correctness sequentially under the repository agent policy. Merge through
normal PR/main and verify the exact Admin revision plus normal production
selection/playback. Preserve independent unresolved application latency findings
in feat-496; this fix does not explain all 700 ms upstream timeouts.

The 29 focused unit tests and eight real PostgreSQL cases pass, including the
red/green reproduction of the production trigger error. All 7,204 Admin tests,
types, lint, build and repository formatting passed. Sequential review found no
remaining code findings. PR #2315 passed CI and merged as
`b96f5f738d3357e228da1d05bb79ec9ea2d02d68` at 00:17:25 UTC on September 16.
Automatic Admin deployment `039ade97-db71-4c2c-bbdd-b2c1c61ffd3b` reached SUCCESS;
SSH verified that exact revision and both compiled timestamp fixes at 00:24:29.
The warm production check passed all six selection acknowledgments, all 12
recommendation responses and correct navigation without JavaScript errors.
The first playback check passed but used a timeout fallback; full outcomes are in
`docs/operations/watch-runtime-followup-2026-09-16.md`. The broader feat-496
incident remains in progress for the independent latency failures.
