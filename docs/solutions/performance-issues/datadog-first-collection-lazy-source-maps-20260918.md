---
module: Admin continuous profiling
date: 2026-09-18
problem_type: performance_issue
component: service_object
severity: high
symptoms:
  - The first ordinary profile collection blocks independent HTTP probes for over 900 ms.
  - Later collections are shorter despite identical catalog request traffic.
root_cause: inefficient_algorithm
resolution_type: code_fix
tags: [datadog, profiling, source-maps, event-loop, watch, admin]
---

# Prepare loaded profiler source maps between event-loop turns

The pinned `dd-trace` 5.109.0 profiler synchronously serializes heap and wall
profiles before asynchronous encoding/export. Its `@datadog/pprof` 5.15.0 source
mapper loads source-map consumers asynchronously, but `source-map` 0.7.6 defers
mapping decoding until the first frame lookup. Hundreds of loaded production
bundle maps therefore accumulate their cold decoding and GC in one collection.

A previous 598 ms production capture overlapped a second CPU sampler. That
capture alone was insufficient. An owned Node 24.16 production build with
matching `.next/server` maps reproduced the first-collection pause using only
the ordinary profiler. An independent Python client sent health probes at 20/s
and authenticated catalog queries at 4/s against an owned PostgreSQL database.
The catalog fixture has five videos, eight locales and two relations; this
exercises actual GraphQL/Prisma bundles and allocation, not production catalog
cardinality. No external profiling collector or additional CPU sampler ran.

| Catalog trial | First heap + wall | Mapping subset | Maximum health / catalog probe | Later collection |
| ------------- | ----------------: | -------------: | -----------------------------: | ---------------: |
| Original 1    |            815 ms |         469 ms |                   931 / 915 ms |           349 ms |
| Prepared 1    |            215 ms |          69 ms |                   270 / 286 ms |           143 ms |
| Original 2    |            742 ms |         409 ms |                   910 / 951 ms |           134 ms |
| Prepared 2    |            209 ms |          69 ms |                   285 / 292 ms |           143 ms |

All collection-window probes returned HTTP 200 without GraphQL errors. Mapping
is included in collection time; GC also overlaps these intervals. Do not sum
those measurements as independent costs. Asynchronous encoding elapsed times
are separate overlapping operations, not synchronous event-loop blockage.
The retained numerical artifact includes those timings and RSS.

The dependency patch prepares only maps of CommonJS modules already in
`require.cache`, yielding with `setImmediate` between basic maps. It traverses
indexed-map sections individually, preserving source locations. Unexecuted
modules remain lazy. Malformed preparation is reported through the existing
logger and retains its previous lookup error behavior, so one malformed map
does not make all source-map initialization fail. No tracing/profiling switch,
source-map output, collection interval or request deadline changes.

The real installed-dependency regression loads basic and indexed fixture
modules, observes actual cold decoder calls, verifies separate event-loop turns
and no cold decoding during subsequent frame lookup, and checks source file,
line, column and function names. An unexecuted module remains lazy; an invalid
map still reports its error. The test fails before the dependency patch.

This is not free memory: first-collection RSS is 1.15–1.16 GB in controls and
1.20–1.23 GB after preparation. Second-collection RSS is 1.19–1.20 GB versus
1.21–1.31 GB. These are process snapshots, not retained-heap estimates. Preparing
all maps was rejected because it included unused bundles and increased memory
further. A late-loaded module, one unusually large map, normal serialization,
GC, database work and other scheduling work can still cause latency.

This proves a cold profiler cost and its reduction. It does not establish that
profiling caused every historical Watch timeout. In particular, a selection
failure after the worker-isolation release occurred during a warm process and
remains separate evidence. Retain the unchanged 700 ms upstream budget and
report HTTP failures, semantic delivery fallbacks and browser aborts separately.

For upgrades, rerun `apps/admin/src/observability/profiler-source-maps.test.ts`
and the production-build first/warm collection comparison. The patch depends on
the pinned indexed consumer's `_sections`; reassess it when either dependency
changes. Source-map output preservation is an acceptance gate, not just speed.
