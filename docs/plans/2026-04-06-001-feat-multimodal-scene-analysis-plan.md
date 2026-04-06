---
title: "feat: Multimodal Scene Analysis via Gemini 2.5 Flash"
type: feat
status: completed
date: 2026-04-06
origin: docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md
---

# feat: Multimodal Scene Analysis via Gemini 2.5 Flash

## Overview

Add a scene analysis service that sends actual video segments + transcript chunks to Gemini 2.5 Flash to extract structured signals (themes/felt needs, bible verses, demographics, emotional tone, narrative content) for each scene in a video. This is the core intelligence layer that drives recommendation quality — felt needs/themes are the primary signal for ministry content.

## Problem Frame

The existing enrichment pipeline produces chapters and transcripts but has no understanding of _what's shown_ in the video. Two completely different scenes about forgiveness should recommend each other, but transcript-only embeddings can't capture visual narrative, emotional tone, or thematic meaning that comes from seeing the actual video. (see origin: `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md`)

**Data audit findings (feat-038):** 955 processable videos, ~3,549 estimated scenes, revised cost ~$10-$15 for Phase 1. Dedup model confirmed. Zero existing chapter coverage — all scenes need fresh generation.

## Requirements Trace

- R2. Scene analysis: feed actual video segments + transcript + CMS metadata to multimodal LLM for structured signal extraction
- R2 signals: felt needs/themes (primary), bible verses, content summary, emotional tone, demographics (where extractable)
- R7. Use existing chapter metadata where available (none currently exist, but the interface should support it)
- Origin: "actual video segments, not still frames" — send moving video to Gemini, not keyframes

## Scope Boundaries

- **In scope:** Gemini client, video segment access, scene analysis service, workflow integration, artifact storage
- **Out of scope:** Embedding generation (feat-041), backfill worker (feat-042), recommendation query API (feat-044), visual shot detection fusion (feat-043)
- **Not building:** Cost tracking infrastructure or auto-pause — that's feat-042's concern. This service logs token usage per call for downstream cost aggregation.

## Context & Research

### Relevant Code and Patterns

- `apps/manager/src/services/chapters.ts` — canonical LLM service pattern: OpenAI SDK → Zod schema → `parseLLMJson` → `writeArtifact`
- `apps/manager/src/services/openrouter.ts` — shared client, `DEFAULT_MODEL = "google/gemini-2.5-flash"`
- `apps/manager/src/services/sceneBoundaries.ts` — feat-039 output, provides `SceneBoundary` as input
- `apps/manager/src/services/mux.ts` — Mux SDK with signed playback, `getThumbnailUrl` helper
- `apps/manager/src/lib/parseLLMJson.ts` — no markdown fence stripping (Gemini often wraps JSON in fences)
- `apps/manager/src/config/env.ts` — t3-oss env validation with `skipValidation` for CI

### Institutional Learnings

- **Lazy SDK initialization mandatory** — never instantiate at module scope (from `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`)
- **SSRF protection for URL-fetching utilities** — HTTPS only, domain allowlist, `AbortSignal.timeout()` (from blurhash generation pattern)
- **`parseLLMJson` doesn't strip markdown fences** — Gemini models frequently wrap JSON in triple backticks. Must handle this.
- **Structured JSON logging at step boundaries** — log before/after every external call

## Key Technical Decisions

- **Google AI SDK (`@google/genai`) instead of OpenRouter**: OpenRouter's openai-compatible API supports `image_url` content parts but does not support native video input. Gemini 2.5 Flash's native video API accepts video files/URLs directly at ~260 tokens/second. This requires adding the Google AI SDK as a new dependency and a `GOOGLE_AI_API_KEY` env var. The existing OpenRouter client remains unchanged for all text-only services.

- **Video input via Mux signed MP4 URL**: Mux provides static MP4 renditions via `https://stream.mux.com/{playbackId}/{quality}.mp4`. Since assets use `playback_policy: ["signed"]`, URLs need JWT signing via `@mux/mux-node`. For scene segments, we pass the full video URL to Gemini with start/end timestamp context in the prompt — Gemini handles seeking internally. No need to download or trim video.

