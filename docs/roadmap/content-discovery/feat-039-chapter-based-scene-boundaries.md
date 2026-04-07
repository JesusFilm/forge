---
id: "feat-039"
title: "Video Vectorization — Chapter-Based Scene Boundaries"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-04-24"
duration: 7
depends_on:
  - "feat-038"
blocks:
  - "feat-040"
  - "feat-043"
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

The existing `chapters.ts` service produces transcript-based scene segmentation (title, startSeconds, endSeconds, summary). This output needs to be formalized as "scene boundaries" that downstream steps (description, embedding) consume. For short clips that are a single chapter, the chapter IS the scene.

## Entry Points — Read These First

1. `apps/manager/src/services/chapters.ts` — `Chapter { title, startSeconds, endSeconds, summary }` type and generation logic
2. `apps/manager/src/services/storage.ts` — artifact storage/retrieval pattern
3. `apps/manager/src/workflows/videoEnrichment.ts` — where chapters step runs

## Grep These

- `Chapter` in `apps/manager/src/services/chapters.ts` — existing type definition
- `chapters` in `apps/manager/src/workflows/` — how chapters are invoked

## What To Build

New service: `apps/manager/src/services/sceneBoundaries.ts`

```typescript
type SceneBoundary = {
  sceneIndex: number
  startSeconds: number
  endSeconds: number | null
  chapterTitle: string | null
  transcriptChunk: string
}

export async function extractSceneBoundaries(
  assetId: string,
  chapters: Chapter[],
  transcript: string,
): Promise<SceneBoundary[]>
```

- Map each chapter to a SceneBoundary with its corresponding transcript chunk
- Single-chapter videos → one scene
- Store as `{assetId}/scene-boundaries.json` artifact

## Constraints

- Do not modify `chapters.ts` — consume its output, don't change it
- Keep the SceneBoundary type simple — visual fusion (feat-043) will extend it later

## Verification

- Process 10 English videos with existing chapters → scene boundaries match chapter structure
- Short clips produce 1-3 scenes, feature films produce 20-100+
- Artifact stored successfully in S3
