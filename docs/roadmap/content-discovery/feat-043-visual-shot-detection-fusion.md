---
id: "feat-043"
title: "Video Vectorization — Visual Shot Detection Fusion"
owner: "nisal"
priority: "P2"
status: "cancelled"
start_date: "2026-06-06"
duration: 10
depends_on:
  - "feat-039"
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

Transcript-based chapter boundaries (feat-039) work well for short clips but may miss visual scene transitions in feature films where a narrative scene contains many camera cuts. Combining visual shot detection with transcript analysis produces more accurate scene boundaries for longer content.

## Entry Points — Read These First

1. `apps/manager/src/services/sceneBoundaries.ts` — existing chapter-based boundaries (feat-039)
2. `apps/manager/src/services/sceneDescription.ts` — consumer of scene boundaries (feat-040)

## Grep These

- `SceneBoundary` in `apps/manager/src/` — type to extend
- `chapters` in `apps/manager/src/services/` — existing segmentation

## What To Build

1. **Research phase** — evaluate scene detection approaches:
   - PySceneDetect (Python, may need microservice or WASM)
   - Mux frame sampling + LLM-based scene change detection
   - FFmpeg scene detection filter (`-vf "select=gt(scene\,0.3)"`)

2. **Visual boundary detector**:

   ```typescript
   export async function detectVisualBoundaries(
     playbackId: string,
     duration: number,
   ): Promise<number[]> // timestamps of visual scene changes
   ```

3. **Fusion logic** — merge visual boundaries with chapter-based boundaries:
   - If visual and chapter boundaries align (within N seconds), keep chapter boundary
   - If visual boundary exists between chapter boundaries, consider splitting
   - Use LLM to decide: "given this transcript segment, does a scene change at timestamp T make narrative sense?"

4. **Update `extractSceneBoundaries`** to optionally use fusion for feature-length videos

## Constraints

- This is P2 — only needed if chapter-based boundaries prove insufficient for feature films
- Do not break existing chapter-based flow; fusion is an optional enhancement
- May require Python tooling (PySceneDetect) — evaluate Node.js alternatives first

## Verification

- Compare scene boundaries with and without fusion for 10 feature films
- Fusion boundaries align better with narrative scene changes (manual review)
- No regression for short clips (still use chapter-based only)
