---
title: "feat: Semantic Search API"
type: feat
status: completed
date: 2026-04-13
origin: docs/brainstorms/2026-04-13-semantic-search-api-requirements.md
---

# feat: Semantic Search API

## Overview

Build a hybrid search API in `apps/cms/src/api/search/` that combines pgvector semantic similarity on scene embeddings with PostgreSQL full-text keyword search on video metadata, merged via Reciprocal Rank Fusion (RRF). Exposed as both REST (`GET /api/search`) and GraphQL (`semanticSearch`) endpoints. This unblocks Urim's web search UI (feat-011) and mobile search UI (feat-012).

## Problem Frame

JesusFilm has 955+ videos with rich scene-level embeddings but no way for users to search this content by natural language query. The existing recommendation API finds similar videos given a video — search finds relevant videos given a text query. (see origin: `docs/brainstorms/2026-04-13-semantic-search-api-requirements.md`)

## Requirements Trace

- R1. Hybrid search: semantic vector similarity + keyword/title matching, merged via RRF
- R2. Query embedding generation via OpenRouter `text-embedding-3-small` (~200ms)
- R3. Locale-aware filtering: required `locale` param, same join chain as recommender
- R4. Video-level results: one result per video, best-matching scene determines score
- R5. Typed result list: `type` field (v1: always `"video"`)
- R6. Extensible scoring pipeline: RRF accepts array of ranked lists for future personalization
- R7. REST + GraphQL: same service layer, both public
- R8. Public access, no auth
- R9. Pagination: `limit` (default 20, max 50) + `offset`
- R10. Deduplication: 3-layer dedup from recommender (core_id prefix, exact title, embedding >0.95)
- R11. Response metadata: video ID, slug, title, imageUrl, snippet, startSeconds, playbackId, score

## Scope Boundaries

