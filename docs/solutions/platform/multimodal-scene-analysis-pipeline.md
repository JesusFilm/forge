---
title: "Multimodal scene analysis pipeline: Gemini Files API, SSRF validation, and pipeline decoupling"
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
date_learned: 2026-04-06
---

## Problem

Building a multimodal scene analysis pipeline that sends video + transcript to Gemini 2.5 Flash for structured signal extraction (themes, bible verses, demographics). Five distinct problems emerged during implementation and two rounds of code review.

## Symptoms

- Gemini API 400 errors when passing Mux signed URLs in `fileData.fileUri`
- ENOENT errors when passing URL strings to `ai.files.upload({ file: url })`
- SSRF subdomain bypass allowing `evil-jesusfilm.org` through hostname validation
- Optional scene analysis crashing the entire enrichment workflow on failure
- Opaque SDK errors when `GOOGLE_AI_API_KEY` was missing

## What Didn't Work

- **Passing Mux URLs directly to Gemini** — `fileData.fileUri` only accepts Google-hosted URIs (Files API uploads or `gs://` paths), not arbitrary HTTPS URLs
- **Passing URLs as strings to `files.upload()`** — the `@google/genai` SDK treats string arguments as local filesystem paths, calling `fs.stat()` on them
- **`hostname.endsWith('jesusfilm.org')`** — matches `evil-jesusfilm.org` because there's no dot boundary
- **Coupling scene analysis as enrichment workflow steps** — 974 videos already had subtitles from Core API sync, making Mux transcription unnecessary. The tight coupling prevented running scene analysis independently
- **Relying on SDKs to produce useful errors for missing config** — Google AI SDK throws opaque internal errors when initialized with `undefined` API key

## Solution

### 1. Gemini Files API: Download to Blob, Upload, Then Delete

```typescript
// Download video to Blob — SDK treats strings as filesystem paths, not URLs
const response = await fetch(signedMuxUrl, {
  signal: AbortSignal.timeout(120_000),
})
const blob = new Blob([await response.arrayBuffer()], { type: "video/mp4" })

// Upload Blob to Gemini Files API
const uploaded = await ai.files.upload({
  file: blob,
  config: { mimeType: "video/mp4" },
})

try {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: uploaded.uri, mimeType: "video/mp4" } },
          { text: prompt },
        ],
      },
    ],
  })
} finally {
  // Always clean up — 20GB per-project quota, files persist 48 hours
  if (uploaded.name) {
    ai.files.delete({ name: uploaded.name }).catch(() => {})
  }
}
```

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

### 5. Guard Optional Env Vars at Service Entry Points

```typescript
async function createGeminiClient() {
  if (!env.GOOGLE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_AI_API_KEY is not configured — scene analysis requires a Google AI API key",
    )
  }
  // ... create client
}
```

## Why This Works

- **Files API as staging area**: Google's multimodal APIs expect content hosted on their infrastructure. The upload→use→delete pattern respects this while avoiding storage quota exhaustion.
- **Dot-prefix domain check**: DNS subdomain boundaries are marked by dots. `evil-jesusfilm.org` does not end with `.jesusfilm.org`.
- **Standalone-first, bolt-on-second**: Scene analysis has one real dependency (video + transcript). Existing subtitles satisfy the transcript requirement without Mux transcription.
- **Error boundaries**: Optional features in existing workflows need isolation so their failures don't cascade.
- **Fail-fast with context**: Descriptive guards at service boundaries save debugging time vs opaque SDK internals.

## Prevention

1. **Always audit production data before designing pipelines.** Run `SELECT COUNT(*)` before assuming you need to build data extraction. The 974 existing subtitles saved the entire Mux transcription step.

2. **Gemini Files API rules:**
   - `fileData.fileUri` = Google-hosted URIs only (Files API or `gs://`)
   - `files.upload({ file: string })` = local filesystem path, not URL
   - `files.upload({ file: Blob })` = binary upload (correct for downloaded content)
   - Always delete uploaded files in a `finally` block (20GB quota)

3. **SSRF domain allowlist pattern** (see also: `docs/solutions/cms/strapi-v5-blurhash-generation-multi-path-pattern.md` prevention checklist):
   - Use `hostname === 'example.com' || hostname.endsWith('.example.com')`
   - Never use bare `endsWith('example.com')`
   - Test with adversarial hostnames: `evil-example.com`, `example.com.attacker.com`

4. **Optional features in existing workflows:**
   - Wrap in their own try/catch — never share the host workflow's error boundary
   - Log failures with structured JSON including the feature name
   - The host workflow's success/failure status reflects only essential steps

5. **Optional env vars for optional features:**
   - Guard at the public service entry point, not deep in internals
   - Error message should say: what's missing, where to set it, what feature it enables

## Cross-References

- `docs/solutions/platform/videoforge-manager-integration.md` — original manager app architecture (shared SDK client pattern, VTT parsing, `after()` pattern)
- `docs/solutions/cms/strapi-v5-blurhash-generation-multi-path-pattern.md` — SSRF prevention checklist for URL-fetching utilities
- `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` — lazy SDK initialization pattern
- `docs/roadmap/content-discovery/feat-038-video-vectorization-data-audit.md` — data audit results
- `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md` — full requirements
