---
title: "Multimodal scene analysis pipeline: OpenRouter stills, SSRF validation, and pipeline decoupling"
last_updated: 2026-04-06
problem_type: best_practice
component: service_object
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: high
module: apps/manager
tags:
  - ai-pipeline
  - gemini
  - video
  - security
  - manager
  - mux
related_features:
  - feat-038
  - feat-039
  - feat-040
  - feat-009
  - feat-041
related:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
  - "docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md"
date_learned: 2026-04-06
---

## Problem

Building a multimodal scene analysis pipeline that sends still frames + transcript to Gemini 2.5 Flash (via OpenRouter) for structured signal extraction (themes, bible verses, demographics). Key problems emerged during implementation and two rounds of code review.

**Architecture evolution:** Started with native video via Google AI SDK, pivoted to thumbnail stills via OpenRouter after discovering: (1) Gemini Files API constraints made video upload complex, (2) existing Mux assets have public playback (no signing keys needed for thumbnails), (3) zero new API keys required with stills approach.

## Symptoms

- SSRF subdomain bypass allowing `evil-jesusfilm.org` through hostname validation
- Optional scene analysis crashing the entire enrichment workflow on failure
- Initial approach (native video) required new SDK, new API keys, and Mux JWT signing — unnecessary complexity for Phase 1

## What Didn't Work

- **Native video via Google AI SDK** — required `@google/genai` SDK, `GOOGLE_AI_API_KEY`, and Mux signing keys (`MUX_SIGNING_KEY`/`MUX_PRIVATE_KEY`). The `fileData.fileUri` only accepts Google-hosted URIs. The `files.upload({ file: string })` treats strings as filesystem paths. Stills via OpenRouter avoid all of this.
- **`hostname.endsWith('jesusfilm.org')`** — matches `evil-jesusfilm.org` because there's no dot boundary
- **Coupling scene analysis as enrichment workflow steps** — 974 videos already had subtitles from Core API sync, making Mux transcription unnecessary. The tight coupling prevented running scene analysis independently

## Solution

### 1. Thumbnail Stills via OpenRouter (Not Native Video)

Use the existing OpenRouter client with `image_url` content parts — no new SDK or API keys needed. Mux thumbnails are publicly accessible for Core API-synced assets.

```typescript
// Extract 3 frames: start, middle, end of scene
const thumbnailUrls = getSceneThumbnailUrls(
  playbackId,
  startSeconds,
  endSeconds,
)

const response = await getOpenrouter().chat.completions.create({
  model: DEFAULT_MODEL, // google/gemini-2.5-flash via OpenRouter
  messages: [
    { role: "system", content: SCENE_ANALYSIS_PROMPT },
    {
      role: "user",
      content: [
        ...thumbnailUrls.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
        { type: "text", text: transcriptChunk },
      ],
    },
  ],
})
```

**Why not native video?** Gemini's Files API requires: (1) Google AI SDK (`@google/genai`), (2) new `GOOGLE_AI_API_KEY`, (3) Mux JWT signing keys for signed MP4 URLs, (4) download-to-Blob-then-upload workflow. Stills avoid all of this and are sufficient for dialogue-heavy ministry content where themes come primarily from the transcript.

### 2. SSRF: Exact Domain Match With Dot Prefix

```typescript
// WRONG — matches evil-jesusfilm.org
url.hostname.endsWith("jesusfilm.org")

// CORRECT — requires exact match or .jesusfilm.org subdomain
url.hostname === "jesusfilm.org" || url.hostname.endsWith(".jesusfilm.org")
```

### 3. Decouple Into Standalone Pipeline, Bolt On Optionally

```
// Two paths to scene analysis:
// 1. Standalone: POST /api/scene-analysis (fetches existing VTT subtitles)
// 2. Bolt-on: enrichment with runSceneAnalysis: true (uses Mux transcript)
```

Before designing a new extraction pipeline, query production for existing data:

```sql
SELECT COUNT(*) FROM video_subtitles
WHERE published_at IS NOT NULL AND vtt_src IS NOT NULL AND vtt_src != '';
-- Result: 974 videos already had human-produced subtitles
```

### 4. Error-Isolate Optional Features

```typescript
if (input.runSceneAnalysis) {
  try {
    await analyzeScenes(input)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "scene_analysis_failed_in_enrichment",
        error: error instanceof Error ? error.message : "Unknown",
      }),
    )
    // Enrichment continues — core steps already succeeded
  }
}
```

### 5. Falsy Zero Bug in URL Parameters