- v1 filters: locale only
- No personalization in v1 (pipeline designed for it, no user signals)
- No "did you mean" suggestions
- No faceted results or aggregations
- No experience results in v1 (only `type: "video"`)
- Phase 1 languages only: en, es, fr
- Scene embeddings as semantic source, not transcript embeddings

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/scene-embedding/services/recommender.ts` — DISTINCT ON (video_id) for per-video dedup, locale join chain (scene_embeddings → video_variants_video_lnk → video_variants → video_variants_language_lnk → languages.bcp_47), overfetch 3x + JS dedup, `cosineSimilarityFromText()` for inter-result embedding dedup
- `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts` — controller pattern: query param validation, typed error handling, delegation to service
- `apps/cms/src/api/scene-embedding/routes/scene-embedding.ts` — Strapi custom route registration with `auth: false`
- `apps/cms/src/graphql/recommendations.ts` — `extensionService.use()` with `typeDefs`, `resolvers`, `resolversConfig: { auth: false }`, registered in `src/index.ts` `register()` hook
- `apps/cms/src/bootstrap/ensure-pgvector.ts` — `scene_embeddings` table schema: `video_id`, `scene_index`, `start_seconds`, `description`, `playback_id`, `embedding vector(1536)`, `core_id`, `themes`, etc.
- `apps/manager/src/services/openrouter.ts` — OpenAI SDK with `baseURL: "https://openrouter.ai/api/v1"`, singleton pattern
- `apps/manager/src/services/embeddings.ts` — `requestEmbeddingVectors()` using `getOpenrouter().embeddings.create()` with model `openai/text-embedding-3-small`

### Institutional Learnings

- Strapi v5 raw SQL: field names are snake-cased in DB (`bcp47` → `bcp_47`). Verify with `\d tablename`.
- PostgreSQL 18 (Railway): `?::jsonb::text[]` cast not supported. Use PG array literal format.
- `videos` table has `title`, `slug`, `description`, `core_id`, `published_at` columns accessible via raw SQL.

## Key Technical Decisions

- **tsvector/tsquery over ILIKE for keyword search**: RRF requires ranked results from each retrieval strategy. `ts_rank()` provides a relevance score; `ILIKE` can only return boolean matches. tsvector also provides stemming ("forgive" matches "forgiveness") which improves recall. Requires a GIN index on the `videos` table — created in bootstrap alongside pgvector tables.

- **OpenRouter client in `apps/cms/src/lib/openrouter.ts`**: Lightweight singleton following the manager's pattern (`openai` SDK with OpenRouter base URL). The CMS needs this only for query embedding, so a minimal client is appropriate. Not extracting to a shared package — premature until a third consumer appears.

- **JS-level dedup over SQL-only**: Layer 3 of the dedup strategy (embedding cosine similarity >0.95) requires comparing vectors in JS. The recommender's proven overfetch 3x + JS dedup pattern is reused directly.

- **RRF with k=60**: Standard constant. The fusion function accepts `Array<Array<{ id, ...rest }>>` so personalization ranked lists can be added later without changing the merge logic.

- **Score normalization to 0-1**: After RRF, normalize scores by dividing by the theoretical max (sum of 1/(k+1) across all input lists). For 2 lists: max = 2/(k+1). This gives the API contract's 0-1 `score` field.

- **Keep all 3 dedup layers**: The recommender proved core_id + title + embedding dedup is necessary for this dataset. The data transfer cost of `embedding_text` is bounded by the overfetch limit (~60 rows for limit=20).

## Open Questions

### Resolved During Planning

- **tsvector vs ILIKE?** tsvector — need ranked results for RRF, plus stemming. (see rationale in Key Technical Decisions)
- **Where to put OpenRouter client?** `apps/cms/src/lib/openrouter.ts` — minimal singleton, follows manager pattern.
- **Dedup in SQL vs JS?** JS — embedding similarity check requires vector comparison in JS. Same pattern as recommender.
- **All 3 dedup layers needed?** Yes — the recommender proved they're necessary for JFP's content (ad-format variants, cross-series duplicates, unlabeled near-duplicates).
- **How to register GraphQL extension?** Same as recommendations: `extensionService.use()` in a `registerSearchExtension()` function, registered in `src/index.ts` `register()` hook.

### Deferred to Implementation

- **Exact tsvector column config**: Whether to use `to_tsvector('english', ...)` or a multi-language config. For Phase 1 (en, es, fr), `'simple'` config may be better since it doesn't assume a language for stemming. Evaluate during implementation against real data.
- **GIN index performance on videos table**: The videos table has ~955 rows — GIN index creation is instant. But verify the tsvector column approach (generated column vs runtime `to_tsvector()`) works with Strapi's table structure.
- **Total count query cost**: `SearchResponse.total` requires a count. Evaluate whether to run the full query for count or use an approximation. At 955 videos, exact count is fine.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
Request: GET /api/search?q=forgiveness&locale=en&limit=20&offset=0
                │
                ▼
        ┌───────────────┐
        │  Controller    │  validate q, locale, limit, offset
        │  (search.ts)   │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  Orchestrator  │  search service
        │  (search.ts)   │
        └───┬───┬───────┘
            │   │
    ┌───────┘   └───────┐
    ▼                   ▼
┌──────────┐    ┌──────────────┐
│ Semantic  │    │   Keyword    │     Two retrievals run
│ Retrieval │    │  Retrieval   │     in parallel
│           │    │              │
│ 1. Embed  │    │ tsvector     │
│    query  │    │ tsquery      │
│    via OR │    │ ts_rank      │
│ 2. pgvec  │    │ on videos    │
│    cosine │    │ table        │
│    search │    │              │
└─────┬─────┘    └──────┬──────┘
      │                 │
      ▼                 ▼
┌─────────────────────────────┐
│  Reciprocal Rank Fusion     │  merge N ranked lists
│  score = Σ 1/(k + rank_i)  │  (N=2 for v1)
│  k = 60, normalize to 0-1  │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  3-Layer Deduplication      │  reuse from recommender
│  1. core_id prefix          │
│  2. exact title             │
│  3. embedding sim > 0.95    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Paginate + Map Response    │  apply offset/limit, map to
│                             │  SearchResult contract
└─────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 1: OpenRouter embedding client**

  **Goal:** Add the `openai` npm dependency to the CMS and create a lightweight OpenRouter client for generating query embeddings.

  **Requirements:** R2

  **Dependencies:** None

  **Files:**
  - Create: `apps/cms/src/lib/openrouter.ts`
  - Modify: `apps/cms/package.json` (add `openai` dependency)
  - Test: `apps/cms/src/lib/openrouter.test.ts`

  **Approach:**
  - Singleton `getOpenrouter()` function returning an `OpenAI` client configured with `baseURL: "https://openrouter.ai/api/v1"` and `apiKey` from `process.env.OPENROUTER_API_KEY`
  - `embedQuery(text: string): Promise<number[]>` function that calls `openrouter.embeddings.create()` with model `openai/text-embedding-3-small` and returns the 1536-dim vector
  - Fail loudly if `OPENROUTER_API_KEY` is not set (checked at call time, not import time — CMS should still boot without it)
  - Timeout: 10s (query embedding should take ~200ms; 10s is a generous safety margin)

  **Patterns to follow:**
  - `apps/manager/src/services/openrouter.ts` — singleton OpenAI client pattern
  - `apps/manager/src/services/embeddings.ts:requestEmbeddingVectors()` — embeddings.create() call pattern

  **Test scenarios:**
  - Mock the OpenAI client and verify `embedQuery()` returns the embedding vector from the response
  - Verify error thrown when API returns no data
  - Verify error thrown when `OPENROUTER_API_KEY` is not set

  **Verification:**
  - `pnpm --filter @forge/cms typecheck` passes
  - Unit tests pass

- [ ] **Unit 2: Keyword search service**

  **Goal:** Implement PostgreSQL full-text search on `videos.title` and `videos.description` with locale-aware filtering.

  **Requirements:** R1 (keyword component), R3, R4

  **Dependencies:** None (runs in parallel with Unit 1)

  **Files:**
  - Create: `apps/cms/src/api/search/services/keyword-search.ts`
  - Test: `apps/cms/src/api/search/services/keyword-search.test.ts`

  **Approach:**
  - Use `to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))` at query time (no stored column needed — 955 rows is trivially fast). Use `'simple'` config for language-agnostic stemming in Phase 1.
  - `plainto_tsquery('simple', $query)` for the user's input — handles multi-word queries naturally
  - `ts_rank()` provides the relevance score for RRF
  - Same locale join chain as recommender: `videos` → `video_variants_video_lnk` → `video_variants` (published) → `video_variants_language_lnk` → `languages.bcp_47`
  - Return ranked list of `{ videoId, slug, title, coreId, imageUrl, description, rank }` (no scene data — keyword search matches at video level)
  - Over-fetch to match semantic retrieval (3x limit) to provide enough candidates for dedup
  - For keyword results, the snippet is the video description (not a scene description). The orchestrator will prefer the semantic result's scene snippet when both strategies return the same video.

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/services/recommender.ts` — locale join chain SQL, LATERAL join for images, raw knex query pattern

  **Test scenarios:**
  - Exact title match returns highest rank
  - Partial word match (stemming) returns results
  - Empty query returns empty results
  - Locale filtering: only videos with published variants in the requested locale
  - Results are ordered by ts_rank descending

  **Verification:**
  - Unit tests pass with mocked knex
  - Manual test against local CMS: querying "JESUS" returns the JESUS Film