- **Markdown fence stripping in parseLLMJson**: Enhance the shared utility to strip ` ```json ... ``` ` wrappers before `JSON.parse`. This benefits all LLM services, not just scene analysis. Gemini is the most common offender.

- **Themes appear first in description**: The concatenated `description` field places themes/felt needs first, then bible verses, then content, then tone, then demographics. This weights themes higher in the downstream text embedding (feat-041).

- **Per-scene analysis, not batch**: Each scene is analyzed in a separate Gemini call. At ~3,549 scenes and <$15 total cost, there's no economic pressure to batch. Individual calls are simpler, more debuggable, and naturally resumable.

## Open Questions

### Resolved During Planning

- **OpenRouter vs Google AI SDK?** → Google AI SDK required. OpenRouter doesn't support video content parts for Gemini. Confirmed by reviewing the openai SDK message content type which only allows `text` and `image_url` parts.
- **How to pass video to Gemini?** → Mux signed MP4 URL. Gemini accepts URLs directly via `fileData` content parts. No download needed.
- **Should we trim video segments before sending?** → No. Pass the full video URL and specify the scene time range in the prompt. Gemini charges for the full video duration regardless of prompt framing, but at $10-15 total cost this is negligible. Trimming adds FFmpeg complexity for no meaningful savings.

### Deferred to Implementation

- **Exact Mux JWT signing parameters**: The `@mux/mux-node` SDK has `jwt.signPlaybackId()` but exact options (expiry, audience for MP4 vs stream) need to be confirmed against current SDK version.
- **Gemini rate limits**: Google AI free tier has aggressive rate limits. Production API key limits need verification. May need retry logic with backoff.
- **MP4 rendition quality selection**: Mux offers `low.mp4`, `medium.mp4`, `high.mp4`. Lower quality = faster upload to Gemini, lower video token count. Need to test which is sufficient for scene analysis.

## Implementation Units

- [x] **Unit 1: Enhance parseLLMJson with markdown fence stripping**

  **Goal:** Make LLM JSON parsing robust to Gemini's tendency to wrap responses in markdown code fences.

  **Requirements:** R2 (prerequisite for reliable structured extraction)

  **Dependencies:** None

  **Files:**
  - Modify: `apps/manager/src/lib/parseLLMJson.ts`
  - Test: `apps/manager/src/lib/parseLLMJson.test.ts`

  **Approach:**
  - Before `JSON.parse`, check if content starts with ` ```json ` or ` ``` ` and strip the fences
  - Handle variations: with/without `json` language tag, leading/trailing whitespace
  - This is a pure string preprocessing step before the existing parse → validate flow

  **Patterns to follow:**
  - Existing `parseLLMJson` structure — keep the same signature, just add preprocessing

  **Test scenarios:**
  - Clean JSON → parses normally (no regression)
  - JSON wrapped in ` ```json\n...\n``` ` → stripped and parsed
  - JSON wrapped in ` ```\n...\n``` ` → stripped and parsed
  - Invalid JSON after stripping → falls back as before
  - Valid Zod schema after stripping → returns typed data

  **Verification:**
  - All existing tests (if any) still pass
  - New fence-stripping tests pass
  - No change to function signature

