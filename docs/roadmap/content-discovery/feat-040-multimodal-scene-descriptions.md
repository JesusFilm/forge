---
id: "feat-040"
title: "Video Vectorization — Multimodal Scene Descriptions"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-05-01"
duration: 10
depends_on:
  - "feat-039"
blocks:
  - "feat-041"
  - "feat-042"
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

Each scene needs a rich description capturing visual setting, objects, actions, emotional tone, and mood. This requires a new multimodal LLM client (existing OpenRouter client is text-only) that can send video frames alongside transcript text.

## Entry Points — Read These First

1. `apps/manager/src/lib/openrouter.ts` — existing AI client (text-only)
2. `apps/manager/src/services/chapters.ts` — example of LLM prompting pattern
3. `apps/manager/src/services/sceneBoundaries.ts` — scene boundary input (from feat-039)
4. `apps/cms/src/api/mux-video/content-types/mux-video/schema.json` — `playbackId` for Mux thumbnail URLs

## Grep These

- `getOpenrouter` in `apps/manager/src/` — existing AI client usage
- `playbackId` in `apps/manager/src/` — Mux playback ID references

## What To Build

1. **Multimodal LLM client** — extend or add a client that supports sending images + text. Gemini 2.5 Flash recommended for cost/quality.

2. **Frame extraction utility**:

   ```typescript
   export async function extractFrames(
     playbackId: string,
     timestamps: number[],
   ): Promise<Buffer[]>
   ```

   Uses Mux thumbnail API: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.jpg?time={SECONDS}`

3. **Scene description service**: `apps/manager/src/services/sceneDescription.ts`

   ```typescript
   type SceneDescription = {
     sceneIndex: number
     startSeconds: number
     endSeconds: number | null
     description: string
     chapterTitle: string | null
     frameCount: number
   }

   export async function describeScene(
     playbackId: string,
     boundary: SceneBoundary,
   ): Promise<SceneDescription>
   ```

   - Extract 3 frames (start, mid, end of scene)
   - Send frames + transcript chunk to multimodal LLM
   - Prompt for: visual setting, objects, actions, characters, emotional tone, mood
   - Store as `{assetId}/scene-descriptions.json` artifact

## Constraints

- Confirm Mux thumbnail API works for arbitrary timestamps and returns sufficient resolution
- Rate limit LLM calls — respect provider limits
- Log token usage per call for cost tracking

## Verification

- Sample 20 scenes: descriptions capture visual content, not just transcript paraphrasing
- Mux thumbnail extraction works for timestamps throughout a video
- Token usage logged accurately
