---
title: "feat: Recommendation Query API (feat-044)"
type: feat
status: completed
date: 2026-04-08
origin: docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md
---

# feat: Recommendation Query API (feat-044)

## Overview

Add `GET /api/scene-embedding/recommendations` (REST) and a custom `sceneRecommendations` GraphQL query to the CMS. Both query the pgvector `scene_embeddings` table for similar scenes across different videos with locale-aware filtering. REST serves API-token consumers; GraphQL serves web/mobile frontends via gql.tada typed operations. This is the core recommendation capability that the demo frontend (feat-046) and future recommendation UI will consume.

## Problem Frame

With 1,965 scenes from 467 videos indexed in `scene_embeddings` (feat-042 complete), there is no way to query for similar content. The indexed embeddings are write-only — no read path exists. This endpoint closes the loop and makes the vectorization work usable.

(see origin: `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md`, R4/R4a/R4b)

## Requirements Trace

- R4. Cross-film recommendation via vector similarity, deduplicated across language variants
- R4a. Locale-aware filtering — `locale` param required, only return videos with a variant in that language
- R4b. `rerank` parameter accepted but no-op in Phase 1

## Scope Boundaries

- **Phase 1 only**: Pure vector similarity scoring. No user feedback loop, no click-through weighting
- **No theme boost/rerank**: Themes are already front-loaded in the embedding description. The `rerank` param is accepted but is a no-op
- **No recommendation UI**: This provides the query capability only

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/scene-embedding/services/indexer.ts` — existing service pattern: exports pure functions taking `strapi`, uses `strapi.db.connection` (knex) for raw SQL
- `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts` — controller pattern: factory function returning handler methods, manual ctx.status/ctx.body, try/catch with typed errors
- `apps/cms/src/api/scene-embedding/routes/scene-embedding.ts` — route config: `auth: false`, `middlewares: ["global::api-token-auth"]`
- `apps/cms/src/api/backfill-queue/services/backfill-queue.ts:48-72` — **critical locale join pattern**: Strapi v5 uses link tables, not direct FK columns
- `apps/cms/src/api/video-coverage/services/video-coverage.ts` — complex SQL with CTEs and knex.raw

### Institutional Learnings

- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md` — raw SQL via knex, `toPgArray()` for PG 18+ compatibility, HNSW index patterns
- Strapi v5 DB columns are snake_cased (`bcp_47` not `bcp47`)
- `?::jsonb::text[]` cast is NOT supported on PG 18+. Use PG array literal format with `?::text[]`

## Key Technical Decisions

- **Embedding-only theme signal**: Themes are already front-loaded and repeated in the `description` field that gets embedded. Pure vector similarity captures thematic similarity. No explicit theme overlap boost in Phase 1 — can be added later via the `rerank` parameter
- **Best-scene-match aggregation**: For per-video recommendations (no `sceneIndex`), query using the input video's scenes and return the top-N unique candidate videos by their single best scene similarity. Simpler and faster than averaging, and surfaces the strongest thematic connection per candidate
- **Corrected locale join**: The brainstorm's SQL uses `JOIN video_variants vv ON vv.video_id = se.video_id` which is incorrect for Strapi v5. The actual join chain requires link tables: `video_variants_video_lnk` → `video_variants` → `video_variants_language_lnk` → `languages`
- **DISTINCT ON for video dedup**: Use `DISTINCT ON (se.video_id)` to return at most one scene per candidate video, ordered by similarity. This prevents flooding results with multiple scenes from the same video
- **Two query modes**: Per-scene (specific `sceneIndex`) uses that scene's embedding directly. Per-video (no `sceneIndex`) finds the best match across all input video scenes — query each scene's embedding and take the top-N unique videos by best similarity
- **Custom GraphQL resolver via Strapi v5 `register()` lifecycle**: Use `strapi.plugin('graphql').service('extension').use()` with SDL `typeDefs` + `resolvers` + `resolversConfig`. Custom types appear in the generated `schema.graphql`, so `packages/graphql` codegen picks them up for gql.tada typed operations
- **GraphQL auth: false**: The `sceneRecommendations` query is public (same as shadowCRUD queries). Frontend authentication is handled at the Cloudflare/app layer, not per-query in Strapi GraphQL

