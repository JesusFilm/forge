---
id: "feat-010"
title: "Semantic Search API"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-04-14"
duration: 21
depends_on:
  - "feat-009"
  - "feat-044"
blocks:
  - "feat-011"
  - "feat-012"
  - "feat-086"
tags:
  - "cms"
  - "search"
  - "pgvector"
---

## Problem

JesusFilm has 955+ videos with rich scene-level embeddings (themes, bible verses, demographics, narrative descriptions) and transcript-level embeddings, but no way for users to search this content by natural language query. This API unblocks Urim's web search UI (feat-011) and mobile search UI (feat-012).

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/recommender.ts` — recommendation query service. Search reuses the locale-filtering SQL join chain, deduplication logic, and DISTINCT ON pattern.
2. `apps/cms/src/api/scene-embedding/routes/scene-embedding.ts` — custom route pattern for the CMS API.
3. `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts` — controller pattern (validation, error handling, delegation to services).
4. `apps/cms/src/graphql/recommendations.ts` — GraphQL extension pattern for public query registration.
5. `apps/cms/src/bootstrap/ensure-pgvector.ts` — pgvector table schemas (`transcript_embeddings`, `scene_embeddings`).
6. `docs/brainstorms/2026-04-13-semantic-search-api-requirements.md` — full brainstorm with industry research and design decisions.

## Grep These

- `DISTINCT ON` in `apps/cms/src/api/scene-embedding/` — the per-video dedup SQL pattern
- `video_variants_video_lnk` in `apps/cms/src/` — locale-aware join chain
- `deduplicateResults` in `apps/cms/src/` — 3-layer dedup logic (core_id, title, embedding)
- `registerStrapi` in `apps/cms/src/graphql/` — GraphQL resolver registration pattern
- `tsvector` in `apps/cms/src/` — full-text search (will be new)

## What To Build

1. **New API module**: `apps/cms/src/api/search/`

   ```
   apps/cms/src/api/search/
   ├── controllers/search.ts
   ├── routes/search.ts
   └── services/
       ├── search.ts          # orchestrator: embed query → retrieve → fuse → dedup → respond
       ├── embed-query.ts     # OpenRouter text-embedding-3-small client
       └── keyword-search.ts  # PostgreSQL tsvector/tsquery on video title + description
   ```

2. **Hybrid search with Reciprocal Rank Fusion (RRF)**:

   Two retrieval strategies merged into one ranked list:
   - **Semantic retrieval**: Embed the user's query via OpenRouter `text-embedding-3-small`, then query `scene_embeddings` using pgvector cosine similarity. `DISTINCT ON (video_id)` returns one result per video (best-matching scene).
   - **Keyword retrieval**: PostgreSQL full-text search (`tsvector`/`tsquery` or `ILIKE`) on `videos.title` and `videos.description`. Returns matching videos ranked by text relevance.
   - **Fusion**: Reciprocal Rank Fusion merges both ranked lists: `RRF_score = Σ 1/(k + rank_i)` where k=60 (tunable). Easy to extend with a third ranked list (personalization) later.

3. **Endpoint**: `GET /api/search?q=:query&locale=:lang&limit=:n&offset=:n`

4. **GraphQL query**: `semanticSearch(query: String!, locale: String!, limit: Int, offset: Int): SearchResponse`

5. **Query embedding generation**: New OpenRouter client in CMS that calls `text-embedding-3-small` to embed the user's search query (~200ms latency). This is the first time the CMS generates embeddings (previously it only received them).

6. **Locale-aware filtering**: Same join chain as recommendation API:

   ```
   scene_embeddings.video_id
     → video_variants_video_lnk.video_id
     → video_variants (published_at IS NOT NULL)
     → video_variants_language_lnk.video_variant_id
     → languages.bcp_47 = $locale
   ```

7. **Deduplication**: Reuse the recommendation API's 3-layer dedup (core_id prefix, exact title, embedding similarity >0.95) from `recommender.ts`.

8. **Scoring pipeline extensibility**: The RRF fusion function accepts an array of ranked lists. v1 provides two (semantic + keyword). Future versions add personalization signals (FPMC transition scores, Two-Tower user embeddings from feat-084+) as additional ranked lists — no API contract change needed.

## API Contract for Urim

```typescript
// Request
GET /api/search?q=forgiveness&locale=en&limit=20&offset=0

