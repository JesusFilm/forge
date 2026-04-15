---
title: "Hybrid Semantic Search API in Strapi v5 (pgvector + PostgreSQL FTS + RRF)"
date: 2026-04-13
problem_type: best_practice
component: integration
root_cause: inadequate_documentation
resolution_type: documentation_update
severity: medium
module: apps/cms
tags:
  - cms
  - strapi-v5
  - pgvector
  - full-text-search
  - graphql
  - rest-api
  - rate-limiting
  - semantic-search
  - agent-api
  - hybrid-search
  - rrf
  - reciprocal-rank-fusion
related_files:
  - apps/cms/src/api/search/
  - apps/cms/src/graphql/search.ts
  - apps/cms/src/lib/rate-limit-bucket.ts
  - apps/cms/src/middlewares/rate-limit.ts
  - apps/cms/src/api/scene-embedding/services/recommender.ts
  - apps/cms/src/bootstrap/ensure-pgvector.ts
github_prs:
  - "#744"
  - "#747"
  - "#777"
last_updated: "2026-04-15"
---

## When to Use This Pattern

Build a production search API in Strapi v5 backed by pgvector when:

- You have pre-computed embeddings for your content (scene-level, document-level, etc.)
- You want both **semantic matching** (intent-based, "dealing with grief") and **keyword matching** (exact titles, "Yakhal / Hope") in one ranked result set
- You need a public, agent-friendly API (REST + GraphQL) with machine-readable errors
- You want to avoid a separate search infrastructure (Algolia, Elasticsearch) — one Postgres does both

This is the pattern used by the Semantic Search API (feat-010) in apps/cms. It is explicitly designed to be extensible for additional content types (experiences, feat-086) and personalization signals (watch events / FPMC / Two-Tower, feat-084+) without changing the API contract.

## Architecture at a Glance

```
                    ┌──────────────────────────┐
                    │  Public entry points     │
                    │  (no auth, rate-limited) │
                    ├────────────┬─────────────┤
                    │  REST      │  GraphQL    │
                    │  /search   │ semanticSearch
                    └─────┬──────┴──────┬──────┘
                          │             │
                          └─────┬───────┘
                                │
                         ┌──────▼──────┐
                         │  search()   │  orchestrator
                         │  service    │  (apps/cms/src/api/search/services/search.ts)
                         └──────┬──────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
    ┌───────────▼────┐  ┌───────▼──────┐  ┌─────▼──────────┐
    │ embedQuery()   │  │ searchBySemantic  searchByKeyword
    │ OpenRouter     │  │ pgvector <=> │  │ tsvector/      │
    │ 1536-dim vec   │  │ cosine       │  │ plainto_tsquery│
    └────────────────┘  └──────┬───────┘  └──────┬─────────┘
                               │                 │
                               └────────┬────────┘
                                        │
                             ┌──────────▼──────────┐
                             │  fuseRankedLists    │
                             │  (RRF, k=60)        │
                             └──────────┬──────────┘
                                        │
                             ┌──────────▼──────────┐
                             │  deduplicateResults │
                             │  (3-layer dedup)    │
                             └──────────┬──────────┘
                                        │
                             ┌──────────▼──────────┐
                             │  paginate → hasMore │
                             └──────────┬──────────┘
                                        │
                                        ▼
                            { results, hasMore, query }
```

Five independent stages, each with a single responsibility. Swap any one out (e.g., replace OpenRouter with a local model) without touching the others.

## Key Decisions and Rationale

### 1. Hybrid search — semantic AND keyword, merged via RRF

**Why hybrid:** Pure vector search loses on exact-title queries ("Yakhal / Hope"). Pure keyword search loses on intent queries ("dealing with grief"). Industry standard (YouTube, Netflix, Amazon, Twelve Labs) is hybrid.

**Why RRF:** We don't have the training data for a learned neural ranker (YouTube) or the scale for a tuned multiplicative blend (Netflix). RRF is the industry default non-ML fusion method — it merges N ranked lists by reciprocal rank position with no score normalization required:

```
RRF_score(item) = Σ over lists L:  1 / (k + rank_L(item))
```

With k=60 (standard value), a video at rank 1 in both lists scores `2/61 ≈ 0.0328`. Scores are normalized to `[0, 1]` by dividing by the theoretical maximum (`lists.length / (k + 1)`).

**Extensibility wins:** RRF accepts **N** ranked lists. v1 passes two (semantic, keyword). Adding personalization is literally one extra list passed into the same function — no contract change.