- [ ] **Unit 3: Semantic search service (pgvector similarity)**

  **Goal:** Query scene_embeddings with the user's query embedding vector, returning the best-matching scene per video with locale filtering.

  **Requirements:** R1 (semantic component), R2, R3, R4, R11

  **Dependencies:** Unit 1 (needs `embedQuery()`)

  **Files:**
  - Create: `apps/cms/src/api/search/services/semantic-search.ts`
  - Test: `apps/cms/src/api/search/services/semantic-search.test.ts`

  **Approach:**
  - Reuse the recommender's SIMILARITY_SQL pattern: `DISTINCT ON (se.video_id)` ordered by `se.embedding <=> ?::vector` (cosine distance), wrapped in a subquery for `ORDER BY similarity DESC LIMIT ?`
  - Same locale join chain and LATERAL image join as recommender
  - No `WHERE se.video_id != ALL(...)` exclusion (search has no "current video" to exclude)
  - Returns: `{ videoId, slug, title, coreId, imageUrl, sceneIndex, description, startSeconds, playbackId, similarity, embeddingText }`
  - Over-fetch 3x for dedup headroom
  - The embedding text is returned for layer-3 dedup in the orchestrator

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/services/recommender.ts:SIMILARITY_SQL` — DISTINCT ON, locale joins, LATERAL image join

  **Test scenarios:**
  - Returns one result per video (DISTINCT ON working)
  - Results ordered by similarity descending
  - Locale filtering works (only videos with locale variant)
  - Includes scene description, startSeconds, playbackId for response mapping

  **Verification:**
  - Unit tests pass
  - Manual test: embedding a query about "forgiveness" returns thematically relevant videos

- [ ] **Unit 4: RRF fusion and deduplication**

  **Goal:** Implement Reciprocal Rank Fusion to merge ranked lists from semantic and keyword retrieval, then deduplicate using the recommender's 3-layer strategy.

  **Requirements:** R1, R6, R10

  **Dependencies:** None (pure functions, can be built independently)

  **Files:**
  - Create: `apps/cms/src/api/search/services/fusion.ts`
  - Test: `apps/cms/src/api/search/services/fusion.test.ts`

  **Approach:**
  - `fuseRankedLists(lists: RankedList[], k: number): FusedResult[]` — accepts N ranked lists (v1: 2, future: 3+ with personalization). Each list is `Array<{ videoId: number, [key: string]: unknown }>`. Score per video = `Σ 1/(k + rank_i)` where rank_i is 1-based position in list i (0 contribution if absent from a list).
  - Normalize scores to 0-1: divide by theoretical max `lists.length / (k + 1)`.
  - When a video appears in both semantic and keyword lists, prefer the semantic result's metadata (it has scene-level snippet/timestamp). Fall back to keyword metadata for video-only fields.
  - `deduplicateResults()` — extract from recommender.ts. Same 3-layer logic (core_id prefix, exact title, embedding similarity >0.95). Input must be sorted by score descending.
  - Export `cosineSimilarityFromText()` as a shared utility (currently private in recommender.ts).

  **Technical design:** _(directional guidance)_
  - The fusion function is generic over ranked list content. Each list item must have `videoId: number`. The fusion output merges all properties from matching items across lists, with earlier lists taking priority for overlapping keys.

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/services/recommender.ts:deduplicateResults()` — 3-layer dedup
  - `apps/cms/src/api/scene-embedding/services/recommender.ts:cosineSimilarityFromText()` — vector comparison

  **Test scenarios:**
  - Two lists with overlapping videos: fused scores are correct
  - Video in one list but not the other: gets partial score
  - Score normalization: top result has score ≤1.0
  - Dedup: core_id prefix match removes lower-scored duplicate
  - Dedup: exact title match removes lower-scored duplicate
  - Dedup: embedding similarity >0.95 removes lower-scored duplicate
  - Empty lists: returns empty results
  - Single list (degenerate case): works correctly

  **Verification:**
  - All unit tests pass
  - Fusion function is generic enough to accept a third ranked list without changes

