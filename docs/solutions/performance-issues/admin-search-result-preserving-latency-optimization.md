---
title: "Admin search result-preserving latency optimization"
date: "2026-06-25"
category: "performance-issues"
module: "apps/admin"
problem_type: "performance_issue"
component: "database"
symptoms:
  - "Production Watch search spends several seconds inside Admin search"
  - "Search timings show hydration and semantic SQL can dominate user-visible latency"
  - "The optimization must not change top result IDs, ordering, or public response fields"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "high"
tags:
  - "admin"
  - "search"
  - "latency"
  - "hydration"
  - "pgvector"
  - "embeddings"
  - "cache"
---

# Admin Search Result-Preserving Latency Optimization

## Problem

Admin Watch search needed latency reductions without degrading semantic quality
or changing the public search contract. The dangerous shortcut was to shrink or
timeout retrievers and return faster but different results; the safe path was to
optimize query shape, hydration shape, and repeated query embedding work while
proving the response stayed stable.

## Symptoms

- Keyword-first and hybrid searches can spend 4-8 seconds in production, with
  occasional slower calls.
- Search timings identify multiple possible hot spots: live query embedding,
  `semantic-video` SQL, card hydration reads, and trace writes.
- Top-N result identity, order, score shape, display metadata, `searchMode`,
  and `hasMore` must remain stable while optimizing.

## What Didn't Work

- **Optimizing by changing retrieval semantics.** HNSW-first row windows,
  retriever timeouts, lower candidate limits, or semantic-list removal may
  reduce latency but can silently reduce recall or diversity.
- **Treating hydration as ranking work.** Display metadata belongs after fusion
  and pagination; adding broad image/dub joins to every retriever expands the
  hot SQL path.
- **Relying on route timing alone.** A single request duration cannot separate
  embedding provider time from PostgreSQL time, hydration time, and trace-write
  overhead.

## Solution

Use a result-preserving optimization ladder:

1. Keep a byte-equivalent public response oracle in tests before changing query
   shape. Compare IDs, order, scores, display fields, `searchMode`, `query`,
   and `hasMore`; exclude private timing/log data from the oracle.
2. Split post-fusion video card hydration into bounded, timed reads for the
   final page only:
   - base video fields via `hydration.video.findMany`;
   - locale display copy via `hydration.videoLocale.findMany`;
   - image variants via a per-video `row_number()` window over `video_image`;
   - playable dubs via a per-video `row_number()` window over `video_dub`;
   - child counts via grouped raw SQL with the same published-child gate.
3. Preserve overlay semantics exactly. Hydrated display fields fill public card
   metadata, but existing semantic evidence still owns `startSeconds` and any
   non-empty retriever `playbackId` / `imageUrl` fallback.
4. In pgvector semantic SQL, avoid duplicate query-vector binding/casting
   without changing ranking:

   ```sql
   WITH query_embedding AS MATERIALIZED (
     SELECT ${queryEmbedding}::vector AS embedding
   ),
   transcript_source AS (
     SELECT
       1 - (vtc.embedding <=> qe.embedding) AS source_score
     FROM video_transcript_chunk vtc
     CROSS JOIN query_embedding qe
     ORDER BY vtc.embedding <=> qe.embedding
   )
   ```

   The key invariant is that `DISTINCT ON`, visibility filters, provenance
   filters, candidate limits, and final ordering remain unchanged.

5. Add a process-local query embedding cache only around the default live-search
   embedder:
   - key by normalized query text plus provider/model/dimensions;
   - bound with TTL and max entries;
   - coalesce concurrent identical misses with an in-flight promise map;
   - cache fulfilled embeddings only, never failures;
   - count health attempts/failures for real provider calls, not cache hits.
6. Leave trace-write behavior alone until timings prove it is still a bottleneck.
   Optimizing trace persistence too early removes observability that may be
   needed for the next production comparison.

## Why This Works

The retrievers still generate the same ranked candidates, and RRF still sees the
same list labels and list order. The semantic SQL computes the same distance
expression against the same rows; it simply binds the query vector once and
reuses the CTE alias.

Hydration stays display-only and bounded by the final page size. Window queries
preserve the old per-video `take` behavior for image and dub relations, so one
popular video with hundreds of dubs cannot balloon hydration rows for the whole
page.

The query embedding cache targets the most repeatable provider cost without
changing relevance. Identical normalized text under the same provider/model
contract receives the same vector the provider would have returned on the first
call, while failures still degrade to keyword-only and remain observable.

## Prevention

- Do not merge a search-latency optimization unless result-stability tests cover
  the public response shape and semantic evidence/display metadata boundaries.
- Treat HNSW-first or candidate-window rewrites as a separate relevance change
  that needs recall/diversity proof, production-shaped `EXPLAIN`, and eval
  coverage.
- Add a DB timing label for every new search SQL shape. If a query is worth
  optimizing, it is worth timing independently.
- Keep query embedding caches provider-bound. Include provider, model, and
  dimensions in the cache key so model upgrades cannot reuse stale vectors.
- Keep health counters and health probes honest: cache hits are not provider
  attempts, and `/api/search/health` should still call the provider directly.

## Related Issues

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/solutions/performance-issues/admin-search-stage-db-timing-instrumentation-20260624.md`
- `docs/solutions/integration-issues/semantic-search-video-card-display-metadata-hydration.md`
- `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
- `docs/solutions/best-practices/openrouter-only-embedding-provider-contract.md`
