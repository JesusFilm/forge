---
id: "feat-040"
title: "Video Vectorization — Multimodal Scene Analysis"
owner: "nisal"
priority: "P1"
status: "in-progress"
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

Each scene needs structured signal extraction that drives recommendation quality. For ministry content, **felt needs/themes** are the most important signal — two completely different scenes addressing forgiveness should recommend each other. This requires a new multimodal LLM client that can process actual video segments (not still frames) alongside transcript text and CMS metadata. The existing OpenRouter client is text-only and cannot handle video input.

**Approach**: Following the direction Netflix and YouTube have moved — process actual video (motion, pacing, transitions) rather than keyframes. Gemini 2.5 Flash accepts video input natively and extracts richer signals from moving content than stills alone.

## Entry Points — Read These First

1. `apps/manager/src/lib/openrouter.ts` — existing AI client (text-only)
2. `apps/manager/src/services/chapters.ts` — example of LLM prompting pattern
3. `apps/manager/src/services/sceneBoundaries.ts` — scene boundary input (from feat-039)
4. `apps/cms/src/api/mux-video/content-types/mux-video/schema.json` — `assetId` and `playbackId` for Mux video access

## Grep These

- `getOpenrouter` in `apps/manager/src/` — existing AI client usage
- `muxAssetId` in `apps/manager/src/` — Mux asset references for video access
- `playbackId` in `apps/manager/src/` — Mux playback ID references

## What To Build

1. **Multimodal LLM client** — new client that supports sending video + text to Gemini 2.5 Flash. Must handle video input (not images). Evaluate: pass Mux stream URL directly vs download segment and upload.

2. **Video segment access utility**:

   ```typescript
   // Get a video segment from Mux for Gemini input
   export async function getVideoSegment(
     muxAssetId: string,
     playbackId: string,
     startSeconds: number,
     endSeconds: number | null,
   ): Promise<VideoInput> // format TBD: URL, Buffer, or file path
   ```

   Research during planning: Mux clip API, signed URL with range params, or download-and-trim.

3. **Scene analysis service**: `apps/manager/src/services/sceneAnalysis.ts`

   ```typescript
   type SceneAnalysis = {
     sceneIndex: number
     startSeconds: number
     endSeconds: number | null
     description: string // concatenated extraction — this is what gets embedded
     themes: string[] // felt needs: ["forgiveness", "redemption", "grief", "hope"]
     bibleVerses: string[] // ["Matthew 6:14-15", "Ephesians 4:32"]
     demographics: string[] // ["youth", "student"] — empty if not extractable
     chapterTitle: string | null
   }

   export async function analyzeScene(
     muxAssetId: string,
     playbackId: string,
     boundary: SceneBoundary,
     transcript: string,
     metadata: { bibleVerses?: string[]; videoLabel: string },
   ): Promise<SceneAnalysis>
   ```

   **Inputs to LLM**:
   - Actual video segment (moving video, not stills)
   - Transcript text for the scene
   - CMS metadata (existing bible verse references, video label/type)

   **LLM extracts** (ordered by importance for the embedding):
   1. **Felt needs/themes** (MOST IMPORTANT): forgiveness, hope, grief, loneliness, identity, redemption, belonging, purpose, healing, doubt, courage, fear, etc.
   2. **Bible verses**: from CMS metadata where available + LLM-identified additional references
   3. **Content**: narrative summary, dialogue, message being communicated
   4. **Emotional tone**: contemplative, joyful, grieving, urgent, peaceful, hopeful, sorrowful
   5. **Demographics** (where extractable): age group (children, youth, young adult, adult, elderly), life stage (student, parent, married, widowed, incarcerated), cultural context

   **Embedding construction**: `description` concatenates all signals into a single text block, with themes/needs appearing first to weight them in the embedding. Example:

   ```
   Themes: forgiveness, guilt, reconciliation.
   Bible verses: Matthew 6:14-15, Ephesians 4:32.
   Content: A father confronts his estranged son after years apart. The son asks for forgiveness...
   Tone: sorrowful, hopeful.
   Demographics: adult, parent.
   ```

   - Store as `{assetId}/scene-analysis.json` artifact

## Constraints

- **Video segments, not stills** — send actual moving video to Gemini, not extracted keyframes
- Confirm Mux video segment access method during planning (clip API, signed URLs, or download)
- Rate limit LLM calls — respect Gemini provider limits
- Log token usage per call for cost tracking (video tokens are ~260/second)
- Demographics are optional — extract only when evident, leave empty otherwise

## Verification

- Sample 20 scenes: extraction captures felt needs/themes, not just transcript paraphrasing
- Themes/needs are meaningful ministry categories (not generic like "good" or "interesting")
- Bible verses are relevant to the scene's actual themes (spot-check 20 scenes)
- Two visually different scenes about the same felt need (e.g., forgiveness) produce similar embeddings
- Demographics extracted where clearly applicable (youth scene → "youth"), empty where ambiguous
- Token usage logged accurately — video token counts match expected ~260 tokens/second