- [x] **Unit 2: Gemini multimodal client**

  **Goal:** Add a Google AI SDK client for multimodal (video + text) LLM calls, parallel to the existing OpenRouter client.

  **Requirements:** R2 (new multimodal LLM client)

  **Dependencies:** Unit 1

  **Files:**
  - Create: `apps/manager/src/services/gemini.ts`
  - Modify: `apps/manager/src/config/env.ts`
  - Test: `apps/manager/src/services/gemini.test.ts`

  **Approach:**
  - Install `@google/genai` SDK
  - Create `getGemini()` lazy singleton following the `getOpenrouter()` / `getMux()` pattern
  - Add `GOOGLE_AI_API_KEY` to env.ts as required string
  - Export a focused `analyzeVideoScene()` function that accepts video URL, transcript chunk, CMS metadata, and returns the raw Gemini text response
  - Use `fileData` content part with the Mux MP4 URL for video input
  - Log token usage (input/output) in structured JSON format per call
  - Timeout: 180s (video analysis takes longer than text-only calls)

  **Patterns to follow:**
  - `apps/manager/src/services/openrouter.ts` — lazy singleton, env-based config
  - Institutional learning: never instantiate SDK at module scope

  **Test scenarios:**
  - Client initialization with valid API key
  - Mock Gemini response → structured JSON extracted
  - Token usage logging verified
  - Timeout behavior

  **Verification:**
  - `getGemini()` returns a client instance
  - `GOOGLE_AI_API_KEY` validated at startup (skipped in CI)
  - Structured log entry emitted per call with token counts

- [x] **Unit 3: Mux signed video URL utility**

  **Goal:** Generate signed MP4 URLs for Mux assets that Gemini can fetch directly.

  **Requirements:** R2 (video segment access)

  **Dependencies:** None (parallel with Unit 2)

  **Files:**
  - Modify: `apps/manager/src/services/mux.ts`
  - Test: `apps/manager/src/services/mux.test.ts`

  **Approach:**
  - Add `getSignedMp4Url(playbackId: string, options?: { quality?: "low" | "medium" | "high" })` function
  - Use `getMux().jwt.signPlaybackId()` with appropriate audience and expiry (1 hour should suffice)
  - Default to `medium.mp4` quality — balance between token cost and analysis quality
  - URL format: `https://stream.mux.com/{signedPlaybackId}/medium.mp4`

  **Patterns to follow:**
  - Existing `getThumbnailUrl()` in same file — URL construction pattern
  - SSRF protection learning: domain is always `stream.mux.com`, no user-supplied URLs

  **Test scenarios:**
  - Signed URL is a valid HTTPS URL to stream.mux.com
  - Quality parameter changes the MP4 path segment
  - Default quality is "medium"

  **Verification:**
  - Function returns a working signed URL (manual test with a real Mux asset)

- [x] **Unit 4: Scene analysis service**

  **Goal:** Create the core service that analyzes a single scene by sending video + transcript to Gemini and extracting structured signals.

  **Requirements:** R2 (all extraction signals), R7 (chapter metadata usage)

  **Dependencies:** Units 1, 2, 3

  **Files:**
  - Create: `apps/manager/src/services/sceneAnalysis.ts`
  - Test: `apps/manager/src/services/sceneAnalysis.test.ts`

  **Approach:**
  - Define `SceneAnalysis` type matching feat-040 spec (themes, bibleVerses, demographics, description, chapterTitle, sceneIndex, startSeconds, endSeconds)
  - Define Zod schema for LLM output validation
  - `analyzeScene()` function:
    1. Get signed MP4 URL via Unit 3
    2. Build Gemini prompt with video, transcript chunk, CMS metadata, and extraction instructions
    3. Call Gemini via Unit 2
    4. Parse response via `parseLLMJson` with Zod schema
    5. Construct `description` field by concatenating: themes first, then verses, then content, then tone, then demographics
    6. Store as `{assetId}/scene-analysis.json` artifact
  - `analyzeAllScenes()` function: process all scenes for a video sequentially (rate limit friendly), return `SceneAnalysis[]`
  - Prompt engineering: instruct Gemini to watch the video segment, cross-reference with the transcript, and extract each signal. Emphasize felt needs/themes as the primary output. Include CMS bible verses as reference context.

  **Patterns to follow:**
  - `apps/manager/src/services/chapters.ts` — LLM call → Zod validate → write artifact → return
  - `apps/manager/src/services/sceneBoundaries.ts` — consuming SceneBoundary type

  **Test scenarios:**
  - Mock Gemini response with all fields → correctly typed SceneAnalysis
  - Mock Gemini response with empty demographics → demographics array is empty, not null
  - Description field concatenation: themes appear first
  - Fallback on Gemini parse failure → empty/default analysis (not crash)
  - Multiple scenes → stored as single artifact array

  **Verification:**
  - 20 sample scenes produce meaningful theme extraction (manual review)
  - Bible verses are relevant, not hallucinated generic references
  - Description field structure: themes → verses → content → tone → demographics
  - Artifact stored at correct S3 key

