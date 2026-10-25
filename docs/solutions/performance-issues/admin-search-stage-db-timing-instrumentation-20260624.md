---
title: "Admin search stage and DB timing instrumentation"
date: "2026-06-24"
last_updated: "2026-06-25"
category: "performance-issues"
module: "apps/admin"
problem_type: "performance_issue"
component: "database"
symptoms:
  - "Watch search can spend several seconds in Admin before the caller timeout"
  - "Route-level latency does not identify whether embedding, retrieval SQL, fusion, hydration, or trace writes are slow"
root_cause: "missing_tooling"
resolution_type: "tooling_addition"
severity: "high"
tags:
  - admin
  - search
  - latency
  - timing
  - observability
  - pgvector
---

# Admin Search Stage and DB Timing Instrumentation

## Problem

Admin search latency debugging needs more than one request duration. A
keyword-first or hybrid search fans out through embedding generation, multiple
retrievers, reciprocal-rank fusion, dilution-cap logic, dedupe, mapping, card
hydration, and trace writes. When a production call takes seconds, a single
route timer cannot tell whether the bottleneck is vector SQL, lexical SQL,
Prisma hydration, embedding generation, or the trace side effect.

## Symptoms

- Web Watch search waits several seconds for Admin search and can approach the
  15 second GraphQL caller timeout.
- Semantic, hybrid, keyword-first, and degraded keyword-only requests all share
  the same public response shape, so timing must come from server-side
  instrumentation.
- Search trace persistence is intentionally swallowed on failure, which means
  trace health and search performance need separate observability.

## What Didn't Work

- Measuring only the REST or GraphQL route duration showed that search was slow
  but not where time was spent.
- Timing retriever promises without timing the raw SQL hid whether slow
  retrievers were blocked in PostgreSQL, mapping code, or later hydration.
- Adding timing fields to the public search response would have changed the
  consumer contract and leaked operational detail to clients that do not need
  it.

## Solution

Add a request-scoped timing recorder inside `HybridSearchService.searchWithTrace`
and pass it down to every retriever that performs database work. Keep timings in
the internal `SearchWithTraceResult`, then log them from REST, GraphQL, and
internal eval route boundaries with safe key/value fields.

The timing model should cover three layers:

- Route layer: `route`, requested mode, resolved pipeline mode, response
  `searchMode`, outcome, result count, total search time, and trace-write time.
- Orchestrator layer: embedding, retriever fan-out wall time, fusion,
  dilution-cap, dedupe, mapping, and hydration.
- Database layer: each raw retriever SQL query and the batched card-hydration
  Prisma query.

The database labels should identify the query shape, not user input:

```text
semantic-video.query
keyword-video.query
semantic-experience.query
keyword-experience.query
keyword-weighted-video.query
trigram-video.query
exact-title-video.query
hydration.video.findMany
```

When keyword-first mode overlaps video lexical retrieval with embedding, keep
two retrieval clocks:

- `db_retrievals_ms`: merged active retriever interval time. This measures
  database/retriever work and must not grow just because the embedding provider
  is still pending.
- `retrieval_wait_ms`: the final orchestrator wait after the full retrieval
  list has been assembled. This is the critical-path wait surface and may be
  small when early lexical retrievers already settled before embedding returned.

Do not compute `db_retrievals_ms` from a single wall-clock span that starts
when early keyword-first retrievers launch. That double-counts embedding wait
as database latency and makes production bottleneck reports misleading.

The retriever labels should stay aligned with existing search debug labels so
operators can compare result contribution and elapsed time without learning a
second vocabulary:

```text
semantic-video
keyword-video
semantic-experience
keyword-experience
keyword-weighted-video
trigram-video
exact-title-video
```

Implementation anchors:

- `apps/admin/src/services/hybrid-search-timing.ts` owns the shared recorder and
  key/value log formatting.
- `apps/admin/src/services/hybrid-search.service.ts` starts the request timer,
  wraps retriever promises, snapshots DB timings, and returns timings alongside
  the private trace summary.
