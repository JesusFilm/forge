---
title: "Admin search pool and keyword-first fan-out optimization"
date: "2026-06-26"
category: "performance-issues"
module: "apps/admin"
problem_type: "performance_issue"
component: "service_object"
symptoms:
  - "Production keyword-first search spent seconds in DB retrieval even when individual SQL shapes looked reasonable"
  - "Client-level timing mixed DB latency with embedding provider outliers"
  - "Result-preserving fixes needed to keep the same retriever lists and public response shape"
root_cause: "async_timing"
resolution_type: "code_fix"
severity: "high"
tags:
  - "admin-search"
  - "keyword-first"
  - "prisma"
  - "railway"
  - "latency"
  - "connection-pool"
  - "transaction"
  - "result-parity"
---

# Admin Search Pool and Keyword-First Fan-Out Optimization

## Problem

Admin keyword-first search was still too slow after earlier hydration,
semantic-SQL, and embedding-cache work. The next safe slice had to reduce
latency without changing search quality, top result order, retriever labels, or
the public response contract.

Production timing showed that the keyword-first video lexical branch could add
avoidable database pressure: weighted full-text, trigram, and exact-title video
retrievers launched as three concurrent Prisma queries while semantic video,
experience retrievers, and hydration also competed for the same service pool.

## Symptoms

- Repeated production canaries for `the bible project`, `jesus`, and
  `hope when life is hard` showed multi-second service medians before the pool
  and fan-out slice.
- Pool-only changes improved warm medians, which pointed to connection
  acquisition and fan-out pressure rather than only raw SQL execution time.
- Post-change traces still had occasional 14-18 second total outliers, but the
  outlier stage was `embedding_ms`, not DB retrieval.

## What Didn't Work

- **Jumping straight to HNSW-first semantic retrieval.** That can be faster,
  but it changes recall characteristics because pgvector HNSW is approximate
  and a pre-collapse row window can overrepresent long videos.
- **Measuring only client duration.** Client timing is useful for user
  experience, but it cannot tell whether a slow request is waiting on
  embedding, DB retrieval, hydration, or trace logging.
- **Treating pool size as the whole fix.** Raising the Prisma pool limit helped,
  but the service still did unnecessary DB fan-out for one logical
  keyword-first video branch.

## Solution

First, increase the production Prisma pool headroom for Admin by adding
connection parameters to the Railway `DATABASE_URL`:

```text
connection_limit=10&pool_timeout=20
```

Then batch the three keyword-first video lexical retrievers onto one interactive
transaction connection:

```ts
export async function searchKeywordFirstVideoLexical(
  prisma: PrismaClient,
  params: KeywordFirstVideoLexicalSearchParams,
  timing?: SearchTimingRecorder,
): Promise<KeywordFirstVideoLexicalResults> {
  if (params.query.trim().length === 0) {
    return { keywordWeighted: [], trigram: [], exactTitle: [] }
  }

  return prisma.$transaction(
    async (tx) => ({
      keywordWeighted: await searchByKeywordWeighted(tx, params, timing),
      trigram: await searchByTrigram(tx, params, timing),
      exactTitle: await searchByExactTitle(tx, params, timing),
    }),
    { maxWait: 5_000, timeout: 20_000 },
  )
}
```

The orchestrator still exposes the same three logical retriever lists to RRF:

```text
keyword-weighted-video
trigram-video
exact-title-video
```

Only connection scheduling changed. The underlying SQL, RRF list labels,
dilution-cap inputs, and debug attribution stayed the same.

## Production Result

Warm production canaries after the pool change but before the code change:

| Query                  | Prior service median | Pool-only service median | Change |
| ---------------------- | -------------------: | -----------------------: | -----: |
| the bible project      |            3431.3 ms |                1995.5 ms | -41.8% |
| jesus                  |            2455.3 ms |                2006.2 ms | -18.3% |
| hope when life is hard |            2314.9 ms |                1363.1 ms | -41.1% |

Production canaries after the pool plus fan-out code change:

| Query                  | Service min / median / max |  Client min / median / max |
| ---------------------- | -------------------------: | -------------------------: |
| the bible project      |   212.8 / 223.5 / 662.0 ms |  470.8 / 476.4 / 1228.8 ms |
| jesus                  | 172.1 / 174.9 / 18032.7 ms | 418.2 / 475.1 / 18274.1 ms |
| hope when life is hard | 104.1 / 119.3 / 14110.7 ms | 348.9 / 370.3 / 14364.5 ms |

The large max values on `jesus` and `hope when life is hard` were embedding
provider/cache-miss waits:

| Query                  | Embedding median | Embedding max | DB retrieval median |
| ---------------------- | ---------------: | ------------: | ------------------: |
| the bible project      |           0.3 ms |      548.0 ms |            211.5 ms |
| jesus                  |           0.3 ms |    17892.2 ms |            111.1 ms |
| hope when life is hard |           0.3 ms |    13998.7 ms |             75.2 ms |

Result parity held for the stored top-five production signatures: same IDs,
same order, and same display fields for all three canary queries. Scores were
stable for most rows; two stored rows drifted by about 0.001-0.003 across
separate production deployments, which did not change ranking or display. For
future parity gates, save the full top-20 response signature rather than only
top-five IDs.

## Why This Works

The production bottleneck was partly connection scheduling, not just vector SQL.
Raising the pool reduced connection wait, and batching the three video lexical
queries reduced peak concurrent DB demand from the keyword-first branch.

Running the three lexical queries sequentially inside one transaction is
result-preserving because each query is independent and still returns its own
ranked list. RRF receives the same labels and the same list ordering it received
before; only the database connection pattern changed.

The explicit transaction timeout matters. Prisma interactive transactions have
a short default timeout; the Admin search branch is read-only but can still
have legitimate production variance, so the transaction gets a bounded 20
second timeout instead of inheriting an accidental default.

## Prevention

- Compare client timing, service timing, stage timing, retriever timing, and
  DB-query timing together. Client timing alone can misattribute embedding
  provider waits to database work.
- When optimizing keyword-first search, preserve the logical retriever labels
  unless intentionally changing ranking semantics.
- Store full response signatures for production canaries: IDs, order, scores,
  display fields, `searchMode`, `hasMore`, and evidence fields.
- Treat HNSW-first semantic retrieval as a separate prototype with recall and
  diversity gates. It is the next big algorithmic lever, but it is not a
  result-preserving query-scheduling change.
- Be cautious with Railway production canaries that scrape logs by `--since`;
  local container clock skew can miss fresh Railway log lines. Prefer deployment
  scoped logs or conservative line-count pulls when collecting benchmark traces.

## Related Issues

- `https://github.com/JesusFilm/forge/pull/1375`
- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/plans/2026-06-25-004-perf-admin-search-pool-fanout-plan.md`
- `docs/solutions/performance-issues/admin-search-stage-db-timing-instrumentation-20260624.md`
- `docs/solutions/performance-issues/admin-search-result-preserving-latency-optimization.md`
- `docs/solutions/performance-issues/admin-semantic-db-retrieval-visible-candidate-window.md`
- `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
