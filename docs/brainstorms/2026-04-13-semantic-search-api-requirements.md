---
date: 2026-04-13
topic: semantic-search-api
---

# Semantic Search API

## Problem Frame

JesusFilm has 955+ videos with rich scene-level embeddings (themes, bible verses, demographics, narrative descriptions) and transcript-level embeddings, but no way for users to search this content. Users cannot find videos by topic, theme, or natural language query. Urim is blocked on building the web search UI (feat-011) and mobile search UI (feat-012) until this API exists.

The existing feat-010 roadmap ticket was written before scene embeddings existed and needs updating. The search API must also be designed so that future personalization signals (watch events, FPMC, Two-Tower from feat-084 through feat-088) can be injected into the ranking without changing the API contract.

## Requirements

- R1. **Hybrid search**: The API combines two retrieval strategies into a single ranked result list: (a) semantic vector similarity on `scene_embeddings` using the query's embedding, and (b) keyword/title matching on video metadata (title, description) using PostgreSQL full-text search (`tsvector`/`tsquery`). Results from both strategies are merged using Reciprocal Rank Fusion (RRF).
- R2. **Query embedding generation**: The CMS generates a 1536-dim embedding for the user's search query by calling OpenRouter's `text-embedding-3-small` (same model used for indexing). This adds ~200ms latency and is acceptable.
- R3. **Locale-aware filtering**: The `locale` parameter is required. Only return videos that have a published variant in the requested language. Uses the same join chain as the recommendation API: `scene_embeddings` -> `video_variants_video_lnk` -> `video_variants` -> `video_variants_language_lnk` -> `languages.bcp_47`.
- R4. **Video-level results**: One result per video. The best-matching scene determines the video's score. Each result includes the matching scene's description as a snippet and its timestamp for deep-linking.
- R5. **Typed result list**: Each result carries a `type` field (v1: always `"video"`). This enables future content types (e.g., experiences) to appear in the same ranked list without changing the response shape.
- R6. **Extensible scoring pipeline**: The internal scoring function is structured so that additional scoring signals (personalization from watch history, session context, FPMC transition scores, Two-Tower user embeddings) can be added as new inputs to the RRF merge without changing the API response contract. In v1, only vector similarity and keyword relevance contribute to the score.
- R7. **REST + GraphQL**: The search API is exposed as both a custom REST endpoint (`GET /api/search`) and a GraphQL query (`semanticSearch`), matching the recommendation API pattern. Both consume the same service layer.
- R8. **Public access**: No authentication required for search. Rate limiting handled by Cloudflare WAF. Matches the recommendation API's public access model.
- R9. **Pagination**: Support `limit` (default 20, max 50) and `offset` parameters.
- R10. **Deduplication**: Reuse the recommendation API's 3-layer dedup strategy (core_id prefix match, exact title match, embedding similarity >0.95) to prevent near-duplicate videos in results (e.g., ad-format variants, cross-series same scene).
- R11. **Response metadata**: Each result includes: video ID, slug, title, image URL, matching scene description (snippet), scene timestamp (startSeconds), playback ID (for thumbnail/deep-link), and relevance score (0-1).

## Success Criteria

- `GET /api/search?q=forgiveness&locale=en` returns ranked video results with >0.5 relevance scores, all with English variants.
- Searching for a video's exact title (e.g., "JESUS Film") returns that video as the top result (keyword matching works).
- Searching for a theme (e.g., "dealing with grief") returns thematically relevant videos even if "grief" doesn't appear in the title (semantic search works).
- Same query with `locale=es` returns only videos with Spanish variants (no locale bleed).
- Response time <500ms for typical queries (including ~200ms for query embedding generation).
- Two different queries return meaningfully different result sets (not just re-ordered).
- Pagination works: `offset=0&limit=5` vs `offset=5&limit=5` return different results.

## Scope Boundaries