- `apps/admin/src/services/hybrid-search-retrievers.ts` wraps hybrid semantic
  and keyword SQL with database timing labels.
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` wraps the
  keyword-first SQL paths with database timing labels.
- `apps/admin/src/app/api/search/route.ts`,
  `apps/admin/src/graphql/queries/hybrid-search.ts`, and
  `apps/admin/src/app/api/internal/search-eval/search/route.ts` emit the
  timing log line.

## Why This Works

The route boundary knows safe request dimensions and trace-write cost, while
the service knows stage timing, and the retrievers know exact database query
boundaries. Passing a small recorder down the existing call chain keeps those
responsibilities intact.

The logged timing line remains operational-only. It does not add query text,
vectors, debug payloads, bearer details, IP addresses, or public response
fields. That preserves the search response contract while still producing the
granularity needed to compare keyword-first, hybrid, semantic-only, and
keyword-only degraded runs.

Recording both retriever elapsed time and DB elapsed time is important. If a
retriever time is high and the matching DB query time is low, the bottleneck is
outside PostgreSQL. If they track closely, the next optimization pass should
move to `EXPLAIN (ANALYZE, BUFFERS)`, indexes, query shape, or hydration
projection.

For overlapped phases, stage timings are not additive. Compare `total_ms`,
`embedding_ms`, `db_retrievals_ms`, `retrieval_wait_ms`, per-retriever timings,
and per-DB labels together. A healthy keyword-first overlap can reduce
`total_ms` while leaving individual lexical DB timings unchanged.

## Async Overlap Follow-Up

Keyword-first video lexical retrievers only depend on `query`, `locale`, and
`limit`, so they can start before `await embedder(query)`. Semantic retrievers
still require `queryEmbeddingText`, so keep them embedding-gated and skip them
when embedding fails.

The safe orchestration shape is:

```ts
const earlyKeywordFirstRetrievals = [
  keywordWeightedVideo(),
  trigramVideo(),
  exactTitleVideo(),
]
const earlyRetrievalOutcomes = Promise.allSettled(
  earlyKeywordFirstRetrievals.map((r) => r.promise),
)

const vector = await embedder(query)

retrievals.push(semanticVideo(vector))
retrievals.push(...earlyKeywordFirstRetrievals)
```

Attach `Promise.allSettled` immediately to early lexical promises. A fast DB
rejection can otherwise surface as an unhandled promise rejection while the
embedding provider is still pending. After embedding resolves, reuse the early
settled outcomes in the final retriever order so RRF input order and debug
labels remain unchanged.

## Prevention

- Do not add a new search retriever without adding both a retriever timing label
  and a database timing label for its SQL.
- Keep timing logs free of raw query text, vectors, tokens, cookies, and user
  identifiers.
- Keep timing data out of public REST and GraphQL response types unless there
  is a separate product decision to expose an authenticated diagnostics surface.
- When optimizing semantic SQL, compare timing logs with production-shaped
  `EXPLAIN (ANALYZE, BUFFERS)` output before changing ranking semantics.
- Treat keyword-only timing as the degraded embedding-failure path; it is useful
  for isolating lexical costs, not proof that semantic quality is preserved.
- Keep tests that hold the embedder pending and prove keyword-first lexical
  retrievers start before semantic retrieval.
- Keep a fast-rejection test for early keyword-first lexical retrievers so the
  immediate settled handler does not regress.
- Keep interval tests for merged active retrieval timing; overlapping DB
  intervals and idle embedding gaps should not be double-counted.

## Related Issues

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/plans/2026-06-24-001-perf-admin-search-parallel-keyword-plan.md`
- `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
- `docs/solutions/platform/admin-search-trace-retention-pattern.md`
- `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`
- GitHub issue `JesusFilm/forge#979` — adjacent statement-timeout follow-up for
  hybrid-search SQL paths.
