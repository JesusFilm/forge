---
title: "Batch Watch image metadata before Prisma call processing"
date: "2026-09-18"
module: "apps/admin Watch route snapshots"
problem_type: "performance_issue"
component: "service_object"
severity: "high"
symptoms:
  - "Small independent transactions stall during overlapping Watch catalog requests"
  - "Hundreds of image metadata Prisma calls share a slow completion window"
root_cause: "wrong_api"
resolution_type: "code_fix"
tags: [watch, recommendations, prisma, batching, event-loop]
---

# Batch metadata at the service boundary

`VideoService.getWatchRouteSnapshotBySlug` read chapter blur, chapter color,
hero blur and hero color separately for every related Mux video. Each helper
issued `muxImageDerivative.findUnique`, even when blur and color came from the
same row. For 192 related choices this creates 768 Prisma operations to obtain
384 recipe rows. Prisma can combine these into one SQL query; that does not
remove per-call argument processing, promises, result distribution, extension
work and instrumentation. This is not a demonstrated SQL N+1 problem.

## Evidence and limits

An unmodified production trace at 02:13:27 UTC on September 18,
`6aac9e4700000000116ed90ec4fb5a3f`, includes a 3,353 ms Watch route snapshot and
431 retained `MuxImageDerivative.findUnique` spans, up to 824 ms. Earlier valid
driver observations included a 384-row recipe batch. Neither span counts nor
driver duration alone establish SQL execution time or a complete traffic rate.

The local reproduction uses the pinned Prisma/pg stack, the application's
embedding result guard, tracing enabled, a ten-connection pool, 192 Mux choices
and both actual recipe helpers. Four overlapping catalog workers each complete
20 requests. A separate worker makes HTTP requests to an eight-statement
transaction probe. The trivial SQL isolates application scheduling and pool
competition; it does not emulate the full selection authorization/attribution
mutation or create database lock contention.

With a 200 ms pause between each worker's catalog requests, two control runs
had external probe maxima of 553/579 ms; the batch runs measured 56/58 ms.
Maximum loop delays fell from 310/333 ms to 17/14 ms. Those paced controls did
not cross 700 ms and must not be described as reproducing a selection 503.

The continuous-overlap (`--burst`) control completed the same 80 catalogs in
21.65 seconds and recorded 9/98 external probes above 700 ms, maximum 905 ms.
The batch completed in 0.62 seconds with zero of three external probes above
700 ms, maximum 240 ms; loop maximum fell from 346 ms to 20 ms. The treatment's
shorter workload gives far fewer probe observations. This is a bounded causal
capacity experiment, not a production failure-rate estimate or proof that all
historical failures have this cause. Earlier simplified exploratory probes are
not substitutes for this actual-helper comparison.

The failed 02:15 production observer and its recovery are separately documented
in `docs/operations/watch-api-stalls-diagnostic-2026-09-18.md`. That contaminated
capture and its backlog are excluded from this evidence. No further in-process
production instrumentation is needed to validate the local correction.

## Correction and regression

`getOrScheduleWatchMuxImageMetadata` performs one narrow `findMany` for the
selected Mux IDs and the two exact `(purpose, paramsHash)` recipe pairs. It
returns all four scalar values keyed by Mux ID. The existing scheduling queue
still fills missing blur/color metadata, with the same four-generation
concurrency bound. Existing single-image callers retain their helpers.

The snapshot uses this batch only after its existing visibility, language and
playability selection. It preserves every child/sibling and output field.
There is no shared result cache, deadline change, mutation retry, pool expansion,
profiling change or schema change.

The image metadata suite in `recommendations/playback-episode.db.test.ts` compares all four old/new outputs for
192 choices using real PostgreSQL, including duplicate input IDs and stale
recipe rows. It verifies one Prisma operation, not merely one SQL statement.
Unit coverage exercises complete/partial metadata, missing generation, empty
input and propagated read failures. Snapshot coverage verifies the chosen
language's playback and image metadata remain paired.

Run the real database regression with `RECOMMENDATION_DB_TEST=1` and an owned
local `DATABASE_URL`. Run the local performance control/treatment from
`apps/admin`, with a local-only Datadog agent destination:

```sh
CI=1 DATABASE_URL=postgresql://forge:forge@127.0.0.1:32771/api_stalls \
  DD_SERVICE=forge-q7v-local DD_ENV=test DD_TRACE_ENABLED=true \
  DD_TRACE_AGENT_URL=http://127.0.0.1:18127 DD_RUNTIME_METRICS_ENABLED=true \
  pnpm exec tsx --require dd-trace/init \
  src/scripts/probe-watch-mux-metadata-runtime.ts --baseline
```

Remove `--baseline` for treatment; add `--burst` to each for continuous overlap.
The script creates and drops its own schema and refuses non-loopback database
hosts. Use a database owned by the task, not a forwarded production database.
The recorded runs used a local agent destination without a collector, so they
exercise instrumentation but do not model production trace export transport.

## Future investigations

Measure both ORM-call volume and actual wire queries. A batching ORM can hide
large application costs behind a small SQL count. Measure external arrival-to-
response latency independently of an application's event-loop timer. Keep
database execution, lock waits, pool acquisition and application processing as
separate hypotheses. Deployment acceptance must still count selection HTTP
failures and recommendation-body timeout fallbacks independently.