### 2. Scene-level embeddings, not transcript chunks

Scene descriptions encode transcript content + themes + bible verses + demographics into one paragraph. They're a **superset** of transcript-chunk signal. Industry aligned:

| Platform    | Search unit     |
| ----------- | --------------- |
| Netflix     | Scene / shot    |
| Twelve Labs | Scene / shot    |
| YouTube     | Video + chapter |
| JFP (ours)  | Scene           |

### 3. PostgreSQL `tsvector` for keyword, not `ILIKE`

```sql
-- In ensure-pgvector.ts bootstrap:
CREATE INDEX videos_fulltext_search_idx
  ON videos USING GIN (
    to_tsvector('simple',
      COALESCE(title, '') || ' ' || COALESCE(description, '')
    )
  )
```

`tsvector` with `ts_rank()` gives us ranked results we can feed into RRF. `ILIKE` only gives boolean match/no-match — useless for ranking. `'simple'` config is language-agnostic for Phase 1 (en/es/fr share one index).

### 4. Locale-aware via link-table join chain

Strapi v5 uses link tables for all relations. To filter scene embeddings to videos with a variant in a specific locale, the join chain is:

```sql
FROM scene_embeddings se
JOIN video_variants_video_lnk vvl ON vvl.video_id = se.video_id
JOIN video_variants vv ON vv.id = vvl.video_variant_id AND vv.published_at IS NOT NULL
JOIN video_variants_language_lnk vll ON vll.video_variant_id = vv.id
JOIN languages l ON l.id = vll.language_id AND l.bcp_47 = ?
```

Strapi snake-cases field names (`bcp47` → `bcp_47`). The chain is non-obvious — reuse this exact pattern across any query that needs locale filtering. Reference: `apps/cms/src/api/scene-embedding/services/recommender.ts`.

**Why the JOIN chain matters for HNSW performance.** Filtering locale via the JOIN keeps the WHERE clause off the embedding table, so pgvector's HNSW scan stays unconstrained — the planner picks the index. When feat-086 added `experience_embeddings`, the table stores `locale` directly on the row, so `WHERE ee.locale = ?` defeats the planner's HNSW cost model and silently picks Seq Scan. The mitigation is per-locale partial HNSW indexes plus the `hnsw.iterative_scan` GUC. See [pgvector HNSW index bypassed by planner when WHERE filter on indexed table](../performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md). When extending this search pattern to a new content type, prefer keeping the locale filter on a _joined_ table when possible; if the new table has locale on the row, plan for partial indexes.

### 5. `DISTINCT ON` + over-fetch + dedupe

Each retrieval returns **the best-matching scene per video** (not all scenes per video) using `DISTINCT ON (se.video_id)`. Then we over-fetch by 3x the requested limit, because the post-fusion 3-layer dedupe strategy can remove near-duplicate videos:

1. `core_id` prefix match (catches ad-format variants: `"4_GoodNews"` vs `"4_GoodNewsAD1x1"`)
2. Exact title match (catches cross-series duplicates)
3. Embedding cosine similarity > 0.95 (safety net for unlabeled duplicates)

Without over-fetching, an under-limit page could happen after dedupe. With `offset + limit + 1` target (for `hasMore`), we always know whether to show "Load more."

### 6. Graceful degradation via `Promise.allSettled`

```ts
// Step 1: try to embed. If it fails, fall back to keyword-only.
let queryEmbedding: string | null = null
try {
  const queryVector = await embedQuery(query)
  queryEmbedding = toPgvectorText(queryVector)
} catch (error) {
  strapi.log.warn(`[search] fell back to keyword-only: ${error.message}`)
}

// Step 2: allSettled means one failure doesn't kill the other.
const [semanticOutcome, keywordOutcome] = await Promise.allSettled([
  queryEmbedding
    ? searchBySemantic(knex, { queryEmbedding, locale, limit: overfetchLimit })
    : Promise.resolve([]),
  searchByKeyword(knex, { query, locale, limit: overfetchLimit }),
])
```

A single external outage (OpenRouter down, pgvector slow) never returns 503. The endpoint degrades silently from "hybrid" to "keyword-only" and clients keep getting useful results. The `503` response is now effectively unreachable under normal failure modes — it only fires on truly unexpected errors (memory issues, bugs).

### 7. `hasMore: boolean` instead of `total: number`

