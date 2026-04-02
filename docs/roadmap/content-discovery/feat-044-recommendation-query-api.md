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
     sceneIndex?: number, // specific scene, or aggregate across all scenes
     limit?: number, // default 10
   ): Promise<SceneRecommendation[]>
   ```

2. **Query logic**:

   ```sql
   -- For a specific scene
   SELECT se.video_id, se.scene_index, se.description, se.start_seconds, se.end_seconds,
          1 - (se.embedding <=> $1) AS similarity
   FROM scene_embeddings se
   WHERE se.video_id != $2
     AND se.language = 'en'
   ORDER BY se.embedding <=> $1
   LIMIT $3;
   ```

   For whole-video recommendations: average similarity across all scenes of the input video, or take top scene match per candidate video.

3. **Custom API route**: `GET /api/scene-embeddings/recommendations?videoId=X&sceneIndex=Y&limit=10`

4. **GraphQL integration** (if applicable): expose as custom query resolver

## Constraints

- Filter `video_id != input` to never recommend the same video
- English only for Phase 1 (`language = 'en'`)
- Response must include enough metadata (videoId, timestamps, description) for the frontend to render

## Verification

- Query with a known video → returns different videos with >0.5 similarity
- Never returns the input video in results
- Response time <500ms for top-10 query
- Results are plausibly similar (manual spot-check)
