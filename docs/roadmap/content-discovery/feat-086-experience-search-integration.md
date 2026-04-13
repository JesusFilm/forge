---
id: "feat-086"
title: "Search Extension — Experience Embeddings & Indexing"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-05-05"
duration: 10
depends_on:
  - "feat-010"
blocks: []
tags:
  - "cms"
  - "search"
  - "pgvector"
  - "ai-pipeline"
---

## Problem

The Semantic Search API (feat-010) returns only `type: "video"` results. Experiences — like the `easter` landing page with curated content blocks — are invisible to search. A user querying "Easter" gets videos about Easter bunnies but misses the dedicated Easter experience page that is specifically designed to drive engagement around that topic.

The existing search API was designed with this extension in mind: the `type` field on results is always `"video"` in v1, the fusion function already accepts N ranked lists, and experiences are a logical second content type. This ticket adds experience embeddings, an indexing pipeline, and wires them into the search orchestrator.

Unblocks richer discovery — searching for "Christmas" or "Easter" should surface both topical videos AND the experience landing pages that package them.

## Entry Points — Read These First

1. `apps/cms/src/api/search/services/search.ts` — the orchestrator. Will add experience retrieval as a third and fourth ranked list before fusion.
2. `apps/cms/src/api/search/services/fusion.ts` — `fuseRankedLists(lists, k)` already generic over N lists. Verify `RankedItem` type works for experiences without changes.
3. `apps/cms/src/api/search/services/semantic-search.ts` and `keyword-search.ts` — patterns to mirror for experience variants.
4. `apps/cms/src/api/scene-embedding/services/indexer.ts` — existing scene-embedding indexer. The experience indexer follows the same idempotent upsert pattern.
5. `apps/cms/src/bootstrap/ensure-pgvector.ts` — where the new `experience_embeddings` table must be added idempotently.
6. `apps/cms/src/api/experience/content-types/experience/schema.json` — the Experience content type. Note the localized `title`, `metaDescription`, `ogTitle`, `ogDescription`, `pathSegment`, and the `experiences_cmps` dynamic zone with content blocks.
7. `apps/cms/src/api/experience/content-types/experience/lifecycles.js` — where to hook embedding regeneration on publish/update.
8. `apps/manager/src/services/embeddings.ts` — `openai/text-embedding-3-small` (1536-dim) model. Experiences must use the same model as scene_embeddings so vectors are comparable in the same space.
9. `docs/plans/2026-04-13-003-feat-semantic-search-api-plan.md` — the v1 search plan. Read the Scope Boundaries section — this ticket moves experiences out of "future" into "supported".

## Grep These

- `registerSearchExtension` in `apps/cms/src/graphql/` — where the `SearchResult` GraphQL type is defined. Needs update for optional fields.
- `experiences_cmps` in `apps/cms/src/` — the dynamic content blocks join table. Need to understand structure to extract embeddable text.
- `lifecycle` in `apps/cms/src/api/experience/` — publish/update hooks.
- `scene_embeddings` in `apps/cms/src/` — the existing pgvector table pattern.
- `tsvector` in `apps/cms/src/` — the GIN index pattern to mirror.

## What To Build

### 1. New `experience_embeddings` table (bootstrap)

Add to `ensure-pgvector.ts` alongside `scene_embeddings`:

```sql
CREATE TABLE IF NOT EXISTS experience_embeddings (
  id                SERIAL PRIMARY KEY,
  experience_id     INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  locale            TEXT NOT NULL,
  slug              TEXT NOT NULL,
  source_text       TEXT NOT NULL,
  embedding         vector(1536) NOT NULL,
  model             TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(experience_id, locale)
)
```

Plus HNSW index (`embedding vector_cosine_ops`), btree on `(experience_id, locale)`, and a GIN index on `to_tsvector('simple', title + meta_description)` for keyword search (mirrors the `videos_fulltext_search_idx` pattern).

### 2. Experience embedding indexer

`apps/cms/src/api/experience/services/experience-embedder.ts`:

- `buildExperienceText(experience, locale)` — flattens the experience into an embeddable document: `title`, `metaDescription`, `ogTitle`, `ogDescription`, plus text content from each component in `experiences_cmps` (section headers, paragraph blocks, captions — NOT raw HTML)
- `indexExperience(strapi, experienceId, locale)` — builds the text, calls `embedQuery()` (lift and rename the existing embed function if needed, or extract to a shared `embedText()`), upserts into `experience_embeddings` by `(experience_id, locale)`
- `deleteExperienceEmbedding(strapi, experienceId, locale)` — called when unpublished or deleted

### 3. Lifecycle hooks on the Experience content type

Modify `apps/cms/src/api/experience/content-types/experience/lifecycles.js`:

- `afterUpdate`: if `published_at` transitioned to non-null OR experience content changed, enqueue `indexExperience()` for each locale
- `afterPublish`: enqueue `indexExperience()`
- `afterUnpublish` / `afterDelete`: call `deleteExperienceEmbedding()`

All calls are fire-and-forget with error logging — experience save must never fail because embedding generation failed.

### 4. Experience search services

`apps/cms/src/api/search/services/experience-semantic-search.ts`:

- Query `experience_embeddings` with query embedding, filter by `locale`, order by cosine similarity, LIMIT 3x overfetch
- Join to `experiences` for `title`, `slug`, `meta_description`
- Return `ExperienceSemanticResult[]` shaped to merge into the fusion `RankedItem` type (`videoId` becomes a shared numeric ID field; use `id` + `type` discriminator instead — see below)