The original contract had `total: number`. A code review caught that `total` was capped at `offset + limit` because `deduplicateResults()` was asked to stop at that count. Pagination was silently broken — clients would see `total: 20` even when 200 results existed.

The fix: dedupe one extra (`offset + limit + 1`) and check if we hit it:

```ts
const deduped = deduplicateResults(fused, offset + limit + 1)
const page = deduped.slice(offset, offset + limit)
const hasMore = deduped.length > offset + limit
```

No expensive full-count query needed. Clients build cursor-style "Load more" pagination without knowing the absolute total.

### 8. Nullable scene fields as match-type discriminator

```ts
type SearchResult = {
  // ...
  startSeconds: number | null // null = keyword-only match, no scene timestamp
  playbackId: string | null // null = keyword-only match, no Mux asset
}
```

When a video matches only via keyword (no scene hit), we return `null` instead of `0` / `""`. Clients can branch on this:

```ts
if (result.playbackId) {
  // render scene thumbnail + deep-link to startSeconds
} else {
  // render video card, link to video start
}
```

Cheaper than a `matchType: "scene" | "video"` discriminator field, and future-extensible (when experiences arrive, they'll also return nullable scene fields).

### 9. Dual-surface API: REST + GraphQL sharing one service

Both entry points call the same `search()` function:

- **REST** (`GET /api/search`) — stateless, easy to curl-test, agent-friendly
- **GraphQL** (`semanticSearch`) — typed via gql.tada on the consumer side, standard Strapi admin integration

Behavior is guaranteed identical because there's one service. Pick whichever protocol fits your caller.

### 10. Per-IP rate limiting with shared bucket

The REST route and GraphQL resolver share **one in-memory Map** keyed by `search:{ip}`. An attacker can't bypass the 30 req/min limit by alternating REST and GraphQL — both increment the same bucket. Lazy sweep every 1000 calls evicts expired buckets to prevent memory growth under rotating-IP attacks.

### 11. Trust `cf-connecting-ip` over `x-forwarded-for`

```ts
export function resolveClientIp(headers, fallback): string {
  // Cloudflare sets cf-connecting-ip with the real client IP.
  // It cannot be spoofed by the client because Cloudflare overwrites it.
  const cloudflareIp = headers["cf-connecting-ip"]?.trim()
  if (cloudflareIp && cloudflareIp.length > 0) return cloudflareIp

  // x-forwarded-for first entry is attacker-controllable if the request
  // somehow bypasses Cloudflare, so this is a fallback only.
  const forwarded = headers["x-forwarded-for"]
  if (forwarded) {
    const first = forwarded.split(",")[0].trim()
    if (first.length > 0) return first
  }

  return fallback ?? "unknown"
}
```

This is spoof-resistant as long as Cloudflare Authenticated Origin Pulls are enforced (which they are on JFP's Railway deployment).

### 12. Agent-native error contract with `GraphQLError`

Every error from the GraphQL resolver is a `GraphQLError` from the `graphql` package with a machine-readable `extensions.code`:

| Code                  | When                                                 |
| --------------------- | ---------------------------------------------------- |
| `BAD_USER_INPUT`      | Empty/whitespace query                               |
| `RATE_LIMITED`        | Rate limit exceeded + `extensions.retryAfterSeconds` |
| `SERVICE_UNAVAILABLE` | Unexpected internal failure                          |

Agents can programmatically branch on `extensions.code` and read `retryAfterSeconds` to back off. See the sibling doc [Strapi v5: Custom Error subclasses lose extensions](../integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md) for why plain `Error` subclasses don't work here.

## Module Structure

```
apps/cms/src/
├── api/search/
│   ├── controllers/search.ts       ← REST request validation, 400/503 shaping
│   ├── routes/search.ts            ← Route config, rate-limit middleware wired
│   └── services/
│       ├── search.ts               ← Orchestrator: embed → retrieve → fuse → dedup → paginate
│       ├── semantic-search.ts      ← pgvector cosine SQL with locale joins
│       ├── keyword-search.ts       ← tsvector/plainto_tsquery SQL
│       └── fusion.ts               ← RRF + 3-layer deduplicateResults
├── graphql/
│   └── search.ts                   ← Strapi extensionService.use() registration, GraphQLError
├── lib/
│   ├── openrouter.ts               ← text-embedding-3-small client (new CMS capability)
│   └── rate-limit-bucket.ts        ← Shared fixed-window bucket + resolveClientIp + SEARCH_RATE_LIMIT
├── middlewares/
│   └── rate-limit.ts               ← Koa middleware for REST rate limiting
└── bootstrap/
    └── ensure-pgvector.ts          ← Idempotent: vector extension + HNSW + GIN FTS index
```

## Prevention / Patterns to Reuse

**For any new search or ranking API in Strapi v5:**

1. **Always use `DISTINCT ON` + over-fetch + dedupe** for "top N per category" patterns. Set limit to `offset + limit + 1` so `hasMore` comes free.
2. **Shared service layer for REST + GraphQL.** Wrap differences in the entry-point files; keep behavior identical in one `search()` or `recommend()` function.
3. **`Promise.allSettled` over `Promise.all`** whenever calling more than one external or slow dependency. A partial failure should degrade, not crash.
4. **Over-fetch constant (e.g., `OVERFETCH_FACTOR = 3`)** lives next to the service. Future tuning happens in one place.
5. **Lazy sweep for in-process caches/buckets.** Every N calls, iterate and drop expired entries. No timer lifecycle to manage. Cheaper than `setInterval`.
6. **`cf-connecting-ip` first, `x-forwarded-for` fallback** for any per-IP logic behind Cloudflare. Never trust the first `x-forwarded-for` entry as primary.
7. **`GraphQLError` from the `graphql` package** for structured errors in any Strapi GraphQL resolver. Plain `Error` subclasses with `.extensions` get stripped — see the sibling doc.
8. **Nullable fields as discriminators** when the API returns heterogeneous result shapes. Cheaper than a discriminator field and extensible.
9. **Integration smoke test against the live `/graphql` endpoint** in addition to unit tests. Unit tests pass on resolver-level logic; only the running server exercises Strapi's error formatting pipeline.

## Verification

After deploying this pattern, verify end-to-end:

```bash
# Basic semantic query
curl -s 'http://localhost:1337/api/search?q=forgiveness&locale=en&limit=5' | jq

# hasMore pagination
curl -s 'http://localhost:1337/api/search?q=love&locale=en&limit=3&offset=0' | jq '.hasMore'
curl -s 'http://localhost:1337/api/search?q=love&locale=en&limit=3&offset=3' | jq '.hasMore'

# Locale filtering (no bleed)
curl -s 'http://localhost:1337/api/search?q=forgiveness&locale=es&limit=3' | jq '.results[].id'

# Error paths
curl -s -w '\n[HTTP %{http_code}]\n' 'http://localhost:1337/api/search?locale=en'    # 400
curl -s -w '\n[HTTP %{http_code}]\n' 'http://localhost:1337/api/search?q=test'        # 400

# Rate limit (31st request)
for i in $(seq 1 31); do curl -s -o /dev/null -w "$i: %{http_code}\n" \
  'http://localhost:1337/api/search?q=test&locale=en'; done

# GraphQL extensions (the critical agent-native contract)
curl -s -X POST http://localhost:1337/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ semanticSearch(query: \"   \", locale: \"en\") { hasMore } }"}' \
  | jq '.errors[0].extensions.code'
# Expected: "BAD_USER_INPUT"
```

## Related Documentation

- [Strapi v5: Custom Error subclasses lose extensions](../integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md) — critical companion doc for the error contract
- [pgvector embedding indexing in Strapi v5](./pgvector-embedding-indexing-strapi-v5.md) — the storage layer this search queries
- [pgvector recommendation query + locale + GraphQL in Strapi v5](./pgvector-recommendation-query-locale-graphql-strapi-v5.md) — the sibling recommendation API that this search borrows its locale join chain and dedup strategy from
- [Composing N-way RRF safely with heterogeneous content types](./rrf-fusion-heterogeneous-content-types-20260415.md) — feat-086 extended the fusion to mixed video/experience results; documents the compound identity key + empty-list filtering patterns
- [pgvector HNSW index bypassed by planner when WHERE filter on indexed table](../performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md) — operational concern when extending search to a content type with locale on the row
- [feat-010 Semantic Search API](../../roadmap/content-discovery/feat-010-semantic-search-api.md) — the feature ticket
- [feat-086 Experience Search Integration](../../roadmap/content-discovery/feat-086-experience-search-integration.md) — extends this pattern with a new content type
- [2026-04-13 Semantic Search API brainstorm](../../brainstorms/2026-04-13-semantic-search-api-requirements.md) — the requirements + industry research that drove these decisions
- PRs #744 (initial implementation), #747 (hardening from 4-pass review), and #777 (feat-086 + this perf fix)
