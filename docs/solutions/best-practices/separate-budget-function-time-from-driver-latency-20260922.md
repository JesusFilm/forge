---
title: "Separate PostgreSQL budget function time from complete driver latency"
date: "2026-09-22"
category: best-practices
module: "Recommendation submission budgets"
problem_type: best_practice
component: database
severity: high
applies_when:
  - "An independently committed mutation has a long driver span but no measured server execution or commit duration"
tags:
  ["postgres", "wal", "prisma", "observability", "recommendations", "latency"]
---

# Separate PostgreSQL budget function time from complete driver latency

## Evidence boundary

One production selection missed its unchanged 700 ms Web-to-Admin deadline while
the capability-budget driver call took 701 ms. Later read-only PostgreSQL samples
observed WAL sync/write waits, but cannot attribute the historical call. A
statement's age when sampled in `WalSync` is not its WAL wait duration. Likewise,
Prisma's almost-zero connection span does not measure the native driver's pool
queue. Retain the unresolved cause instead of weakening independent durable
submission limits or retrying an ambiguously committed mutation.

## Measure without changing the mutation boundary

`apps/admin/src/services/recommendations/submission-budget.ts` uses a materialized
clock CTE, a materialized single invocation of the existing budget function, and
a final clock sample. The same statement returns its original attempt result
plus `serverElapsedMs`. The client measures the complete awaited call using its
monotonic clock. No extra round trip, transaction, database setting or retry is
introduced.

For finite completed calls between 200 ms and five minutes, the existing console
transport emits this bounded, identifier-free event:

```text
event=recommendation.submission_budget kind=delivery elapsedMs=701 serverElapsedMs=5 outsideServerMs=696
```

The fields mean:

- `serverElapsedMs`: time between clocks around the function, including any
  waits inside it. It excludes planning before the first clock and the implicit
  transaction commit after the result is formed.
- `elapsedMs`: complete driver call as observed by the application, including
  application scheduling around the awaited result.
- `outsideServerMs`: the rounded remainder, potentially including pool wait,
  pre-execution planning, commit, transport and result scheduling. It is **not**
  a measurement of WAL sync or network time.

When a transaction client is supplied, its later outer commit is outside both
measurements. The existing independent live consumption path is preserved.
Invalid timing values are discarded without changing the mutation result. A
logging failure cannot turn an accepted budget into a failed mutation; original
database errors propagate unchanged. This event observes slow completed calls,
not every call or every failure, and is not an HTTP denominator.

## Validation and next diagnosis

Real PostgreSQL tests prove single consumption, concurrent exhaustion, the
32/256-attempt bounds, durable consumption after a later rollback, unchanged
rejection audit counts and standalone episode behavior. A delay in an owned
database trigger is measured inside server time; a later client delay is measured
outside it. These delays are local tests only.

The alternating-order 2,000-call comparison uses the actual Prisma adapter,
existing budgets and unique third submissions. All persisted attempt counts are
exactly three. Warm paired medians add approximately 0.07–0.36 ms. Preserve cold
rounds and order effects; this diagnostic is not a performance fix. See
`docs/validation/watch-budget-timing-20260922/results.json` for populations and
the actual Next build workload.

Correlate naturally slow events with bounded server waits, application runtime
measurements and independent HTTP/error evidence before selecting a fix. A large
remainder narrows the search but does not identify its cause. Do not equate an
agent host's device metrics with PostgreSQL storage without proving host/device
identity. Never interpret disabled PostgreSQL I/O timing counters as zero wait.

Related: [recommendation outcome accounting](../logic-errors/recommendation-outcome-accounting-boundaries-20260921.md)
and [the separate Next error-inspection fix](../performance-issues/next-error-inspection-amplifies-graphql-failures-20260922.md).