- [x] **Unit 5: Workflow integration**

  **Goal:** Wire scene analysis into the enrichment workflow as a step that runs after scene boundaries.

  **Requirements:** R2, R6 (pipeline integration for new uploads)

  **Dependencies:** Unit 4

  **Files:**
  - Modify: `apps/manager/src/workflows/videoEnrichment.ts`
  - Modify: `apps/manager/src/types/job.ts`
  - Modify: `apps/manager/src/lib/workflow-steps.ts`
  - Modify: `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  - Modify: `apps/manager/src/features/coverage/coverage-report-client.tsx`

  **Approach:**
  - Add `"scene_analysis"` to `WorkflowStepName` union
  - Add to `FORGE_STEPS` array after `"scene_boundaries"`
  - Add `stepSceneAnalysis()` wrapper with `"use step"` directive
  - Runs after scene boundaries complete, receives: assetId, muxAssetId, scene boundaries result, transcript, video metadata
  - Add UI entries: artifact key `"scene-analysis"`, description, icon mapping
  - Scene analysis needs `muxAssetId` and `playbackId` — these are available from the workflow input and Mux service

  **Patterns to follow:**
  - Existing `stepChapters` / `stepSceneBoundaries` pattern in workflow file
  - Feat-039 integration pattern for all the UI touchpoints

  **Test scenarios:**
  - Workflow runs scene analysis after scene boundaries complete
  - Scene analysis step failure is caught and marked via `runParallelStep`
  - Job steps table shows the new step with correct description

  **Verification:**
  - Full workflow run with a test video completes all steps including scene analysis
  - Job detail page shows scene analysis step with status and artifact link

## System-Wide Impact

- **Interaction graph:** New Gemini API call from manager → Google AI. New dependency on `@google/genai` SDK. No CMS changes. No web/mobile changes.
- **Error propagation:** Scene analysis failure should not block the rest of the enrichment pipeline. The workflow step catches errors and marks the step as failed, allowing other steps to complete.
- **State lifecycle risks:** Scene analysis artifacts are append-only (write once per video). Re-running overwrites the artifact (idempotent via `writeArtifact`).
- **API surface parity:** No external API changes. The scene analysis is internal to the enrichment pipeline.
- **Integration coverage:** End-to-end test with a real Mux video through the workflow is the critical integration point. Mock Gemini responses for unit tests.

## Risks & Dependencies

- **Google AI API key provisioning**: Need a Google AI API key with Gemini 2.5 Flash access. This is a new external dependency not currently in Doppler.
- **Mux signed URL expiry**: If Gemini takes >1 hour to process a video (unlikely at <2min avg scene length), the signed URL expires. Mitigate with generous expiry (2 hours).
- **Gemini rate limits**: Free tier is very restrictive. Production tier limits need verification. Sequential per-scene calls naturally rate-limit, but may need explicit backoff.
- **Video token costs**: The data audit showed costs are ~$10-15 total, well within budget. But if scene count estimates are wrong, the auto-pause mechanism (feat-042) provides a safety net.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md](../brainstorms/2026-04-02-video-content-vectorization-requirements.md)
- **Roadmap ticket:** [docs/roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md](../roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md)
- **Data audit results:** feat-038 (complete) — 955 processable videos, ~3,549 scenes, ~$10-15 Phase 1 cost
- **Scene boundaries:** feat-039 (in-progress) — `SceneBoundary` type and service
- Related learnings: `docs/solutions/platform/videoforge-manager-integration.md`, `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`