```typescript
// WRONG — drops time=0 because 0 is falsy
if (options?.time) params.set("time", String(options.time))

// CORRECT — only skips undefined/null
if (options?.time != null) params.set("time", String(options.time))
```

This applies to any optional numeric URL parameter: timestamps, offsets, indices, page numbers.

### 6. Throw on Empty SDK Values, Don't Propagate Empty Strings

```typescript
// WRONG — empty string propagates into malformed URLs
const playbackId = asset.playback_ids?.[0]?.id ?? ""

// CORRECT — fail fast when a required value is missing
const playbackId = asset.playback_ids?.[0]?.id
if (!playbackId) throw new Error(`Mux asset ${assetId} has no playback ID`)
```

Empty strings pass truthiness checks, string interpolation, and URL construction — they fail only at runtime when the HTTP request returns 404.

## Why This Works

- **Stills + transcript**: For dialogue-heavy ministry content, themes (forgiveness, hope, grief) come primarily from what's said, not what's shown. Three representative frames add visual context without the complexity of native video upload.
- **Existing clients**: OpenRouter already routes to Gemini 2.5 Flash with `image_url` support. No new SDK, no new API keys.
- **Dot-prefix domain check**: DNS subdomain boundaries are marked by dots. `evil-jesusfilm.org` does not end with `.jesusfilm.org`.
- **Standalone-first, bolt-on-second**: Scene analysis has one real dependency (video + transcript). Existing subtitles satisfy the transcript requirement without Mux transcription.
- **Error boundaries**: Optional features in existing workflows need isolation so their failures don't cascade.
- **Null-check over truthiness**: `!= null` catches undefined and null without dropping legitimate zero values.

## Prevention

1. **Always audit production data before designing pipelines.** Run `SELECT COUNT(*)` before assuming you need to build data extraction. The 974 existing subtitles saved the entire Mux transcription step.

2. **Prefer existing clients over new SDKs.** OpenRouter's `image_url` content parts handle stills through the existing client. Adding a new SDK (Google AI) for native video introduced 3 new env vars, signing keys, and Gemini Files API complexity. Stills via the existing client required zero new dependencies.

3. **Gemini Files API rules (for future native video upgrade):**
   - `fileData.fileUri` = Google-hosted URIs only (Files API or `gs://`)
   - `files.upload({ file: string })` = local filesystem path, not URL
   - `files.upload({ file: Blob })` = binary upload (correct for downloaded content)
   - Always delete uploaded files in a `finally` block (20GB quota)

4. **SSRF domain allowlist pattern** (see also: `docs/solutions/cms/strapi-v5-blurhash-generation-multi-path-pattern.md` prevention checklist):
   - Use `hostname === 'example.com' || hostname.endsWith('.example.com')`
   - Never use bare `endsWith('example.com')`
   - Test with adversarial hostnames: `evil-example.com`, `example.com.attacker.com`

5. **Optional features in existing workflows:**
   - Wrap in their own try/catch — never share the host workflow's error boundary
   - Log failures with structured JSON including the feature name
   - The host workflow's success/failure status reflects only essential steps

6. **Falsy zero in optional numeric params:**
   - Never use `if (value)` for optional numbers — 0 is falsy
   - Use `if (value != null)` to skip only undefined/null
   - This applies to URL params, pagination offsets, timestamps, array indices

7. **Throw on empty SDK return values, don't propagate empty strings:**
   - `?? ""` is for display text, not URL construction or API keys
   - Throw explicitly when a downstream operation requires a non-empty value

8. **Name types by domain meaning, not provider:**
   - `RawSceneSignals` not `GeminiOutput` — survives provider changes
   - Provider names belong in client/adapter modules, not domain types

9. **Test security boundaries with adversarial inputs:**
   - SSRF allowlists need explicit tests for bypass attempts
   - Test: subdomain spoofing (`evil-example.com`), protocol downgrade (`http://`), IP literals

## Cross-References

- `docs/solutions/platform/videoforge-manager-integration.md` — original manager app architecture (shared SDK client pattern, VTT parsing, `after()` pattern)
- `docs/solutions/cms/strapi-v5-blurhash-generation-multi-path-pattern.md` — SSRF prevention checklist for URL-fetching utilities
- `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` — lazy SDK initialization pattern
- `docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md` — sequencing scene embedding enrichment separately from transcript embedding sync and keeping vector stores scoped by retrieval grain
- `docs/roadmap/content-discovery/feat-038-video-vectorization-data-audit.md` — data audit results
- `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md` — full requirements
