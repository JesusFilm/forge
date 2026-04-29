---
id: "feat-086"
title: "Search Extension — Add Experiences to Results"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-04-23"
duration: 5
depends_on:
  - "feat-010"
  - "feat-095"
  - "feat-096"
blocks: []
tags:
  - "cms"
  - "search"
  - "pgvector"
---

## Problem

The Semantic Search API (feat-010) returns only `type: "video"` results. Experiences — like the `easter` landing page with curated content blocks — are invisible to search. A user querying "Easter" gets videos about Easter bunnies but misses the dedicated Easter experience page that is specifically designed to drive engagement around that topic.

The search API was designed with this extension in mind: the `type` field on each result is a discriminator, the fusion function already accepts N ranked lists, and experiences are a logical second content type. With feat-095 (pipeline) and feat-096 (backfill) shipping the `experience_embeddings` table populated with data, this ticket is the thin integration layer: query experiences alongside videos, fuse all four ranked lists, update the `SearchResult` contract.

Unblocks richer discovery — searching for "Christmas" or "Easter" should surface both topical videos AND the experience landing pages that package them.

## Entry Points — Read These First

1. `apps/cms/src/api/search/services/search.ts` — the orchestrator. Will add experience retrieval as a third and fourth ranked list before fusion.
2. `apps/cms/src/api/search/services/fusion.ts` — `fuseRankedLists(lists, k)` already generic over N lists. Verify `RankedItem` identity key handles heterogeneous result types.
3. `apps/cms/src/api/search/services/semantic-search.ts` and `keyword-search.ts` — the existing video retrieval patterns to mirror.
4. `apps/cms/src/api/search/services/experience-embedder.ts` (from feat-095) — the pipeline that populated `experience_embeddings`.
5. `apps/cms/src/bootstrap/ensure-pgvector.ts` — verify the `experience_embeddings` table and GIN FTS index on `experiences` were created by feat-095.
6. `apps/cms/src/graphql/search.ts` — where the `SearchResult` GraphQL type is defined. Needs update for optional fields.
7. `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — the architectural pattern this extends.
8. `docs/plans/2026-04-13-003-feat-semantic-search-api-plan.md` — the original v1 search plan. Read the Scope Boundaries section — this ticket moves experiences out of "future" into "supported".

## Grep These

- `registerSearchExtension` in `apps/cms/src/graphql/` — where `SearchResult` GraphQL type is defined.
- `experience_embeddings` in `apps/cms/src/` — the table created by feat-095.
- `videos_fulltext_search_idx` in `apps/cms/src/` — the GIN FTS pattern feat-095 mirrored for experiences.
- `fuseRankedLists` in `apps/cms/src/api/search/` — the RRF function. Confirm it handles 4 lists without contract changes.
- `RankedItem` in `apps/cms/src/api/search/services/fusion.ts` — the identity type that needs to handle video vs experience without collision.

## What To Build

### 0. Add `type` filter parameter to search API

The search endpoint gains an optional `type` query parameter that controls which content types are searched:

```
GET /api/search?q=Easter&locale=en                    # both (default)
GET /api/search?q=Easter&locale=en&type=video         # videos only
GET /api/search?q=Easter&locale=en&type=experience    # experiences only
```

- **`type` values:** `"video"`, `"experience"`, or omitted (defaults to both).
- **Invalid values:** return 400 with `{ error: "type must be 'video' or 'experience'" }`.
- **Optimization:** when `type=video`, skip experience retrieval entirely (no DB queries, no embedding call waste). Same for `type=experience` — skip video retrieval. This keeps response times tight for consumers that only need one content type.
- **Controller change:** parse `query.type` in `search.ts` controller, pass to orchestrator as `contentTypes: ("video" | "experience")[]`.
- **Orchestrator change:** only launch retrieval promises for the requested content types. Only pass non-empty result lists into `fuseRankedLists` — do not pad with empty arrays. Passing empty lists into RRF dilutes scores for the populated lists (each item's rank-based score is divided across N lists, even when some contribute nothing). Filter empties before fusion.
- **GraphQL:** add optional `type` argument to the `semanticSearch` query in `apps/cms/src/graphql/search.ts`.

### 1. Experience semantic retrieval

`apps/cms/src/api/search/services/experience-semantic-search.ts`:

- Query `experience_embeddings` by cosine similarity on the query embedding
- Filter by `locale`
- Join to `experiences` for `title`, `slug`, `meta_description`, `image_url` (or equivalent)
- Only return rows where `experiences.published_at IS NOT NULL`
- Return `ExperienceSemanticResult[]` shaped for fusion

```sql
SELECT
  ee.experience_id AS id,
  e.slug,
  e.title,
  e.meta_description AS snippet,
  -- image source depending on experience schema
  1 - (ee.embedding <=> ?::vector) AS similarity