- [ ] **Unit 5: Search orchestrator service**

  **Goal:** Wire together query embedding, parallel retrieval, fusion, dedup, and pagination into a single `search()` function.

  **Requirements:** R1, R2, R3, R4, R5, R6, R9, R10, R11

  **Dependencies:** Units 1, 2, 3, 4

  **Files:**
  - Create: `apps/cms/src/api/search/services/search.ts`
  - Test: `apps/cms/src/api/search/services/search.test.ts`

  **Approach:**
  - `search(strapi, { query, locale, limit, offset })` — the main entry point
  - Validate limit (default 20, max 50) and offset (default 0)
  - Step 1: Call `embedQuery(query)` to get query vector (~200ms)
  - Step 2: Run semantic and keyword retrieval in parallel (`Promise.all`). Both get `limit * 3` overfetch for dedup headroom.
  - Step 3: `fuseRankedLists([semanticResults, keywordResults], 60)`
  - Step 4: `deduplicateResults(fused, limit + offset)` — dedup enough for the requested page
  - Step 5: Apply `offset` and `limit` to deduped results
  - Step 6: Map to `SearchResult[]` contract (type, id, slug, title, imageUrl, snippet, startSeconds, playbackId, score)
  - Return `{ results, total: dedupedBeforePagination.length, query }`
  - `total` is the count of unique results after dedup (across all pages). At 955 videos this is cheap. If it becomes expensive, switch to an approximation.

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/services/recommender.ts:getRecommendations()` — service entry point pattern

  **Test scenarios:**
  - Happy path: returns paginated, deduplicated, fused results
  - Pagination: offset=0 and offset=5 return different results
  - Limit clamping: limit > 50 clamped to 50, limit < 1 clamped to 1
  - Empty query embedding result: propagates error
  - No results from either retrieval: returns empty array with total=0

  **Verification:**
  - Unit tests pass
  - End-to-end flow: query → embed → retrieve → fuse → dedup → paginate → map

- [ ] **Unit 6: REST controller and routes**

  **Goal:** Expose `GET /api/search` as a public REST endpoint.

  **Requirements:** R7, R8, R9

  **Dependencies:** Unit 5

  **Files:**
  - Create: `apps/cms/src/api/search/controllers/search.ts`
  - Create: `apps/cms/src/api/search/routes/search.ts`

  **Approach:**
  - Controller: validate `q` (required, non-empty), `locale` (required), `limit` (optional, numeric), `offset` (optional, numeric). Return 400 for invalid params. Delegate to `search()` service. Return 200 with `SearchResponse`.
  - Route: `GET /api/search` → `search.search` handler, `config: { auth: false, policies: [], middlewares: [] }` — fully public, no api-token-auth middleware (unlike the scene-embedding routes which require tokens).
  - Error handling: catch service errors, log via `strapi.log.error()`, return 503 for infrastructure failures.

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts:recommendations()` — query param validation pattern
  - `apps/cms/src/api/scene-embedding/routes/scene-embedding.ts` — route registration

  **Test scenarios:**
  - Missing `q` param: 400
  - Missing `locale` param: 400
  - Valid request: 200 with correct response shape
  - Service error: 503

  **Verification:**
  - `curl "localhost:1337/api/search?q=forgiveness&locale=en"` returns 200 with results

