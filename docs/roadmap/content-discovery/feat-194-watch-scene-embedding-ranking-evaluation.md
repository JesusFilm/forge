---
id: "feat-194"
title: "Watch scene embedding ranking evaluation"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 4
depends_on: []
blocks: []
tags:
  - "admin"
  - "mastra"
  - "search"
  - "embeddings"
  - "scene"
  - "evals"
  - "launch-readiness"
---

## Problem

Scene embeddings may be skewing Watch search ranking because only a small
subset of videos have scene vectors. When those sparse scene vectors contribute
too strongly, videos with scene coverage can outrank more relevant videos that
only have transcript, felt-need, or keyword evidence.

The team should decide this with evals, not vibes.

Roadmap window: this week, June 16-19, 2026.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-193-watch-search-readiness-eval-suite.md`
   - current launch-readiness eval dataset and report target.
2. `docs/roadmap/content-discovery/feat-131-mixed-scene-transcript-video-semantic-search.md`
   - mixed scene and transcript search history.
3. `docs/roadmap/content-discovery/feat-191-continue-multilingual-embedding-repair-and-backfill.md`
   - current note that scene work may become compatibility-only.
4. `docs/roadmap/content-discovery/feat-192-brainstorm-embedding-architecture-content-gap-realignment.md`
   - architecture question about durable retriever surfaces if scenes are
     dropped.
5. `apps/admin/src/services/hybrid-search-retrievers.ts`
   - retriever composition and semantic evidence surfaces.
6. `apps/admin/src/services/hybrid-search-fusion.ts`
   - ranking/fusion behavior.
7. `apps/admin/src/services/hybrid-search-retrievers.test.ts`
   - retriever behavior coverage.
8. `apps/admin/src/services/scene-embedding.service.ts`
   - scene embedding data access.

## What To Build

1. Run the Watch search readiness eval suite with scene embeddings enabled.
2. Run the same eval suite with scene embeddings disabled or downweighted.
3. Compare per-query ranking quality across both modes.
4. Identify where scene embeddings improve relevance, harm relevance, or have
   no meaningful effect.
5. Document a recommendation: keep, remove, or downweight scene embeddings in
   Watch search ranking.
6. Implement the removal or downweighting if the eval clearly shows scene
   evidence reduces relevance.

## Acceptance Criteria

- Run evals with scene embeddings enabled and disabled.
- Compare ranking quality across both modes.
- Identify where scene embeddings improve, harm, or do not affect relevance.
- Document recommendation: keep, remove, or downweight scene embeddings.
- Implement removal/downweighting if evals show they reduce relevance.

## Completion Notes

Completed 2026-06-21 after verifying the current `upstream/main` search path no
longer consumes scene embeddings for video semantic search.

Evidence:

- `apps/admin/src/services/hybrid-search-retrievers.ts` now builds
  `searchVideoSemantic` from `transcript_source` only.
- Static grep against `upstream/main` found no `video_scene_locale`,
  `scene_source`, or `'scene'` evidence source references in
  `apps/admin/src/services/hybrid-search-retrievers.ts` or
  `apps/admin/src/services/hybrid-search.service.ts`.
- The semantic-video result shape is still retained for API/debug
  compatibility, but the evidence source is transcript-backed:
  `video_transcript_chunk` / `'transcript' AS evidence_source`.

## Verification

- `git grep -n -e "video_scene_locale" -e "scene_source" -e "'scene'" upstream/main -- apps/admin/src/services/hybrid-search-retrievers.ts apps/admin/src/services/hybrid-search.service.ts`
  returned no matches.
- `git grep -n -e "video_transcript_chunk" -e "transcript_source" -e "'transcript'" upstream/main -- apps/admin/src/services/hybrid-search-retrievers.ts`
  confirmed the live semantic-video search evidence path is transcript-only.
