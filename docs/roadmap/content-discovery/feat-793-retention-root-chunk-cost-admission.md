---
id: "feat-793"
title: "Use observed root chunk cost for retention admission"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-10-27"
duration: 1
depends_on: []
blocks: []
tags: [recommendations, retention, postgres, reliability]
---

## Problem

The October 27 second manual window committed 50 roots in a 1,387 ms root
phase, then admitted another root phase with 853 ms remaining. The latter operation failed because its transaction had timed out during
`recommendationRequest.deleteMany`. Its earlier 50 committed roots remain
counted in the failed run. Exact cascade cost and production CPU attribution
are not established.

## Scope

In `apps/admin/src/services/recommendations/retention.service.ts`, remember only
the most recent acknowledged root phase's elapsed time within the invocation.
At each existing root-phase admission boundary, require remaining time above
both that observation and the existing 750 ms baseline. Keep the five-second
run deadline, 50-root chunks, expiry/privacy guards, transaction boundaries and
committed counters. Other phases and the first root chunk keep existing rules.

Yield honestly before work: backlog remains unknown, continuation is required,
and the success watermark does not advance. An unexpectedly expensive later
chunk can still fail; preserve that failure and its committed partial counts.
This is observed-cost admission protection, not a demonstrated query/index
optimization or production CPU improvement. The separate feat-554 operational
verification remains in progress.

## Verification

- Unit boundaries: below/equal/above observed cost and existing baseline;
  initial chunk, acquisition/configuration delay, and more expensive next chunk.
- Native PostgreSQL: first 50 roots commit, a modeled slow acknowledgement
  prevents second cleanup, live roots survive, and a fresh invocation progresses.
- Retain existing failed-commit/terminal-write accounting regressions.
- Focused tests, full Admin typecheck, lint/format and independent review.

## Resolution and proof boundary

Root admission now uses the most recent acknowledged root phase's elapsed time
at all three existing admission checks. The first chunk still uses 750 ms; the
observation resets for each invocation. Diagnostic fields and parsers are
unchanged. A cheaper prior chunk does not guarantee a later chunk fits.

The exact main-code native counterfactual commits 50 roots, then starts the
modeled expensive second deletion and fails with 50 roots preserved in its
ledger. The corrected test issues only the first deletion, records an honest
yield with the same 50 committed roots, preserves the live root and success
watermark, and makes further progress in a fresh invocation. The fixture uses
a three-second acknowledgement delay and per-row sleeps; it measures avoided
dispatch and rollback, not CPU savings or production cascade cost.

Validation: 94 focused tests, 38 native PostgreSQL tests, full Admin typechecking,
ESLint and formatting. Native suites use the existing CI `--testTimeout=60000`;
the application's five-second budget is unchanged. A first local invocation
omitted that runner option and interrupted an existing test's deliberate
five-second delay; the fresh CI-equivalent run passed. Feat-554 remains in
progress pending normal deployment and operational evidence.
