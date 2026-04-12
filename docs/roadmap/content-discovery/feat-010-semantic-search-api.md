---
id: "feat-010"
title: "Semantic Search API"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-04-14"
duration: 21
depends_on:
  - "feat-009"
blocks:
  - "feat-011"
  - "feat-012"
tags:
  - "cms"
  - "search"
  - "pgvector"
---

## Entry Points — Read These First

1. `apps/cms/src/api/core-sync/controllers/` — pattern for custom Strapi controllers
2. `apps/cms/src/api/core-sync/routes/` — pattern for custom routes
3. `apps/manager/src/lib/openrouter.ts` — OpenRouter client for generating query embeddings (you'll need this or a copy in CMS)
4. Feature 2 above — the `transcript_embeddings` table you just built

## Grep These

- `createCoreRouter` in `apps/cms/src/api/*/routes/` — Strapi route pattern
- `strapi.db.connection.raw` in `apps/cms/src/` — raw SQL query pattern
- `getOpenrouter` in `apps/manager/src/lib/` — embedding generation client

## What To Build

1. New custom route + controller: `apps/cms/src/api/search/`

   ```
   apps/cms/src/api/search/
   ├── controllers/search.ts
   ├── routes/search.ts
   └── services/search.ts
   ```

2. Endpoint: `GET /api/search?q=:query&language=:lang&topic=:topicSlug&limit=:n&offset=:n`

3. Search flow in `services/search.ts`:

   ```typescript
   export async function semanticSearch(params: {
     query: string
     language?: string
     topicSlug?: string
     limit?: number // default 20
     offset?: number // default 0
   }): Promise<{
     results: Array<{
       videoId: number
       title: string
       description: string
       snippet: string // matching chunk text
       score: number // 0-1 relevance (1 - cosine distance)
       thumbnail?: string
       slug?: string
     }>
     total: number
     query: string
   }>
   ```

4. Implementation:
   - Generate embedding for the query text (call OpenRouter `text-embedding-3-small` — same model used for indexing)
   - Query pgvector:
     ```sql
     SELECT DISTINCT ON (v.id)
       v.id, v.title, v.description, v.slug,
       ve.chunk_text AS snippet,
       1 - (ve.embedding <=> $1::vector) AS score
     FROM transcript_embeddings ve
     JOIN videos v ON v.id = ve.video_id
     LEFT JOIN topics_videos_lnk tvl ON tvl.video_id = v.id
     LEFT JOIN topics t ON t.id = tvl.topic_id
     WHERE ($2::text IS NULL OR t.slug = $2)
     ORDER BY v.id, score DESC
     ```
     Then sort by score and paginate.
   - Join video metadata for display fields

5. Add OpenRouter API key to CMS environment variables (or proxy through manager app).

## Constraints

- Do NOT use Strapi's built-in `find` with filters for search. It's keyword-only and won't scale.
- Do NOT add Algolia or Elasticsearch. pgvector is sufficient for this scale.
- Query embedding generation adds ~200ms latency. This is acceptable.
- Return the matching `chunk_text` as `snippet` so the frontend can show why a result matched.
- The Strapi table names for `videos` and `topics` may have different actual names (Strapi adds prefixes). Verify with `SELECT tablename FROM pg_tables WHERE tablename LIKE '%video%'`.

## Verification

- `curl "localhost:1337/api/search?q=forgiveness"` → returns ranked video results
- Results for "forgiveness" are different from results for "creation" (semantic, not keyword)
- `curl "localhost:1337/api/search?q=forgiveness&topicSlug=love"` → filters to love topic only
- Response time < 500ms for typical queries
- Pagination works: `offset=0&limit=5` vs `offset=5&limit=5` return different results

## API Contract for Urim

Document this response shape — Urim will build the search UI against it:

```json
{
  "results": [
    {
      "videoId": 123,
      "title": "The Story of Forgiveness",
      "description": "A short film about...",
      "snippet": "...when he forgave his brother, everything changed...",
      "score": 0.87,
      "thumbnail": "https://cloudflare.../thumbnail.jpg",
      "slug": "story-of-forgiveness"
    }
  ],
  "total": 42,
  "query": "forgiveness"
}
```