- **v1 filters: locale only.** Theme, bible verse, demographic, and video label filters are future additions. The API contract can accept additional filter parameters without breaking changes.
- **No personalization in v1.** The scoring pipeline is designed for it, but no user signals are incorporated. Pure relevance ranking.
- **No "did you mean" suggestions.** Future enhancement.
- **No faceted results or aggregations.** Future enhancement.
- **No experience results in v1.** The `type` field is present but only `"video"` results are returned until experiences are embedded and vectorized.
- **Phase 1 languages only.** English, Spanish, French.
- **Video-level results only.** No scene-level result granularity (multiple results per video) in v1.

## Key Decisions

- **Scene embeddings as the semantic source, not transcript embeddings**: Industry standard (Netflix, YouTube, Twelve Labs) is scene-level search. Scene descriptions already encode transcript content + themes + context, making them a superset of transcript-only signal. Transcript-level exact-quote search can be added as a third RRF input later if quality gaps appear.
- **Hybrid search (semantic + keyword) over vector-only**: Every major platform (YouTube, Netflix, Amazon) combines semantic understanding with keyword/title matching. Vector-only search fails for exact title queries; keyword-only fails for intent-based queries. PostgreSQL can do both natively (pgvector + tsvector).
- **Reciprocal Rank Fusion for score merging**: We lack the training data for a learned neural ranker (YouTube) or multiplicative blend (Netflix). RRF is the standard non-ML fusion method: merges ranked lists by reciprocal rank position without requiring score normalization. Easy to extend with additional ranked lists (personalization signals) later.
- **Amazon-style two-stage pattern (match -> rank)**: Matches our scale. Keyword matching retrieves candidates, vector similarity provides semantic ranking, RRF merges them. Future personalization becomes a re-ranking layer on top.
- **Personalization weight lower in search than in recommendations**: Following Netflix's principle — search should respect query intent first, personalize second. When personalization signals are added (feat-084+), they should adjust ranking within relevant results, not override relevance.
- **Single typed result list over grouped sections**: YouTube and Netflix both return a single ranked feed. A `type` discriminator on each result enables heterogeneous content types (videos now, experiences later) without response shape changes.
- **Public access, no auth**: Search is read-only on published content. Matches the recommendation API precedent. Cloudflare WAF handles rate limiting.

## Dependencies / Assumptions

- Scene embeddings are indexed in pgvector for ~955 processable videos (Phase 1 languages).
- The recommendation API's locale filtering SQL join chain and deduplication logic can be reused.
- OpenRouter API is accessible from the CMS Railway deployment for query embedding generation.
- PostgreSQL full-text search (`tsvector`/`tsquery`) is available on Railway PostgreSQL (standard feature, no extension needed).
- Urim's web search UI (feat-011) and mobile search UI (feat-012) will consume this API contract.

## Outstanding Questions

### Resolve Before Planning

(None — all blocking questions resolved.)

### Deferred to Planning

- [Affects R1][Needs research] What RRF constant (k) works best for our data distribution? Standard is k=60. May need tuning after testing with real queries.
- [Affects R1][Technical] Should the keyword search use PostgreSQL `tsvector` with `ts_rank` or a simpler `ILIKE` on title + description? `tsvector` is more powerful (stemming, ranking) but adds a GIN index requirement. Evaluate during implementation.
- [Affects R2][Technical] Where should the OpenRouter embedding client live in the CMS codebase? Options: `apps/cms/src/lib/openrouter.ts` (shared utility) or inline in the search service. Check if `apps/manager/src/lib/openrouter.ts` can be extracted to a shared package.
- [Affects R4][Technical] The recommendation API over-fetches 3x and deduplicates in JS. Should search use the same pattern or can dedup happen in SQL for better performance?
- [Affects R7][Technical] The GraphQL extension pattern from `apps/cms/src/graphql/recommendations.ts` should be followed. Verify the exact resolver registration pattern for the `semanticSearch` query.
- [Affects R10][Technical] The recommendation API fetches `embedding_text` for inter-result cosine similarity dedup. This adds data transfer overhead. Evaluate whether core_id + title dedup alone is sufficient for search, or if embedding-level dedup is needed.

## Next Steps

-> `/ce:plan` for structured implementation planning
