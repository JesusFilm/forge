---
id: "feat-891"
title: "Send event history asynchronously and measure delivery failures"
owner: "nisal"
priority: "P1"
status: "in-progress"
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

Implementation pending.