FROM experience_embeddings ee
JOIN experiences e ON e.id = ee.experience_id
  AND e.published_at IS NOT NULL
WHERE ee.locale = ?
ORDER BY ee.embedding <=> ?::vector
LIMIT ?
```

### 2. Experience keyword retrieval

`apps/cms/src/api/search/services/experience-keyword-search.ts`:

- `ts_rank` over the `videos_fulltext_search_idx`-style GIN index on `experiences.title + meta_description` (created by feat-095)
- Locale filter via `experiences.locale = $locale`
- Published filter

Mirrors `keyword-search.ts` for videos but against `experiences` directly (experiences are localized entities — no link-table chain).

### 3. Extend the `RankedItem` identity key

`fuseRankedLists` currently keys the Map by `videoId`. For mixed video + experience results, video id=4 and experience id=4 would collide. Use a compound key:

```ts
type RankedItem = {
  resultType: "video" | "experience"
  resultId: number
  // ...rest
}

// In fusion:
const key = `${item.resultType}:${item.resultId}`
```

Or keep `videoId` but add `experienceId` as a separate field — whichever keeps the video code path untouched for backward compatibility with feat-011/012 consumers mid-flight.

### 4. Update the orchestrator

In `apps/cms/src/api/search/services/search.ts`:

```ts
const [semanticVideos, keywordVideos, semanticExperiences, keywordExperiences] =
  await Promise.allSettled([
    searchBySemantic(knex, { queryEmbedding, locale, limit: overfetchLimit }),
    searchByKeyword(knex, { query, locale, limit: overfetchLimit }),
    searchByExperienceSemantic(knex, {
      queryEmbedding,
      locale,
      limit: overfetchLimit,
    }),
    searchByExperienceKeyword(knex, { query, locale, limit: overfetchLimit }),
  ])

const fused = fuseRankedLists(
  [
    unwrapOutcome(strapi, semanticVideos, "semantic-video"),
    unwrapOutcome(strapi, keywordVideos, "keyword-video"),
    unwrapOutcome(strapi, semanticExperiences, "semantic-experience"),
    unwrapOutcome(strapi, keywordExperiences, "keyword-experience"),
  ],
  RRF_K,
)
```

Four lists via `Promise.allSettled` maintains the graceful-degradation guarantee from v1: if any one retrieval fails, others survive.

### 5. Dedup behavior

The 3-layer video dedup (core_id prefix, title match, embedding similarity) doesn't apply to experiences:

- Experiences have no `core_id`
- Title collisions across types are usually meaningful ("Easter" the experience vs "Easter" a video are both legitimately relevant)
- Cross-type embedding similarity is not a dedup concern — these are different content types

Update `deduplicateResults()` to skip the video-specific dedup checks when `resultType !== "video"`. Experiences pass through unchanged.

### 6. Update `SearchResult` TS type + GraphQL schema

Extend the discriminator:

```ts
type SearchResult = {
  type: "video" | "experience"
  id: number
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  startSeconds: number | null // null for experiences (already nullable since feat-010 P1 fix)
  playbackId: string | null // null for experiences (same)
  score: number
}
```

`startSeconds` and `playbackId` are already nullable since feat-010's post-review hardening. No breaking change — just documenting that experiences also produce null for these fields.

Update `apps/cms/src/graphql/search.ts` GraphQL typeDefs comment text to reflect that null also means "this is an experience, not a video", not only "keyword-only video match".

### 7. Tests

- `experience-semantic-search.test.ts` and `experience-keyword-search.test.ts` — mirror the existing `semantic-search.test.ts` / `keyword-search.test.ts` patterns.
- `search.test.ts` — update to cover 4-list fusion. Add cases:
  - Only experience results (no video match)
  - Only video results (no experience match)
  - Mixed results — experience ranked above video
  - Collision case: video id=4 and experience id=4 both appear, both survive (compound key works)
- `fusion.test.ts` — verify compound key handling.
- `search.test.ts` — `type` filter tests:
  - `type=video` returns only videos, no experience DB queries fired
  - `type=experience` returns only experiences, no video DB queries fired
  - `type` omitted returns both (default)
  - `type=invalid` returns 400
- End-to-end smoke: publish an experience, embed via feat-095 lifecycle, `curl /api/search?q=<experience-title>` returns it.

## API Contract Extension

```typescript
// Request — now with optional type filter:
GET /api/search?q=Easter&locale=en              // both (default)
GET /api/search?q=Easter&locale=en&type=video   // videos only
GET /api/search?q=Easter&locale=en&type=experience // experiences only

