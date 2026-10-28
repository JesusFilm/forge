---
id: "feat-891"
title: "Send event history asynchronously and measure delivery failures"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-889", "feat-890"]
blocks: ["feat-888", "feat-892", "feat-893", "feat-895"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own event-history dispatch/runtime/health modules, validated configuration and
background lifetime integration. The public dispatch call starts a bounded
ClickHouse attempt immediately and returns without waiting for network I/O.
Use one attempt, catch all rejections, measure outcomes and never enqueue a
retry or PostgreSQL forwarding payload. Register an already-started promise with
Next's supported background lifetime mechanism; worker callers need owned
draining. Neither mechanism promises crash durability.

Bound concurrent count/bytes and deadline. Saturation is an observed capacity
drop, not a wait or hidden queue. Defaults are disabled. Measure attempted and
confirmed-success event counts, failures by bounded reason, timeout/unknown
outcomes, in-flight work and duration independently of ClickHouse. No payload or
per-event identity logging. Use existing telemetry conventions and distinguish
process-local observations from complete durable counts.

Test that caller completion precedes a stalled insert; success never writes a
queue; failure is observed exactly once without retry/unhandled rejection;
capacity recovers after settlement; saturation stays bounded; configuration
errors and disabled state are explicit; expiry and privacy preconditions hold.
Producer calls occur only after operational commit in feat-892/893.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read root/package guides and `docs/analytics-and-recommendation-policy.md`.
- The owner's latest direction supersedes the previous durable recovery/24-hour
  buffer scope. Those requirements are withdrawn, not completed.

## Evidence

Implemented in `apps/admin/src/services/recommendations/event-history/dispatch.ts`
and `runtime.ts`. `dispatchRecommendationEventsAfterCommit(events): void` starts
one ClickHouse insert before returning, and the Next runtime registers that
already-started promise with `after(promise)`. The worker factory exposes
`drain()` and `close()` for its owner to await at graceful shutdown. Producer
calls after operational commit belong to feat-892/893.

`RECOMMENDATION_EVENT_EXPORT_ENABLED` defaults to `false`. Enabled export needs
the ClickHouse endpoint, database, username and password. The validated timeout
defaults to 10 seconds; concurrency defaults to eight requests and 8 MiB of
in-flight encoded envelopes. At saturation, invalid input, expiry or missing
configuration, dispatch drops immediately and records the event count. There is
no queue or forwarding write. Configuration, transport and observer failures do
not fail a completed viewer operation.

`snapshot()` and one plain-string aggregate log per minute report process-local,
process-lifetime attempted and confirmed event counts, bounded failure reasons,
unknown outcomes, drops, in-flight requests/bytes, durations and family totals.
They cannot enumerate events lost to a process crash. The aggregate interval is
unreferenced and `close()` clears it.

Focused dispatch/runtime tests cover immediate start, unresolved HTTP,
exactly-one failure attempt, full-batch accounting, saturation/recovery,
disabled and invalid configuration, expiry, sensitive-field rejection, Next
lifetime registration, observer safety and interval cleanup. Scoped ESLint and
the full Admin typecheck passed. The commit hook ran lint-staged and a
repository-wide Prettier check.