- [ ] **Unit 7: GraphQL extension**

  **Goal:** Expose `semanticSearch` query in the GraphQL schema, public access.

  **Requirements:** R7, R8

  **Dependencies:** Unit 5

  **Files:**
  - Create: `apps/cms/src/graphql/search.ts`
  - Modify: `apps/cms/src/index.ts` (register the extension in `register()`)

  **Approach:**
  - `registerSearchExtension(strapi)` following the recommendations pattern
  - `typeDefs`: `SearchResult` type (matching the REST contract fields), `SearchResponse` type with `results`, `total`, `query`, and the `semanticSearch` query with args `query: String!`, `locale: String!`, `limit: Int`, `offset: Int`
  - Resolver: delegates to the same `search()` service function
  - `resolversConfig: { "Query.semanticSearch": { auth: false } }` for public access
  - Register in `src/index.ts` `register()` alongside `registerRecommendationsExtension`

  **Patterns to follow:**
  - `apps/cms/src/graphql/recommendations.ts` — type definitions, resolver structure, public auth config, registration in index.ts

  **Test scenarios:**
  - GraphQL query returns correct response shape
  - Missing required `query` arg: GraphQL validation error
  - Missing required `locale` arg: GraphQL validation error
  - Service error: returns user-friendly error message

  **Verification:**
  - `{ semanticSearch(query: "forgiveness", locale: "en") { results { title score snippet } total } }` returns results