## Open Questions

### Resolved During Planning

- **Locale join pattern**: Confirmed via `backfill-queue.ts` — must use `video_variants_video_lnk` + `video_variants_language_lnk` + `languages` (Strapi v5 link tables)
- **Theme handling**: Embedding-only — themes are weighted in the description text. No post-processing boost needed
- **Per-video aggregation**: Best-scene-match, not average similarity

### Deferred to Implementation

- **Exact per-video query strategy**: For per-video mode, need to determine whether to run N separate queries (one per input scene) or use a single query with `ANY()` on multiple embeddings. The single-query approach may not be expressible efficiently in pgvector — implementation will determine the best approach
- **Published_at filtering**: May need `JOIN videos v ON v.id = se.video_id WHERE v.published_at IS NOT NULL` to exclude draft videos. Verify whether scene_embeddings only contains published video data (from backfill) or could contain drafts

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
GET /api/scene-embedding/recommendations
  ?videoId=123        (required)
  &locale=en          (required)
  &sceneIndex=2       (optional — per-scene mode)
  &limit=10           (optional, default 10, max 50)
  &rerank=            (optional, no-op Phase 1)

Flow:
1. Validate params (videoId numeric, locale non-empty, limit in range)
2. Fetch input embedding(s):
   - Per-scene: SELECT embedding FROM scene_embeddings WHERE video_id=$1 AND scene_index=$2
   - Per-video: SELECT embedding, scene_index FROM scene_embeddings WHERE video_id=$1
3. If no embeddings found → 404
4. Run similarity query with locale-aware join:
   scene_embeddings
     → video_variants_video_lnk (se.video_id = vvl.video_id)
     → video_variants (vvl.video_variant_id = vv.id, published)
     → video_variants_language_lnk (vv.id = vll.video_variant_id)
     → languages (vll.language_id = l.id, l.bcp_47 = $locale)
   WHERE se.video_id != $inputVideoId
   ORDER BY se.embedding <=> $inputEmbedding
   DISTINCT ON se.video_id (best scene per candidate)
   LIMIT $limit
5. Return JSON array of recommendations
```

## Implementation Units

- [x] **Unit 1: Recommender service**

  **Goal:** Create the recommendation query service with per-scene and per-video modes

  **Requirements:** R4, R4a

  **Dependencies:** None (scene_embeddings table and HNSW index exist from feat-041/042)

  **Files:**
  - Create: `apps/cms/src/api/scene-embedding/services/recommender.ts`

  **Approach:**
  - Export `getRecommendations(strapi, params)` following the same pattern as `indexer.ts` — pure function taking strapi instance
  - Use `strapi.db.connection` (knex) for raw SQL
  - Per-scene mode: fetch single embedding by `(video_id, scene_index)`, run similarity query
  - Per-video mode: fetch all embeddings for the input video, run similarity query for each, merge results keeping best similarity per candidate video, return top-N
  - Locale join uses Strapi v5 link tables: `video_variants_video_lnk` → `video_variants` → `video_variants_language_lnk` → `languages` (confirmed from `backfill-queue.ts:58-63`)
  - Use `DISTINCT ON (se.video_id)` ordered by similarity to deduplicate scenes from same candidate video
  - Filter: `se.video_id != $inputVideoId`, `l.bcp_47 = $locale`, `vv.published_at IS NOT NULL`
  - Return type includes: videoId, sceneIndex, description, startSeconds, endSeconds, similarity, themes, playbackId

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/services/indexer.ts` — service structure, KnexInstance type alias, raw SQL pattern
  - `apps/cms/src/api/backfill-queue/services/backfill-queue.ts:58-63` — locale join chain via link tables

  **Test scenarios:**
  - Per-scene query returns scenes from different videos with similarity scores
  - Per-video query returns deduplicated videos (one scene per candidate)
  - Locale filtering: query with `locale=es` never returns videos without Spanish variants
  - Never returns the input video in results
  - Returns empty array when video has no embeddings (after 404 for missing input)
  - Respects limit parameter
  - Results are ordered by descending similarity

  **Verification:**
  - Service function is callable and returns typed results
  - SQL uses correct Strapi v5 link table join pattern (not direct FK)

