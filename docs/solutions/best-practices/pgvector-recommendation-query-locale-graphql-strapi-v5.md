---
title: "pgvector Recommendation Query API — Cosine Similarity with Locale Filtering and Custom GraphQL Resolver in Strapi v5"
problem_type: best_practice
component: database
root_cause: missing_tooling
resolution_type: tooling_addition
severity: high
date: "2026-04-08"
features:
  - "feat-044"
tags:
  - pgvector
  - recommendations
  - graphql
  - strapi
  - raw-sql
  - cosine-similarity
  - locale-filtering
  - vector-search
  - parent-child-exclusion
  - distinct-on
  - hnsw
module: cms
key_files:
  - "apps/cms/src/api/scene-embedding/services/recommender.ts"
  - "apps/cms/src/graphql/recommendations.ts"
  - "apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts"
  - "apps/cms/src/api/scene-embedding/routes/scene-embedding.ts"
  - "apps/cms/src/index.ts"
related:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
  - "docs/solutions/performance-issues/strapi-language-cache-raw-sql-bypass-cms-manager-20260403.md"
  - "docs/solutions/platform/backfill-worker-pattern-manager-20260407.md"
  - "docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md"
  - "docs/solutions/platform/multimodal-scene-analysis-pipeline.md"
  - "docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md"
last_updated: "2026-04-15"
---

## Problem

With scene embeddings indexed in pgvector (`scene_embeddings` table, 1,965 scenes across 467 videos), the system needed a queryable recommendation API returning similar scenes from different videos, filtered by the user's locale. This is the query-time companion to the [pgvector indexing doc](pgvector-embedding-indexing-strapi-v5.md) which covers the write side.

The brainstorm's proposed SQL used direct FK joins (`JOIN video_variants vv ON vv.video_id = se.video_id`) that don't exist in Strapi v5, and had no handling for parent-child video relationships where feature films like JESUS have 61 child segments that would dominate results.

## What Didn't Work

### Brainstorm SQL with direct FK joins

```sql
-- WRONG for Strapi v5 — direct FK columns don't exist
SELECT se.video_id, 1 - (se.embedding <=> $1) AS similarity
FROM scene_embeddings se
JOIN video_variants vv ON vv.video_id = se.video_id
JOIN languages l ON vv.language_id = l.id
WHERE se.video_id != $2 AND l.bcp47 = $3
```

Five problems:

1. **No `vv.video_id` or `vv.language_id` columns** — Strapi v5 uses link tables for all relations
2. **`bcp47` is `bcp_47`** in the DB — Strapi v5 snake-cases field names
3. **Missing `published_at IS NOT NULL`** — includes draft variants
4. **Single-video exclusion only** — no parent-child awareness
5. **No per-video deduplication** — same candidate video appears multiple times

## Solution

### 1. Locale-aware pgvector query with Strapi v5 link tables

The correct join chain requires 4 tables through Strapi v5 link tables:

```sql
SELECT DISTINCT ON (se.video_id)
  se.video_id, se.scene_index, se.description,
  se.start_seconds, se.end_seconds,
  se.themes, se.demographics, se.spiritual_context,
  se.playback_id,
  1 - (se.embedding <=> ?::vector) AS similarity
FROM scene_embeddings se
JOIN video_variants_video_lnk vvl ON vvl.video_id = se.video_id
JOIN video_variants vv ON vv.id = vvl.video_variant_id
  AND vv.published_at IS NOT NULL
JOIN video_variants_language_lnk vll ON vll.video_variant_id = vv.id
JOIN languages l ON l.id = vll.language_id
  AND l.bcp_47 = ?
WHERE se.video_id != ALL(?::int[])
ORDER BY se.video_id, se.embedding <=> ?::vector
```

Join chain: `scene_embeddings.video_id` -> `video_variants_video_lnk.video_id` -> `video_variants` (filter `published_at IS NOT NULL`) -> `video_variants_language_lnk.video_variant_id` -> `languages.bcp_47`.

### 2. DISTINCT ON + subquery for global ordering

PostgreSQL requires `ORDER BY` to start with the `DISTINCT ON` column, so you can't directly `ORDER BY similarity DESC`. Wrap in a subquery:

```sql
SELECT * FROM (<DISTINCT_ON_QUERY>) sub
ORDER BY sub.similarity DESC
LIMIT ?
```

### 3. Parent-child video exclusion

Feature films like JESUS have 61 child segments (clips). Without exclusion, child clips dominate recommendations. Build a bidirectional exclusion set via `videos_children_lnk` (`video_id` = parent, `inv_video_id` = child):

```sql
SELECT ?::int AS id                                                    -- self
UNION
SELECT inv_video_id AS id FROM videos_children_lnk WHERE video_id = ?  -- children
UNION
SELECT video_id AS id FROM videos_children_lnk WHERE inv_video_id = ?  -- parent
```

The `?::int` cast is required for correct UNION typing. Pass the exclusion array as `WHERE se.video_id != ALL(?::int[])`.

### 4. Per-video aggregation via best-scene-match

For videos with multiple scenes, query each scene independently with `perSceneLimit = limit * 3` to over-fetch, then merge results keeping best similarity per candidate video:

```typescript
const perSceneLimit = Math.min(limit * 3, 50)
const bestByVideo = new Map<number, SceneRecommendation>()

for (const emb of embeddings) {
  const candidates = await querySimilar(
    knex,
    emb.embedding,
    locale,
    excludeIds,
    perSceneLimit,
  )
  for (const candidate of candidates) {
    const existing = bestByVideo.get(candidate.videoId)
    if (!existing || candidate.similarity > existing.similarity) {
      bestByVideo.set(candidate.videoId, candidate)
    }
  }
}

return [...bestByVideo.values()]
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, limit)
```

The 3x multiplier compensates for cross-scene deduplication — when merging results from N scenes, overlapping candidates get deduplicated, so over-fetching ensures enough unique candidates survive.

### 5. Custom GraphQL resolver in Strapi v5

First custom resolver in this CMS. Uses `extensionService.use()` in the **`register()` lifecycle** (not `bootstrap()` — Strapi compiles the GraphQL schema between `register()` and `bootstrap()`):

```typescript
// src/index.ts
register({ strapi }) {
  registerRecommendationsExtension(strapi)
}

// src/graphql/recommendations.ts
const extensionService = strapi.plugin("graphql").service("extension")
extensionService.use(() => ({
  typeDefs: `
    type SceneRecommendation { videoId: Int!, similarity: Float!, ... }
    type Query {
      sceneRecommendations(videoId: Int!, locale: String!, sceneIndex: Int, limit: Int): [SceneRecommendation!]!
    }
  `,
  resolvers: {
    Query: {
      sceneRecommendations: {
        resolve: async (_parent, args) => {
          try {
            return await getRecommendations(strapi, args)
          } catch (err) {
            if (err instanceof VideoNotFoundError) return []
            throw new Error("Scene embedding features not available")
          }
        }
      }
    }
  },
  resolversConfig: {
    "Query.sceneRecommendations": { auth: false }
  }
}))
```

Key details:

- **`register()` not `bootstrap()`** — GraphQL schema is compiled between these lifecycles
- **`auth: false`** makes it public like Strapi's shadowCRUD queries (for frontend clients)
- **`VideoNotFoundError` returns `[]`** — graceful degradation, not a GraphQL error
- **REST uses `api-token-auth`** middleware for internal pipeline consumers — intentional auth asymmetry documented with cross-referencing comments

### 6. Service layer as single source of truth

Both REST and GraphQL call the same `getRecommendations(strapi, params)`. Limit clamping (default 10, max 50) is consolidated in the service:

```typescript
const MAX_LIMIT = 50
const limit = Math.min(Math.max(1, params.limit ?? 10), MAX_LIMIT)
```

Transport adapters handle only request parsing and error response formatting.

## Why This Works

1. **Strapi v5 link tables are non-negotiable** — every M2M relation goes through `*_lnk` tables. The 4-table join is the minimum path from scene embeddings to locale filtering.
2. **`DISTINCT ON` + subquery** is the canonical PostgreSQL pattern for "best row per group with global ordering."
3. **Parent-child exclusion prevents content cannibalization** — JESUS film's 61 child segments are literally the same content cut into clips. Without exclusion, recommendations are useless.
4. **`register()` timing** is required because Strapi compiles the GraphQL schema after `register()` but before `bootstrap()`. Extensions added in `bootstrap()` are silently ignored.
5. **Performance verified**: 45ms execution time for top-10 query against 1,965 scenes. HNSW index handles the cosine similarity search efficiently because the locale filter lives on a _joined_ table (`languages.bcp_47`), not on `scene_embeddings` itself — the HNSW scan stays unconstrained.

   ⚠️ **Watch out at scale or with different schemas.** If a future query puts the filter directly on the embedding table (`WHERE column = ? ORDER BY embedding <=> ?`), pgvector's planner cost model is too pessimistic and silently picks Seq Scan over HNSW. Verify with `EXPLAIN ANALYZE` once `scene_embeddings` grows past ~5K rows or whenever a new filter column is added. The fix is per-locale partial HNSW indexes plus `hnsw.iterative_scan = relaxed_order`. See [pgvector HNSW index bypassed by planner when WHERE filter on indexed table](../performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md).

## Prevention

1. **Never write direct FK joins for Strapi v5 relations.** Always verify the join path through `*_lnk` tables. Run `\d tablename` in psql against production before writing SQL.

2. **Always use `bcp_47` not `bcp47` in raw SQL.** Strapi v5 snake-cases all field names. Verify column names with `\d languages`.

3. **Always filter `published_at IS NOT NULL` on content tables.** Strapi v5 stores draft and published rows. Draft content should never appear in user-facing queries.

4. **For parent-child content, always build a bidirectional exclusion set.** Any hierarchical content model (video/article with children) needs exclusion in similarity queries to prevent content cannibalization.

5. **Custom GraphQL extensions go in `register()`, never `bootstrap()`.** This is a Strapi v5-specific timing requirement.

6. **Consolidate business logic in the service layer.** When the same operation is exposed via REST + GraphQL, defaults, validation, and limits belong in the service function, not duplicated across transport adapters.

7. **Use `?::int` casts in parameterized UNION queries.** Without explicit type casts, PostgreSQL may infer different types for UNION branches.

8. **Over-fetch per sub-query when merging results across multiple embeddings.** Use `limit * 3` (capped at 50) to ensure enough unique candidates survive deduplication.
