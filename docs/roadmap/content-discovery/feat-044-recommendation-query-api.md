---
id: "feat-044"
title: "Video Vectorization — Recommendation Query API"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-05-28"
duration: 7
depends_on:
  - "feat-041"
  - "feat-042"
blocks:
  - "feat-046"
tags:
  - "cms"
  - "pgvector"
  - "graphql"
---

## Problem

With scene embeddings indexed, we need a queryable API that returns similar scenes from different videos. This is the core recommendation capability that the demo frontend (feat-046) and future recommendation UI will consume.

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/indexer.ts` — scene embedding storage (feat-041)
2. `apps/cms/src/api/core-sync/services/` — raw SQL patterns in Strapi services
3. `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md` — recommendation query in Storage Schema section

## Grep These

- `strapi.db.connection.raw` in `apps/cms/src/` — raw SQL execution
- `scene_embeddings` in `apps/cms/src/` — table references
- `register` in `apps/cms/src/api/` — custom route/controller registration pattern

## What To Build

1. **Recommendation service**: `apps/cms/src/api/scene-embedding/services/recommender.ts`

   ```typescript
   type SceneRecommendation = {
     videoId: number
     sceneIndex: number
     description: string
     startSeconds: number
     endSeconds: number | null
     similarity: number // 0-1
   }

   export async function getRecommendations(
     videoId: number,
     locale: string, // user's locale — filters results to videos available in this language
     sceneIndex?: number, // specific scene, or aggregate across all scenes
     limit?: number, // default 10
     rerank?: string, // no-op in Phase 1, reserved for future user-driven scoring
   ): Promise<SceneRecommendation[]>
   ```

2. **Query logic**:

   ```sql
   -- For a specific scene, locale-aware
   -- $3 = user's locale (en, es, fr). Only return videos that have a variant in user's language.
   SELECT se.video_id, se.scene_index, se.description, se.start_seconds, se.end_seconds,
          1 - (se.embedding <=> $1) AS similarity
   FROM scene_embeddings se
   JOIN video_variants vv ON vv.video_id = se.video_id
   JOIN languages l ON vv.language_id = l.id
   WHERE se.video_id != $2
     AND l.bcp47 = $3              -- locale-aware: only videos available in user's language
     AND se.language IN ('en', 'es', 'fr')  -- Phase 1 languages
   ORDER BY se.embedding <=> $1
   LIMIT $4;
   ```

   For whole-video recommendations: average similarity across all scenes of the input video, or take top scene match per candidate video.

3. **Custom API route**: `GET /api/scene-embeddings/recommendations?videoId=X&locale=en&sceneIndex=Y&limit=10&rerank=`

4. **GraphQL integration** (if applicable): expose as custom query resolver

## Constraints

- Filter `video_id != input` to never recommend the same video
- **Locale-aware**: `locale` parameter is required. Only return videos with a variant in the requested language.
- Phase 1 languages: en, es, fr
- **No human tags for similarity** — all semantic signal is from LLM scene descriptions
- **Pure vector similarity scoring** — `rerank` parameter accepted but is a no-op in Phase 1. Designed to accept user-driven scoring signals in Phase 2.
- Response must include enough metadata (videoId, timestamps, description) for the frontend to render

## Verification

- Query with a known video + locale=en → returns different videos with >0.5 similarity, all with English variants
- Query same video + locale=es → results are all videos with Spanish variants (different result set)
- **No locale bleed**: query with locale=es never returns a video that only exists in English
- Never returns the input video in results
- Response time <500ms for top-10 query
- Results are plausibly similar (manual spot-check)
