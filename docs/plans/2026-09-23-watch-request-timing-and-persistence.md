---
title: "Measure Watch request stages and reproduce persistence delays"
status: active
type: fix
---

# Watch request timing and persistence

Continue feat-496 and feat-464 from freshly fetched main
`f9354608715c3bf656e94dff8ec2c8bd33cc6fb7`, in the task-owned
`codex/watch-latency-observability-20260923-k7p` worktree. The owner authorized
implementation, review, normal PR/main merge and automatic release verification.
Keep the investigation internal. Preserve the authored homepage behind its
default-off flag and every existing identity, attribution, durable budget and
10/5 pool guarantee.

## Evidence and hypothesis

The September 22 20:42:24 UTC delivery returns HTTP 200 with a semantic
`delivery_timeout`. Trace `6ab2e82e000000002bd5afb121a0a6cd` shows evidence
persistence expiring: candidate-stage createMany lasts 611.72 ms and reports
720 ms elapsed against a 650 ms transaction. Its underlying INSERT driver span
lasts 517.60 ms. These are elapsed times, not pure PostgreSQL execution.
This is separate from the historical selection HTTP 503 and capability-budget
call. No task-owned production diagnostic was running during this failure.

Test whether evidence volume and concurrent database work reproduce this delay.
Separately distinguish native acquisition, query execution/waits, callback
processing, transaction settlement and process scheduling. Do not sum parallel
or nested durations. The existing database records cannot retain rolled-back
attempts; logs must preserve them.

## U1. Request and database timing

**Files:** Admin runtime observation helper and tests, database client/pool and
tests, recommendation delivery factory/runtime/services and episode service.

Emit one bounded outcome record per seeded delivery, for-you delivery and
selection. Retain named dependency and Prisma operation durations, input row
counts, pending operations, sanitized error codes, and process loop context.
Correlate through existing trace/log transport. Never log SQL parameters,
capabilities or viewer identifiers. Observe later operation settlement without
asserting that an ambiguous mutation committed or retrying it.

Instrument actual native acquisition, preserving promise and callback APIs.
Prisma native callbacks can lose request context: independently log slow/failed
acquisitions and mark correlation unavailable, rather than reporting zero wait.
Preserve singleton reuse and shutdown ownership. Runtime measurements describe
overlapping process activity, not CPU attributed to the request.

**Verification:** actual ten-lease saturation through Prisma, callback parity,
concurrent context isolation, semantic fallback versus rejected selection,
late settlement, sanitized errors and logging failure. Test real persistence
rollback and returned commit behavior. Compare observation overhead under load.

## U2. Persistence reproduction and proven correction

**Files:** recommendation persistence database test/benchmark and validation
record. Change production query/service code only after the reproduction
establishes its mechanism.

Use actual migrations, constraints, triggers and the pinned Prisma adapter in
a labelled, task-owned PostgreSQL container. Replay representative bounded
candidate-evidence batches with concurrent work. Record success and failure
counts, p50/p95/p99/max and exact persisted state; retain unsuccessful attempts
to reproduce the historical failure. Injected faults validate diagnostics only.
Do not claim they establish the natural incident's cause.

## U3. Review, deployment and closure

Run sequential Compound Engineering correctness, reliability, security,
standards and testing review. Fetch newer main before merging and rerun affected
checks. Verify the precise automatic Admin/worker deployment, collector receipt
and separate HTTP/envelope populations. Record observation overhead and stop
owned diagnostics. Compound the learned measurement boundaries.

Target p99 under 200 ms for server-side selection and delivery separately; this
is a proposed objective, not an established full-delivery capability. Include
failures and fallbacks in acceptance, not only fast successes. Existing ticket
acceptance gates remain binding; a diagnostic release does not close a latency
ticket or satisfy missing installed-alert requirements.
