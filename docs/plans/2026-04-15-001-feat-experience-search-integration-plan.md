---
title: "feat: Add experiences to search results (feat-086)"
type: feat
status: completed
date: 2026-04-15
origin: docs/brainstorms/2026-04-13-semantic-search-api-requirements.md
---

# feat: Add experiences to search results (feat-086)

## Overview

Extend the hybrid search API to return experience results alongside video results. The search orchestrator currently fires 2 retrievals (video semantic + video keyword), fuses via RRF, and returns `type: "video"` results. This adds 2 experience retrievals, updates the fusion identity key to prevent cross-type collisions, and exposes a `type` filter parameter so consumers can request videos only, experiences only, or both.

## Problem Frame

Users searching "Easter" get videos about Easter bunnies but miss the dedicated Easter experience page — a curated landing page designed to drive engagement. The `experience_embeddings` table is populated (feat-095/096), the fusion function already accepts N ranked lists, and the `type` discriminator was designed for this extension. This is a thin integration layer, not a new subsystem.

(see origin: `docs/brainstorms/2026-04-13-semantic-search-api-requirements.md` — scope boundaries explicitly deferred experiences to post-v1)

## Requirements Trace

- R1. Experience semantic search: query `experience_embeddings` by cosine similarity, filter by locale and published_at
- R2. Experience keyword search: `ts_rank` over `experiences_fulltext_search_idx` GIN index
- R3. Mixed fusion: 4 ranked lists (video semantic, video keyword, experience semantic, experience keyword) merged via RRF without cross-type ID collision
- R4. Type filter: optional `?type=video|experience` on REST, optional `type` argument on GraphQL. Omitted = both. Invalid = 400
- R5. Backward compatibility: existing consumers see no breaking changes. `startSeconds` and `playbackId` already nullable
- R6. Response time <500ms (parallel retrievals via `Promise.allSettled`)
- R7. Dedup: video-specific 3-layer dedup skipped for experience results

## Scope Boundaries

- No experience embedding pipeline changes (feat-095)
- No backfill changes (feat-096)
- No personalization signals (feat-091+)
- No scene-level experience results (whole-experience granularity only)
- No cross-type semantic similarity or recommendations
- No experience image URL in v1 if the Strapi media join is complex — return `null` and iterate

## Context & Research

### Relevant Code and Patterns

- **Orchestrator** `apps/cms/src/api/search/services/search.ts`: 5-step pipeline (embed → retrieve → fuse → dedup → paginate). `SearchResult.type` hardcoded to `"video"`. `mapToSearchResult()` reads video-specific fields from `FusedResult`. `unwrapOutcome()` extracts `Promise.allSettled` results.
- **Fusion** `apps/cms/src/api/search/services/fusion.ts`: `fuseRankedLists()` uses `item.videoId` (number) as Map key — collision risk. `RankedItem` has `videoId`, `videoCoreId`, `videoTitle` as required fields plus open `[key: string]: unknown`. `deduplicateResults()` has 3 video-specific checks.
- **Video semantic** `apps/cms/src/api/search/services/semantic-search.ts`: `DISTINCT ON (se.video_id)` + subquery pattern. 4-table locale join chain. Returns `SemanticResult` with `videoId`, scene-level fields.
- **Video keyword** `apps/cms/src/api/search/services/keyword-search.ts`: `ts_rank` on `to_tsvector('simple', title || description)`. Same locale join chain. Returns `KeywordResult` with `videoId`.
- **Controller** `apps/cms/src/api/search/controllers/search.ts`: Validates `q` and `locale`, parses `limit`/`offset`. No `type` parsing yet.
- **GraphQL** `apps/cms/src/graphql/search.ts`: `registerSearchExtension()` defines `SearchResult` type and `semanticSearch` query. Resolver validates empty query, checks rate limit, calls `search()`.
- **DB schema**: `experience_embeddings` table with `HNSW` index on `embedding`, `UNIQUE(experience_id, locale)`. `experiences_fulltext_search_idx` GIN index on `to_tsvector('simple', title || meta_description)`. Both created by feat-095 bootstrap.
- **Experience schema**: `experiences` table has `slug`, `title`, `meta_description`, `locale`, `published_at`, `og_image` (media relation). Locale is a direct column — no link-table chain needed.
- **Test pattern**: Colocated sibling files. `createMockKnex()` factory, `buildRow()` with overrides, `vi.mock()` at module level, `vi.mocked()` for type-safe assertions.