// Response now includes experiences:
{
  "results": [
    {
      "type": "experience",
      "id": 4,
      "slug": "easter",
      "title": "Easter",
      "imageUrl": "https://.../easter-hero.jpg",
      "snippet": "Discover the true meaning of Easter through story, scripture, and reflection.",
      "startSeconds": null,
      "playbackId": null,
      "score": 0.96
    },
    {
      "type": "video",
      "id": 1598,
      "slug": "worker-bunny",
      "title": "Worker Bunny",
      "imageUrl": "...",
      "snippet": "Themes: disappointment, frustration, tradition...",
      "startSeconds": 0,
      "playbackId": "...",
      "score": 0.92
    }
  ],
  "hasMore": true,
  "query": "Easter"
}
```

## Constraints

- **Pipeline + backfill must ship first.** This ticket assumes `experience_embeddings` is populated. Without data, the joins return zero rows and experiences are still invisible.
- **Backwards compatible API.** Existing v1 consumers (Urim's feat-011/feat-012) must not break. The `type` field was already present since v1; `startSeconds` / `playbackId` already nullable. The only change on the wire is that `type: "experience"` starts appearing in result sets.
- **Response time budget unchanged**: <500ms. Adding two more parallel retrievals should not blow the budget since they all run in `Promise.allSettled` with the same over-fetch factor.
- **Locale handling differs from videos.** Experiences are localized entities (one row per locale with a `locale` column). Videos go through `video_variants → languages`. Simpler join for experiences.
- **Rate limit contract unchanged.** Same 30/min/IP shared bucket.
- **No personalization.** That's feat-091+ (FPMC, Two-Tower).

## Verification

- `curl "localhost:1337/api/search?q=Easter&locale=en"` returns BOTH videos AND the `easter` experience, with `type` correctly set on each.
- Experience result has `startSeconds: null` and `playbackId: null`.
- Semantic query like "find meaning in suffering" returns thematically relevant experiences alongside videos.
- Spanish query with `locale=es` returns only experiences with a Spanish locale row in `experience_embeddings`.
- GraphQL: `{ semanticSearch(query: "Easter", locale: "en") { results { type id title } } }` returns mixed types.
- Query where experience and video share an integer ID (e.g., video 4 and experience 4) returns both as distinct results.
- Regression: video-only queries (e.g., "forgiveness" with no matching experience) return identical results to pre-feat-086 with identical scores.
- Response time stays <500ms p95 under realistic load.
- Rate limit still fires at 30 req/min/IP with `Retry-After` header.
- `type=video` returns only video results, no experience retrieval queries executed.
- `type=experience` returns only experience results, no video retrieval queries executed.
- `type=invalid` returns 400 with error message.
- Omitting `type` returns both videos and experiences (backwards compatible default).

## Out of Scope

- **Experience embedding pipeline** (feat-095).
- **Experience backfill** (feat-096).
- **Personalization signals** (feat-091+).
- **Scene-level experience results** (matching a specific content block within an experience) — whole-experience granularity only in v1.
- **Cross-type semantic similarity** (recommending videos based on an experience's embedding) — recommendation API, not search.
- **Experience admin UI** showing "search-ready" or embedding status badge.