`apps/cms/src/api/search/services/experience-keyword-search.ts`:

- tsvector on `experiences.title + meta_description` with `ts_rank`
- Locale filter via `experiences.locale = $locale` (experiences are localized entities, no link table chain needed — see schema)
- Published filter

### 5. Extend the `RankedItem` contract

Currently `RankedItem` assumes `videoId: number` as the identity. Change fusion to use a compound key:

```typescript
type RankedItem = {
  resultType: "video" | "experience"
  resultId: number
  // ... rest of properties
}
```

The fusion Map key becomes `${resultType}:${resultId}`. This lets videos and experiences coexist in the same ranked list without ID collision.

Alternatively, add a second retrieval call pair (experience-semantic + experience-keyword) that runs alongside the existing two, and fuses all four lists together. The fusion is already N-list capable; only the dedup key needs to be compound.

### 6. Update the orchestrator

In `apps/cms/src/api/search/services/search.ts`:

```typescript
const [semanticVideos, keywordVideos, semanticExperiences, keywordExperiences] =
  await Promise.all([
    searchBySemantic(...),
    searchByKeyword(...),
    searchByExperienceSemantic(...),
    searchByExperienceKeyword(...),
  ])

const fused = fuseRankedLists(
  [semanticVideos, keywordVideos, semanticExperiences, keywordExperiences],
  RRF_K,
)
```

Dedup logic: the 3-layer video dedup doesn't apply to experiences. Skip dedup checks when `resultType !== "video"` (or add type-aware checks — experiences have no core_id or embedding near-duplicate problem).

### 7. Update the `SearchResult` type + GraphQL schema

The plan's API contract already has `type: "video"` — extend to `type: "video" | "experience"`. Fields that only apply to videos become nullable:

```typescript
type SearchResult = {
  type: "video" | "experience"
  id: number
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  startSeconds: number | null // null for experiences
  playbackId: string | null // null for experiences
  score: number
}
```

Update `apps/cms/src/graphql/search.ts` GraphQL type definitions to match: `startSeconds: Float`, `playbackId: String` (both nullable now).

**Urim-facing API change:** `startSeconds` and `playbackId` may now be null. The mobile/web UIs must handle this when rendering experience results (show experience card without timestamp/play button).

### 8. Backfill script

`apps/cms/src/scripts/backfill-experience-embeddings.ts`:

- Iterate all published experiences across all locales
- Call `indexExperience()` for each
- Idempotent — safe to rerun
- One-time run after deployment + whenever embedding model changes

### 9. Tests

- `experience-embedder.test.ts` — verifies text flattening correctly pulls title, meta_description, and content block text
- `experience-semantic-search.test.ts` and `experience-keyword-search.test.ts` — mirror the patterns from the video services
- `search.test.ts` — update to cover 4-list fusion with both video and experience results
- `fusion.test.ts` — verify compound `resultType:resultId` keys prevent collisions between a video with id=4 and an experience with id=4

## API Contract Extension

```typescript
// Unchanged
GET /api/search?q=Easter&locale=en

// New response shape
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
  "total": 12,
  "query": "Easter"
}
```

## Constraints

- **Same embedding model as scene_embeddings** (`openai/text-embedding-3-small`, 1536-dim). Vectors must be comparable in the same space if we ever add cross-type semantic similarity later.
- **No new external service** — reuse OpenRouter client from `apps/cms/src/lib/openrouter.ts`.
- **Lifecycle hooks must not block writes.** Experience save/publish must never fail because embedding generation failed. Log and continue.
- **Backwards compatible API.** Existing v1 consumers (Urim's search UIs in feat-011/feat-012) must not break. The `type` field was already present. `startSeconds` and `playbackId` become nullable — coordinate with Urim if feat-011/012 have already shipped.
- **Locale handling differs from videos.** Videos are non-localized entities joined to `video_variants.language`. Experiences are themselves localized (one row per locale with `locale` column). The join chain is simpler for experiences.
- **Response time budget unchanged**: <500ms. Adding two more parallel retrievals should not blow the budget since they all run in `Promise.all`.
- **No personalization** in this ticket. That's feat-084+.

## Verification

- Apply migrations → `\dt experience_embeddings` shows the table, `\di` shows HNSW + GIN indexes
- `pnpm --filter @forge/cms dev` boots without errors
- Publishing an experience in Strapi admin fires the lifecycle hook and inserts a row in `experience_embeddings`
- `curl "localhost:1337/api/search?q=Easter&locale=en"` returns BOTH videos AND the `easter` experience, with `type` correctly set on each
- Experience result has `startSeconds: null` and `playbackId: null`
- Semantic search for "find God's purpose in suffering" returns thematically relevant experiences, not just videos
- Spanish query with `locale=es` returns only experiences with a Spanish localization
- GraphQL `{ semanticSearch(...) { results { type id title } } }` works for both types
- Backfill script populates `experience_embeddings` for all published experiences
- No regression: video-only queries (e.g., "forgiveness" which has no matching experience) return the same videos as before with the same scores
- Unit test: fusion correctly handles a video with id=4 and an experience with id=4 without collapsing them

## Out of Scope

- Personalization signals (feat-084+)
- Scene-level experience results (e.g., matching a specific section within an experience) — whole-experience granularity only in v1
- Cross-type semantic similarity (suggesting videos based on an experience's embedding) — recommendation API, not search
- Experience admin UI showing "search-ready" badge
