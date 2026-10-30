---
id: "feat-795"
title: "Attribute retention decision operations to the executing process"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-10-27"
duration: 1
depends_on: []
blocks: []
tags: [recommendations, retention, diagnostics, privacy]
---

## Problem

The r2932-w01 second pass committed 100 roots before decision unlink reported
P2028 with 796 ms admitted and 816 ms in the combined operation. Existing
indexed SELECT, guarded UPDATE plans and local fixtures do not reproduce the
stall. The phase envelope cannot distinguish SELECT from UPDATE or identify
same-process JavaScript pauses. Container memory and PID1 heap settings cannot
stand in for the short-lived manual CLI's runtime.

## Entry points

- `apps/admin/src/services/recommendations/retention-decision-links.ts`:
  `unlinkExpiredDecisionLinks`, exact pair and live expiry guards.
- `apps/admin/src/services/recommendations/retention-phase-diagnostics.ts`:
  bounded failure envelope and strict safe parser.
- `apps/admin/src/services/recommendations/retention.service.ts`:
  decision phase and failure emission; behavior must remain unchanged.
- `apps/admin/src/services/recommendations/retention/job.ts`:
  explicit manual CLI, scheduled and generic worker job context.

## Scope and constraints

See `docs/plans/2026-10-27-retention-operation-diagnostics.md`. Add only bounded,
allowlisted operation/runtime observations to failure diagnostics. Preserve old
parser input, log limits, true FAILED outcomes, transaction boundaries, page
limits, stored expiry/current references, five-second deadline and admission.
No SQL, arguments, identifiers, stacks, inspector or container-memory guesses.
No production cleanup or completed-runtime-fix claim follows from this ticket.

## Verification

Focused tests distinguish SELECT/UPDATE rejection and preserve the original
error/counters. Cover executing context, actual local event-loop delay, success
and failure disposal, privacy/size limits and old/new parser compatibility.
Retain native unlink reassignment/live-expiry and full retention regressions.
Run focused/native tests, full Admin typecheck/lint, formatting and normal hooks.

## Validation and limits

113 focused tests cover operation/commit failure attribution, current-process
context, actual local event-loop delay, observer disposal, privacy, maximum-size
envelopes, version-one compatibility and the real CLI flush/exit path. The 44
existing native PostgreSQL retention/link tests passed on fresh owned loopback
databases. Full Admin typecheck and lint passed. The initial CLI-test loader did
not provide dynamic-import named exports; it was replaced with a scoped Node
load hook. Lint found a test-only prefer-const issue, corrected before rerun.

This ticket completes the diagnostic implementation, not the runtime timeout
repair or remaining ordinary daily-cycle acceptance. Cause and production CPU
efficiency remain unknown; a new deployed observation needs separate approval.

Eight alternating local pairs on the same 100-link helper fixture measured a
0.665 ms median paired wall-time difference with observation enabled. Median
Node process CPU was 9.290 ms without observation and 10.205 ms with it; observed
helper wall times ranged from 18.639 to 51.310 ms. Cache, dead-tuple evolution and
host noise remain, and one paired wall difference was 17.096 ms. These results
neither establish zero overhead nor guarantee admission with 750–800 ms left.
They are not whole-invocation, PostgreSQL CPU or production efficiency proof.

Pre-decision failures retain version one. Only an available decision operation
uses version two. An immediate local stall without another event-loop turn
records Prisma-await elapsed time but null histogram delay, proving that an
undersampled histogram cannot be treated as evidence of no stall.