// Response
type SearchResponse = {
  results: SearchResult[]
  hasMore: boolean             // true when more results exist beyond this page
  query: string
}

type SearchResult = {
  type: "video"                // extensible: "experience" in future
  id: number                   // video ID
  slug: string
  title: string
  imageUrl: string | null      // COALESCE(mobile_cinematic_high, url) from video_images
  snippet: string              // best-matching scene description
  startSeconds: number | null  // null when match is keyword-only (no scene-level timestamp)
  playbackId: string | null    // null when match is keyword-only (no scene-level Mux asset)
  score: number                // 0-1 RRF-normalized relevance score
}

// REST error responses:
//   400 — { error: "q (search query) is required" | "locale is required" }
//   429 — { error: "Too many requests..." } + Retry-After header (seconds)
//   503 — { error: "Search is temporarily unavailable" } (rare: only on unexpected
//         internal failure; OpenRouter outages degrade gracefully to keyword-only)
//
// GraphQL errors are returned in the standard `errors[].extensions.code` envelope
// with machine-readable codes. Use `extensions.code` for programmatic handling:
//   BAD_USER_INPUT       — empty/whitespace query
//   RATE_LIMITED         — rate limit exceeded; read extensions.retryAfterSeconds
//                          (integer seconds) to schedule retry
//   SERVICE_UNAVAILABLE  — rare; unexpected internal failure
```

```json
{
  "results": [
    {
      "type": "video",
      "id": 123,
      "slug": "story-of-forgiveness",
      "title": "The Story of Forgiveness",
      "imageUrl": "https://cloudflare.../thumbnail.jpg",
      "snippet": "A powerful scene exploring the theme of forgiveness as a father reconciles with his son...",
      "startSeconds": 45.0,
      "playbackId": "abc123",
      "score": 0.87
    }
  ],
  "hasMore": true,
  "query": "forgiveness"
}
```

## Constraints

- **pgvector only** — no Algolia, no Elasticsearch.
- **Public access, no auth** — matches recommendation API. Rate limiting via Cloudflare WAF.
- **Response time <500ms** for typical queries (including ~200ms for query embedding generation).
- **v1 filters: locale only.** Theme, bible verse, demographic, video label filters are future additions.
- **No personalization in v1.** Scoring pipeline is designed for it but no user signals are incorporated yet.
- **Phase 1 languages only**: en, es, fr.
- **Scene embeddings as semantic source**, not transcript embeddings. Scene descriptions already encode transcript content + themes + context (industry standard per Netflix, YouTube, Twelve Labs). Transcript search can be added as a third RRF input later if needed.
- The `type` field on results is always `"video"` in v1. Future content types (experiences) will use the same response shape.
- Strapi table names use link tables for joins. Verify actual table names with `\d tablename` against prod before writing SQL.

## Verification

- `curl "localhost:1337/api/search?q=forgiveness&locale=en"` → returns ranked video results with scores
- `curl "localhost:1337/api/search?q=JESUS+Film&locale=en"` → returns the JESUS Film as top result (keyword/title matching works)
- `curl "localhost:1337/api/search?q=dealing+with+grief&locale=en"` → returns thematically relevant results even if "grief" isn't in any title (semantic search works)
- `curl "localhost:1337/api/search?q=forgiveness&locale=es"` → only returns videos with Spanish variants (no locale bleed)
- Results for "forgiveness" are different from results for "creation" (semantic differentiation)
- Response time <500ms for typical queries
- Pagination: `offset=0&limit=5` vs `offset=5&limit=5` return different results
- GraphQL: `{ semanticSearch(query: "forgiveness", locale: "en") { results { title score } } }` → works
- No duplicate videos in results (deduplication working)
- All results have `type: "video"` in v1