### Institutional Learnings

- `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — the architecture being extended. RRF handles N lists natively. `Promise.allSettled` for graceful degradation. Nullable scene fields for non-video result types.
- `docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md` — `experience_embeddings` schema. Locale is on the row (no join chain). `slug` stored on embedding row.
- `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md` — use `GraphQLError` directly, never custom Error subclasses.
- `docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md` — separate table per retrieval grain. Merge at fusion layer, not storage layer.
- Strapi v5 raw SQL: field names are snake_case in DB (`metaDescription` → `meta_description`). Always verify with `\d tablename`.

## Key Technical Decisions

- **Compound identity key in fusion**: Change `fuseRankedLists` Map key from `item.videoId` (number) to `${item.resultType}:${item.resultId}` (string). This prevents video id=4 and experience id=4 from colliding. The `scoreMap` and `propsMap` both change from `Map<number, ...>` to `Map<string, ...>`.

- **RankedItem type evolution**: Add `resultType: "video" | "experience"` and `resultId: number` as required fields. Make `videoId`, `videoCoreId`, `videoTitle` optional (they are only meaningful for video results). Experience results carry their own fields (`experienceSlug`, `experienceTitle`, etc.) via the existing open index signature. Video search functions continue returning their current shapes; the orchestrator annotates with `resultType`/`resultId` before passing to fusion.

- **Empty list filtering before fusion**: When `type=video`, only fire video retrievals. When `type=experience`, only fire experience retrievals. Before calling `fuseRankedLists`, filter out empty arrays. Passing empty lists dilutes RRF scores because the theoretical maximum assumes all lists contribute.

- **Dedup type guard**: `deduplicateResults` skips all 3 video-specific checks (core_id prefix, title match, embedding similarity) when `candidate.resultType !== "video"`. Experiences pass through with only the limit cap applied.

- **Experience image URL**: The `experiences.og_image` field is a Strapi media relation requiring a multi-table join through `files_related_morphs` → `files`. If this join is straightforward, include it. If complex, return `imageUrl: null` for experiences in v1 and iterate — the search result contract already has `imageUrl` as nullable.

- **No `DISTINCT ON` needed for experiences**: Unlike videos (which can have multiple variants per locale), `experience_embeddings` has a `UNIQUE(experience_id, locale)` constraint. One row per experience per locale — no dedup at the SQL level needed.

## Open Questions

### Resolved During Planning

- **RRF score normalization with variable list count**: When `type=video` sends 2 lists and `type` omitted sends 4 lists, the `theoreticalMax` normalization (`lists.length / (k + 1)`) naturally adjusts. Scores are always [0,1] regardless of list count. No change needed to the normalization logic.
- **Experience `locale` column name**: Strapi v5 i18n stores locale directly on the content table. The column is `locale` (not snake-cased from something else). Confirmed in the experience embeddings pipeline.
- **Test file location**: Tests are colocated siblings in `apps/cms/src/api/search/services/`, not in a `__tests__/` subdirectory.

### Deferred to Implementation

- **Exact experience image join SQL**: Whether to join `files_related_morphs` → `files` for `og_image` or return `null`. Depends on verifying the Strapi v5 media link table structure at implementation time.
- **Experience `embeddingText` for cross-experience dedup**: v1 skips dedup for experiences entirely. If future experience volume warrants it, `embeddingText` can be carried through from `experience_embeddings.embedding::text` and a within-type dedup layer added.

## Implementation Units

- [x] **Unit 1: Extend fusion identity key and RankedItem type**

  **Goal:** Make `fuseRankedLists` and `deduplicateResults` work with heterogeneous result types without cross-type ID collision.

  **Requirements:** R3, R7

  **Dependencies:** None — this is the foundation other units build on.

  **Files:**
  - Modify: `apps/cms/src/api/search/services/fusion.ts`
  - Test: `apps/cms/src/api/search/services/fusion.test.ts`

  **Approach:**
  - Add `resultType: "video" | "experience"` and `resultId: number` to `RankedItem`. Make `videoId` optional (existing video code still sets it).
  - Change `scoreMap` and `propsMap` from `Map<number, ...>` to `Map<string, ...>` keyed by `${resultType}:${resultId}`.
  - In `deduplicateResults`, wrap the 3 video-specific checks in a `resultType === "video"` guard. Non-video results only check the limit cap.
  - Update the `forEach` callback that builds `FusedResult[]` to spread `resultType` and `resultId` from `propsMap`.

  **Patterns to follow:**
  - Existing `fuseRankedLists` structure — accumulate scores, merge properties, normalize, sort.
  - Existing `deduplicateResults` structure — iterate candidates, check against kept list.

  **Test scenarios:**
  - Video-only lists: behavior identical to current (regression)
  - Mixed lists: video id=4 and experience id=4 both survive as distinct results
  - Experience results skip all 3 dedup checks
  - Property merge priority preserved across types (semantic list takes priority over keyword list)
  - Score normalization correct with 2 lists and 4 lists

  **Verification:**
  - All existing `fusion.test.ts` tests pass with minimal updates (adding `resultType`/`resultId` to test data)
  - New compound key tests pass

- [x] **Unit 2: Experience semantic search**

  **Goal:** Query `experience_embeddings` by cosine similarity with locale filtering and published_at check.

  **Requirements:** R1

  **Dependencies:** Unit 1 (return type must include `resultType`/`resultId`)

  **Files:**
  - Create: `apps/cms/src/api/search/services/experience-semantic-search.ts`
  - Test: `apps/cms/src/api/search/services/experience-semantic-search.test.ts`

  **Approach:**
  - Mirror the structure of `semantic-search.ts` but much simpler SQL:
    - No `DISTINCT ON` (unique constraint handles it)
    - No locale join chain (direct `WHERE ee.locale = ?`)
    - Join `experience_embeddings ee` → `experiences e` on `e.id = ee.experience_id AND e.published_at IS NOT NULL`
  - Select: `ee.experience_id`, `e.slug`, `e.title`, `e.meta_description`, `1 - (ee.embedding <=> ?::vector) AS similarity`
  - Return type includes `resultType: "experience"`, `resultId: experienceId`
  - Same `mapRow` pattern (snake_case → camelCase)

  **Patterns to follow:**
  - `apps/cms/src/api/search/services/semantic-search.ts` — SQL structure, `mapRow`, export signature
  - `createMockKnex()` + `buildRow()` test pattern from `semantic-search.test.ts`

  **Test scenarios:**
  - Returns mapped results with correct field names
  - Passes correct bindings to `knex.raw` (embedding, locale, embedding, limit)
  - Returns empty array when no matches
  - Filters out unpublished experiences (`published_at IS NULL`)
  - Locale filtering works (only returns matching locale)

  **Verification:**
  - Tests pass. Function can be imported and called from the orchestrator.

- [x] **Unit 3: Experience keyword search**

  **Goal:** Full-text keyword search on `experiences.title + meta_description` using the existing GIN index.

  **Requirements:** R2

  **Dependencies:** Unit 1 (return type must include `resultType`/`resultId`)

  **Files:**
  - Create: `apps/cms/src/api/search/services/experience-keyword-search.ts`
  - Test: `apps/cms/src/api/search/services/experience-keyword-search.test.ts`

  **Approach:**
  - Mirror `keyword-search.ts` structure but against `experiences` table directly
  - SQL uses `ts_rank(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(meta_description, '')), plainto_tsquery('simple', ?))` — matches the GIN index expression
  - Filter: `WHERE ... @@ ... AND locale = ? AND published_at IS NOT NULL`
  - No `DISTINCT ON` needed (one row per experience per locale in the `experiences` table via i18n)
  - Short-circuit on empty/whitespace query (same as video keyword)
  - Return type includes `resultType: "experience"`, `resultId: experienceId`

  **Patterns to follow:**
  - `apps/cms/src/api/search/services/keyword-search.ts` — SQL structure, empty query short-circuit, `mapRow`
  - `createMockKnex()` + `buildRow()` test pattern from `keyword-search.test.ts`

  **Test scenarios:**
  - Returns results ordered by rank descending
  - Returns empty array for empty/whitespace query without hitting DB
  - Passes correct bindings (query, locale, query, limit)
  - Filters by locale and published_at
  - Field mapping correctness (snake_case → camelCase)

  **Verification:**
  - Tests pass. Function can be imported and called from the orchestrator.

- [x] **Unit 4: Update orchestrator with type filter and 4-list fusion**

  **Goal:** Wire experience retrievals into the search pipeline, add `contentTypes` parameter, filter empty lists before fusion.

  **Requirements:** R3, R4, R5, R6

  **Dependencies:** Units 1, 2, 3

  **Files:**
  - Modify: `apps/cms/src/api/search/services/search.ts`
  - Test: `apps/cms/src/api/search/services/search.test.ts`

  **Approach:**
  - Add `contentTypes?: ("video" | "experience")[]` to `SearchParams`. Default to `["video", "experience"]` when omitted.
  - Conditionally launch retrievals based on `contentTypes`: if only `"video"`, fire 2 video retrievals. If only `"experience"`, fire 2 experience retrievals. If both, fire all 4 via `Promise.allSettled`.
  - Collect results, filter out empty arrays, pass non-empty lists to `fuseRankedLists`.
  - Update `mapToSearchResult` to handle both types: check `resultType` to determine field mapping. Video results use `videoId`/`videoSlug`/`videoTitle`/`description`/`startSeconds`/`playbackId`. Experience results use `experienceId`/`experienceSlug`/`experienceTitle`/`experienceMetaDescription`. Both map to the same `SearchResult` shape.
  - Update `SearchResult.type` from `"video"` to `"video" | "experience"`.

  **Patterns to follow:**
  - Existing `Promise.allSettled` + `unwrapOutcome` pattern
  - Existing `mapToSearchResult` field-reading pattern

  **Test scenarios:**
  - Default (no contentTypes): 4 retrievals fired, mixed results returned
  - `contentTypes: ["video"]`: only 2 video retrievals, no experience search functions called
  - `contentTypes: ["experience"]`: only 2 experience retrievals, no video search functions called
  - Graceful degradation: experience semantic fails, video results still returned
  - Experience results have `type: "experience"`, `startSeconds: null`, `playbackId: null`
  - Empty retrieval lists filtered before fusion (verify `fuseRankedLists` not called with empty arrays)
  - Regression: video-only query returns identical results to pre-change behavior

  **Verification:**
  - All existing `search.test.ts` tests pass (with mock updates for new imports)
  - New type filter tests pass

- [x] **Unit 5: Update controller and GraphQL for type filter**

  **Goal:** Expose the `type` filter parameter on REST and GraphQL endpoints with validation.

  **Requirements:** R4, R5

  **Dependencies:** Unit 4

  **Files:**
  - Modify: `apps/cms/src/api/search/controllers/search.ts`
  - Modify: `apps/cms/src/graphql/search.ts`

  **Approach:**
  - **Controller**: Parse `query.type`. Valid values: `"video"`, `"experience"`, or absent. Invalid → 400 with `{ error: "type must be 'video' or 'experience'" }`. Convert to `contentTypes` array and pass to `search()`.
  - **GraphQL**: Add optional `type: String` argument to `semanticSearch` query. Validate in resolver — invalid values throw `GraphQLError` with `BAD_USER_INPUT` code. Convert to `contentTypes` and pass to `search()`.
  - **GraphQL typeDefs**: Update `SearchResult.startSeconds` and `SearchResult.playbackId` descriptions to note that null also applies to experience results, not just keyword-only matches.

  **Patterns to follow:**
  - Existing controller validation pattern (`q` and `locale` checks)
  - Existing GraphQL resolver validation pattern (empty query → `BAD_USER_INPUT`)
  - `GraphQLError` with `extensions.code` (per `strapi-v5-graphql-error-extensions-stripping` learning)

  **Test scenarios:**
  - REST: `?type=video` passes `contentTypes: ["video"]` to search
  - REST: `?type=experience` passes `contentTypes: ["experience"]` to search
  - REST: no `type` param passes default (both)
  - REST: `?type=invalid` returns 400
  - GraphQL: `type: "video"` works
  - GraphQL: `type: "invalid"` returns `BAD_USER_INPUT` error
  - GraphQL: `type` omitted defaults to both

  **Verification:**
  - Controller and GraphQL resolver correctly route the type parameter
  - Invalid type values rejected at the boundary

- [x] **Unit 6: Integration tests for mixed results**

  **Goal:** Verify the full pipeline produces correct mixed results end-to-end within the test suite.

  **Requirements:** R1, R2, R3, R4, R5, R7

  **Dependencies:** Units 1–5

  **Files:**
  - Modify: `apps/cms/src/api/search/services/search.test.ts`
  - Modify: `apps/cms/src/api/search/services/fusion.test.ts`

  **Approach:**
  - Add orchestrator test cases that exercise the full 4-list flow with mocked dependencies returning both video and experience results.
  - Add fusion test cases for compound key correctness with heterogeneous types.
  - Verify collision resistance: video id=4 and experience id=4 both appear in output.
  - Verify dedup: experiences pass through unchanged while video dedup still functions.

  **Test scenarios:**
  - Mixed results: experience ranked above video by RRF score
  - Collision case: same integer ID, different types, both survive
  - Video dedup still works within video results
  - Experience results untouched by dedup
  - Pagination with mixed types: `offset`/`limit` slicing works correctly
  - `hasMore` signal correct with mixed result set

  **Verification:**
  - Full test suite passes: `pnpm --filter cms test`
  - No regressions in existing video-only test cases

## System-Wide Impact

- **API surface parity**: Both REST (`GET /api/search`) and GraphQL (`semanticSearch`) get the `type` filter. Both call the same `search()` service — no divergence risk.
- **Error propagation**: `Promise.allSettled` ensures experience retrieval failures degrade gracefully. Same pattern as existing video graceful degradation.
- **State lifecycle risks**: None — search is stateless read-only. No writes, no cache invalidation concerns.
- **Interaction graph**: No callbacks, middleware, or observers affected. The rate-limit middleware and shared bucket are unchanged.
- **Integration coverage**: Unit tests with mocked knex cover orchestration logic. Live verification against production data confirms SQL correctness and real response times.

## Risks & Dependencies

- **Data dependency**: `experience_embeddings` must be populated (feat-095 pipeline + feat-096 backfill). Without data, experience search returns empty results (safe but invisible).
- **Experience schema field names**: Raw SQL uses snake_case (`meta_description`, `published_at`). Verify column names against the actual DB before finalizing SQL. The Strapi v5 snake-case convention is documented but has caused bugs before (e.g., `bcp47` → `bcp_47`).
- **RRF score comparability**: Video semantic scores and experience semantic scores are both cosine similarity from the same embedding model (`text-embedding-3-small`), so they're comparable. Keyword scores use `ts_rank` which has different scale characteristics — but RRF is rank-based, not score-based, so this is fine by design.

## Sources & References

- **Origin document**: [docs/brainstorms/2026-04-13-semantic-search-api-requirements.md](docs/brainstorms/2026-04-13-semantic-search-api-requirements.md)
- **Feature ticket**: [docs/roadmap/content-discovery/feat-086-experience-search-integration.md](docs/roadmap/content-discovery/feat-086-experience-search-integration.md)
- **v1 search plan**: [docs/plans/2026-04-13-003-feat-semantic-search-api-plan.md](docs/plans/2026-04-13-003-feat-semantic-search-api-plan.md)
- **Search architecture learning**: [docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md](docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md)
- **Experience embedding pipeline learning**: [docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md](docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md)
- **GraphQL error pattern**: [docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md](docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md)