- [x] **Unit 2: Controller handler and validation**

  **Goal:** Add `recommendations` handler to the existing scene-embedding controller with input validation

  **Requirements:** R4, R4a, R4b

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts`

  **Approach:**
  - Add `recommendations` method to the controller factory object
  - Parse query params from `ctx.request.query`: `videoId`, `locale`, `sceneIndex`, `limit`, `rerank`
  - Validate: `videoId` required and numeric, `locale` required and non-empty, `sceneIndex` optional and numeric, `limit` optional (default 10, max 50)
  - Accept `rerank` param silently (no-op in Phase 1)
  - Call recommender service, return results as JSON
  - Error handling: 400 for validation errors, 404 if input video has no embeddings, 503 if scene_embeddings table doesn't exist (same pattern as `stats` handler)

  **Patterns to follow:**
  - `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts` — existing handler pattern with ctx.status/ctx.body, try/catch

  **Test scenarios:**
  - Missing `videoId` → 400
  - Missing `locale` → 400
  - Non-numeric `videoId` → 400
  - `limit` > 50 → clamped to 50
  - Valid request → 200 with recommendations array
  - Video with no embeddings → 404
  - pgvector not available → 503

  **Verification:**
  - All query params are validated before hitting the database
  - Response shape matches the type contract from Unit 1

- [x] **Unit 3: Route registration**

  **Goal:** Register the GET /scene-embedding/recommendations route with api-token-auth middleware

  **Requirements:** R4

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `apps/cms/src/api/scene-embedding/routes/scene-embedding.ts`

  **Approach:**
  - Add a new route entry following the existing pattern
  - `method: "GET"`, `path: "/scene-embedding/recommendations"`, `handler: "scene-embedding.recommendations"`
  - Same config: `auth: false`, `middlewares: ["global::api-token-auth"]`

  **Patterns to follow:**
  - Existing routes in the same file — identical config structure

  **Test scenarios:**
  - Route is accessible with valid API token
  - Route returns 401/403 without token

  **Verification:**
  - Endpoint responds at `GET /api/scene-embedding/recommendations` with api-token auth

- [x] **Unit 4: Custom GraphQL resolver**

  **Goal:** Expose recommendations as a `sceneRecommendations` GraphQL query using Strapi v5's extension service, backed by the same recommender service

  **Requirements:** R4, R4a, R4b

  **Dependencies:** Unit 1

  **Files:**
  - Create: `apps/cms/src/graphql/recommendations.ts` (extension definition — typeDefs, resolvers, resolversConfig)
  - Modify: `apps/cms/src/index.ts` (wire up extension in `register()` lifecycle)

  **Approach:**
  - Define SDL `typeDefs` for `SceneRecommendation` type and `sceneRecommendations` query with args: `videoId: Int!`, `locale: String!`, `sceneIndex: Int`, `limit: Int`
  - Resolver calls the same `getRecommendations` service from Unit 1
  - `resolversConfig` sets `'Query.sceneRecommendations': { auth: false }` for public access
  - Keep the extension in a separate file for clarity, import and wire it in `register()`
  - Extension uses the `({ strapi }) => ({...})` factory pattern so it has access to strapi instance for calling the recommender service

  **Patterns to follow:**
  - Strapi v5 `extensionService.use()` pattern from docs: `typeDefs` (SDL string) + `resolvers` object + `resolversConfig`
  - `apps/cms/src/index.ts` `register()` lifecycle — currently empty, add extension registration

  **Test scenarios:**
  - `query { sceneRecommendations(videoId: 123, locale: "en") { videoId similarity } }` returns results
  - Missing required args → GraphQL validation error
  - Results match REST endpoint output for same params
  - Custom type appears in generated `schema.graphql`

  **Verification:**
  - Query is accessible at `/graphql` endpoint
  - `SceneRecommendation` type and `sceneRecommendations` query appear in `schema.graphql`

- [x] **Unit 5: GraphQL codegen for packages/graphql**

  **Goal:** Regenerate gql.tada types so web/mobile can consume `sceneRecommendations` with typed operations

  **Requirements:** R4

  **Dependencies:** Unit 4

  **Files:**
  - Modify: `apps/cms/schema.graphql` (auto-generated by Strapi)
  - Modify: `packages/graphql/` (codegen output)

  **Approach:**
  - Run Strapi locally to generate updated `schema.graphql` with the new custom types
  - Run codegen in `packages/graphql/` to regenerate typed introspection
  - Verify the `SceneRecommendation` type and `sceneRecommendations` query are available in the generated types

  **Patterns to follow:**
  - The GraphQL Change Flow documented in root CLAUDE.md (steps 2-3)

  **Test scenarios:**
  - `packages/graphql` codegen completes without errors
  - New types are importable from `packages/graphql`

  **Verification:**
  - `schema.graphql` contains `SceneRecommendation` type and `sceneRecommendations` query
  - Codegen output includes the new types

- [x] **Unit 6: Manual verification against production data**

  **Goal:** Verify recommendation quality and performance against the 1,965 indexed scenes

  **Requirements:** R4, R4a (verification criteria from feat-044 roadmap ticket)

  **Dependencies:** Units 1-3

  **Files:**
  - None (manual testing)

  **Approach:**
  - Query with a known video + `locale=en` → verify results are different videos with >0.5 similarity, all with English variants
  - Query same video + `locale=es` → verify different result set, all with Spanish variants
  - Verify no locale bleed: `locale=es` never returns English-only videos
  - Verify input video never appears in results
  - Measure response time — target <500ms for top-10
  - Spot-check thematic similarity — results should be plausibly related

  **Verification:**
  - All verification criteria from feat-044 roadmap ticket pass
  - Response time <500ms for limit=10

## System-Wide Impact

- **Interaction graph:** Only the scene-embedding API is affected. No callbacks, observers, or middleware changes. The api-token-auth middleware is reused as-is
- **Error propagation:** pgvector unavailability degrades gracefully to 503 (same as existing stats endpoint). Invalid input returns 400. Missing embeddings returns 404
- **State lifecycle risks:** None — this is a read-only endpoint. No writes, no cache, no state mutations
- **API surface parity:** This is a new endpoint. feat-046 (demo frontend) will consume it. No existing consumers to coordinate with
- **Integration coverage:** Manual verification against production data (Unit 4) covers the cross-layer concern of pgvector + Strapi v5 link tables + locale filtering

## Risks & Dependencies

- **Strapi v5 link table join correctness**: The brainstorm's SQL is simplified and won't work. Must use the 4-table join chain confirmed in `backfill-queue.ts`. This is the #1 implementation risk — verify the SQL against production data early
- **Per-video mode performance**: For videos with many scenes (feature films: 50-200 scenes), per-video mode runs one similarity query per scene. May need optimization (e.g., query only top-3 scenes by some heuristic) if response time exceeds 500ms. Defer optimization unless verification fails the performance target
- **Published_at filtering**: Backfill only indexed published videos, but the query should still filter `vv.published_at IS NOT NULL` on video_variants to handle edge cases where a variant is unpublished after indexing
- **First custom GraphQL resolver**: This is the first custom resolver in the CMS. The `register()` lifecycle and `extensionService.use()` pattern is new to this codebase. If schema generation doesn't pick up the custom types, may need to investigate Strapi v5 artifact generation config

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md](docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md) (R4, R4a, R4b)
- **Roadmap ticket:** [docs/roadmap/content-discovery/feat-044-recommendation-query-api.md](docs/roadmap/content-discovery/feat-044-recommendation-query-api.md)
- Related code: `apps/cms/src/api/scene-embedding/` (existing services, controllers, routes)
- Related code: `apps/cms/src/api/backfill-queue/services/backfill-queue.ts` (locale join pattern)
- Institutional learning: `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`
