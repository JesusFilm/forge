---
id: "feat-045"
title: "Video Vectorization — Pipeline Integration"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-06-04"
duration: 7
depends_on:
  - "feat-041"
  - "feat-042"
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

After backfill, new English video uploads need to be automatically scene-vectorized as part of the enrichment workflow. Unlike existing parallel steps that consume transcript text, scene vectorization needs video frame access — it's an independent branch.

## Entry Points — Read These First

1. `apps/manager/src/workflows/videoEnrichment.ts` — existing enrichment workflow with parallel steps
2. `apps/manager/src/services/sceneBoundaries.ts` — scene boundary extraction
3. `apps/manager/src/services/sceneDescription.ts` — scene description generation
4. `apps/cms/src/api/scene-embedding/services/indexer.ts` — embedding indexer

## Grep These

- `"use step"` in `apps/manager/src/workflows/` — workflow step pattern
- `transcribe` in `apps/manager/src/workflows/` — step dependency pattern
- `muxAssetId` in `apps/manager/src/workflows/` — where asset IDs are available

## What To Build

Add scene vectorization as a new branch in `videoEnrichment.ts`:

```
transcribe
├── [existing parallel] translate, chapters, metadata, embeddings
└── [new branch] sceneVectorize
    ├── extractSceneBoundaries (needs transcript + chapters output)
    ├── describeScenes (needs playbackId for frames + boundaries)
    ├── embedDescriptions (needs descriptions)
    └── indexSceneEmbeddings (needs embeddings + video metadata)
```

- Runs after both transcription AND chapters complete (needs both)
- Uses `muxAssetId` / `playbackId` from job context for frame extraction
- English-only gate: skip for non-English primary language videos
- Updates enrichment job status with `sceneVectorization` step tracking

## Constraints

- Do not block existing parallel steps — scene vectorization runs independently
- Failure in scene vectorization should not fail the overall enrichment job
- English-only check: skip step if video's primary language is not English

## Verification

- Upload a new English video → enrichment completes → scene embeddings appear in `scene_embeddings`
- Upload a non-English video → scene vectorization step is skipped
- Scene vectorization failure does not block transcript/translation/chapters from completing
- Enrichment job status shows sceneVectorization step status