- [ ] **Unit 8: Bootstrap GIN index for full-text search**

  **Goal:** Add a GIN index on `videos` for tsvector-based keyword search, created idempotently at CMS boot.

  **Requirements:** R1 (keyword performance)

  **Dependencies:** Unit 2 (must match the tsvector expression used in keyword-search.ts)

  **Files:**
  - Modify: `apps/cms/src/bootstrap/ensure-pgvector.ts`

  **Approach:**
  - Add a `CREATE INDEX IF NOT EXISTS` statement for a GIN index on `to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))` on the `videos` table
  - Place it in the existing `ensurePgvector()` function alongside the scene_embeddings indexes — it's all search infrastructure
  - The index expression must exactly match the `to_tsvector()` call in `keyword-search.ts` for PostgreSQL to use the index

  **Patterns to follow:**
  - `apps/cms/src/bootstrap/ensure-pgvector.ts` — idempotent `CREATE INDEX IF NOT EXISTS` pattern

  **Test scenarios:**
  - Index creation is idempotent (no error on repeated runs)
  - Index exists after bootstrap

  **Verification:**
  - CMS boots without errors
  - `\di` in psql shows the new GIN index on `videos`

## System-Wide Impact

- **Interaction graph:** The search service is a new, standalone read path. No callbacks, webhooks, or lifecycle hooks are affected. The only new external call is to OpenRouter for query embedding (~200ms).
- **Error propagation:** OpenRouter failures should return 503 (search unavailable), not 500. If pgvector is not available (local dev), the semantic component fails but keyword search could still work — evaluate whether to degrade gracefully or fail entirely (recommendation: fail entirely in v1, consistent with how the recommender handles pgvector absence).
- **State lifecycle risks:** None. Search is purely read-only. No writes, no caches, no state mutations.
- **API surface parity:** REST and GraphQL return identical data from the same service. The API contract in feat-010 is what Urim builds against — do not change the response shape.
- **Integration coverage:** End-to-end verification requires a running CMS with pgvector, scene_embeddings data, and OpenRouter access. Unit tests should mock the DB and OpenRouter layers.

## Risks & Dependencies

- **OpenRouter availability from Railway**: The CMS has never called OpenRouter before. Verify that Railway's network allows outbound HTTPS to `openrouter.ai`. If blocked, this is a deployment-time issue.
- **OPENROUTER_API_KEY provisioning**: New env var needed in Railway CMS service settings and Doppler `forge-cms` project. Must be set before the search endpoint works.
- **Scene embedding coverage**: Search quality depends on scene embeddings existing for the video catalog. If embeddings are sparse, semantic results will be thin. Keyword search provides a fallback.
- **tsvector 'simple' config limitations**: The `'simple'` config doesn't provide language-specific stemming. For Phase 1 (en, es, fr) this is acceptable. If keyword quality is poor, consider language-specific configs later.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-13-semantic-search-api-requirements.md](docs/brainstorms/2026-04-13-semantic-search-api-requirements.md)
- **Roadmap ticket:** [docs/roadmap/content-discovery/feat-010-semantic-search-api.md](docs/roadmap/content-discovery/feat-010-semantic-search-api.md)
- Related code: `apps/cms/src/api/scene-embedding/services/recommender.ts` (primary pattern)
- Related code: `apps/cms/src/graphql/recommendations.ts` (GraphQL extension pattern)
- Related code: `apps/manager/src/services/openrouter.ts` (OpenRouter client pattern)
- Related code: `apps/manager/src/services/embeddings.ts` (embedding generation pattern)
- Blocks: feat-011 (web search UI), feat-012 (mobile search UI)
