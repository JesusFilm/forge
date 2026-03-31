---
title: "feat: AI voiceover with multi-provider TTS support"
type: feat
status: active
date: 2026-03-28
origin: docs/brainstorms/2026-03-28-ai-voiceover-requirements.md
---

# feat: AI Voiceover with Multi-Provider TTS Support

## Enhancement Summary

**Deepened on:** 2026-03-28
**Research agents used:** architecture-strategist, kieran-typescript-reviewer, performance-oracle, security-sentinel, code-simplicity-reviewer, data-integrity-guardian, julik-frontend-races-reviewer, best-practices-researcher, pattern-recognition-specialist, deployment-verification-agent, S3-storage-learnings

### Key Improvements

1. **Simplified adapter layer** — Collapsed from 4 files to 2, removed speculative interfaces (`listVoices`, `supportsLanguage`), aligned with codebase's flat-function-export pattern
2. **Streaming S3 upload** — Avoids OOM for long videos by streaming audio chunks directly to S3 via multipart upload instead of accumulating in memory
3. **ElevenLabs chunk continuity** — Leverages `previousText`/`nextText` API parameters and `Intl.Segmenter` for seamless multilingual sentence splitting
4. **Per-language step tracking** — Resolved the single-step-name-for-multiple-languages mismatch by using per-language artifact tracking in the job's `artifacts` JSON field
5. **Concurrency guard on re-runs** — 409 Conflict response prevents two managers from re-running the same voiceover simultaneously
6. **Rate limiting and input validation** — Strict Zod schemas on re-run endpoint, per-session rate limits on job creation
7. **Type safety overhaul** — Branded `BCP47` type, discriminated audio format union, `type` over `interface`, Zod-derived input types, `satisfies` for provider defaults

### New Considerations Discovered

- `after()` is fragile for multi-minute voiceover work — checkpoint/resume per language is essential
- MP3 buffer concatenation requires stripping ID3 headers from chunks 2+ and using CBR format
- ElevenLabs Flash v2.5 supports 40,000 chars per request, reducing chunking needs significantly
- Polling stops at terminal job status and won't pick up re-runs — needs heartbeat or poll restart
- `jobUpdateLocks` Map has unbounded growth — needs cleanup after settlement

---

## Overview

Add AI-powered voiceover generation to the media enrichment pipeline, supporting multiple Cloud TTS providers (ElevenLabs, Google Cloud TTS, Amazon Polly, Azure Speech) behind a common adapter type. Managers can trigger voiceover during enrichment, and re-run with a different provider if the result doesn't meet expectations. Generated audio is stored to S3 and published as a draft VideoVariant in CMS with full generation metadata.

## Problem Statement / Motivation

JFP produces video content consumed globally in hundreds of languages. The enrichment pipeline already transcribes, translates, and extracts metadata — but producing dubbed audio tracks is entirely manual. AI voiceover closes this gap, enabling managers to generate narrated audio for any language supported by a TTS provider, dramatically accelerating the dubbing workflow. (see origin: `docs/brainstorms/2026-03-28-ai-voiceover-requirements.md`)

## Proposed Solution

### Architecture

```
                          ┌─────────────────────────┐
                          │   getTTSAdapter(name)    │
                          │  (singleton dispatch)    │
                          └────────┬────────────────┘
                                   │
              ┌────────────────────┤
              │                    │
   ┌──────────▼──────┐ ┌──────────▼──────────────┐
   │  ElevenLabs     │ │  Future providers       │
   │  Adapter        │ │  (dotted: Google, Polly) │
   └──────────┬──────┘ └─────────────────────────┘
              │
    ┌─────────▼─────────┐
    │  voiceover.ts     │
    │  (service layer)  │
    │  - chunk text     │
    │  - call adapter   │
    │  - stream to S3   │
    └─────────┬─────────┘
              │
   ┌──────────┼──────────┐
   │                      │
┌──▼──────────┐  ┌────────▼────────┐
│ S3 multipart│  │ CMS: create     │
│ upload      │  │ draft variant   │
└─────────────┘  └─────────────────┘
```

### Research Insights: Architecture

**Codebase pattern alignment:**

- The existing codebase uses flat function exports with singleton clients (`getOpenrouter()`, `getMux()`), not interface-based Strategy patterns. The adapter layer should follow this convention: a `getTTSAdapter(provider)` function that returns a provider-specific client, with the service layer (`voiceover.ts`) handling orchestration (chunking, S3 streaming, CMS mutation).
- Place TTS code under `src/services/tts/` (not `src/providers/tts/`) to match the established folder structure where `src/services/` houses external API clients.
- Use domain-noun-first naming: `VoiceoverResult`, `VoiceoverInput` (not `TTSResult`, `TTSInput`) to match `TranscriptionResult`, `VideoMetadata`, `ChaptersResult`.

**Source:** pattern-recognition-specialist, code-simplicity-reviewer

### Provider Adapter Type

Each TTS provider implements a common type. Trimmed to the essential method — `listVoices` and `supportsLanguage` deferred until a consumer exists.

```typescript
// src/services/tts/types.ts

type BCP47 = string & { readonly __brand: unique symbol }

function parseBCP47(raw: string): BCP47 {
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(raw)) {
    throw new VoiceoverError(
      "INVALID_LANGUAGE",
      "voiceover",
      `Invalid BCP 47: ${raw}`,
    )
  }
  return raw as BCP47
}

type VoiceoverAudioFormat =
  | { contentType: "audio/mpeg"; ext: "mp3" }
  | { contentType: "audio/wav"; ext: "wav" }
  | { contentType: "audio/opus"; ext: "opus" }

type VoiceoverProviderName = "elevenlabs" | "google-tts" | "amazon-polly"

type VoiceoverSynthesizeInput = z.infer<typeof voiceoverSynthesizeInputSchema>

const voiceoverSynthesizeInputSchema = z.object({
  text: z.string().min(1),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/),
  voiceId: z.string().optional(),
  previousText: z.string().optional(), // chunk continuity
  nextText: z.string().optional(), // chunk continuity
})

type VoiceoverSynthesisMetadata = {
  provider: VoiceoverProviderName
  model: string
  voiceId: string
  voiceName: string
  durationMs?: number
  requestId?: string // for ElevenLabs continuity chaining
}

type VoiceoverSynthesizeResult = VoiceoverAudioFormat & {
  audio: Uint8Array
  metadata: VoiceoverSynthesisMetadata
}

type VoiceoverErrorCode =
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "INVALID_VOICE"
  | "INVALID_LANGUAGE"
  | "SYNTHESIS_FAILED"
  | "PROVIDER_UNAVAILABLE"

class VoiceoverError extends Error {
  constructor(
    readonly code: VoiceoverErrorCode,
    readonly provider: string,
    message: string,
    readonly retryable: boolean = false,
    readonly retryAfterMs?: number,
  ) {
    // Sanitize provider error messages to prevent credential leakage
    const sanitized = message
      .replace(/Bearer [^\s]+/g, "Bearer [REDACTED]")
      .replace(/key=[^\s&]+/g, "key=[REDACTED]")
    super(`[${provider}] ${sanitized}`)
    this.name = "VoiceoverError"
  }
}

type TTSAdapter = {
  readonly name: VoiceoverProviderName
  synthesize(
    input: VoiceoverSynthesizeInput,
  ): Promise<VoiceoverSynthesizeResult>
}
```

### Research Insights: Type Design

**Critical improvements from TypeScript review:**

- **Branded `BCP47` type** prevents passing "English" or "eng" where a BCP 47 tag is expected — compile-time guarantee.
- **Discriminated union `VoiceoverAudioFormat`** prevents `contentType: "audio/mpeg"` with `ext: "wav"` getting out of sync.
- **Typed `VoiceoverError`** with `code` and `retryable` fields lets callers distinguish "rate limited, retry later" from "language not supported, don't retry" without string matching.
- **Zod-derived input type** (`z.infer<typeof schema>`) ensures runtime validation and compile-time types from a single source of truth.
- **`Uint8Array` over `Buffer`** for cross-runtime compatibility (universal across Node.js, workers, edge runtimes).
- **`satisfies` + `as const`** on provider defaults (see registry section) preserves literal types while validating the shape.

**Source:** kieran-typescript-reviewer

### Text Chunking Strategy

Cloud TTS APIs have character limits per request (ElevenLabs Flash v2.5: 40,000 chars, Multilingual v2: 10,000, Google Cloud TTS: 5,000, Polly: 3,000). The voiceover service (not the adapter) handles chunking:

1. Splits input text at sentence boundaries using `Intl.Segmenter` (built-in, no dependencies, full CJK support)
2. Batches sentences up to the provider's character limit (not one-sentence-per-call)
3. Calls the adapter's `synthesize()` per chunk, passing `previousText`/`nextText` for prosodic continuity
4. Streams resulting audio chunks directly to S3 via multipart upload

```typescript
// Sentence splitting with Intl.Segmenter (works for CJK, Arabic, etc.)
function splitIntoSentences(text: string, locale: string = "en"): string[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

// Batch sentences into chunks respecting provider's character limit
function batchSentences(sentences: string[], maxChars: number): string[] {
  const batches: string[] = []
  let current = ""
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Oversized sentence: fall back to word-level splitting
      if (current) {
        batches.push(current.trim())
        current = ""
      }
      // ... word-level split with Intl.Segmenter granularity: "word"
      continue
    }
    if ((current + sentence).length > maxChars) {
      batches.push(current.trim())
      current = ""
    }
    current += sentence
  }
  if (current.trim()) batches.push(current.trim())
  return batches
}
```

### Research Insights: Chunking

**Key findings from best-practices research:**

- **`Intl.Segmenter`** is the recommended approach over `sbd` (unmaintained) or regex (fails on CJK). Ships with Node.js 16+, uses ICU data for locale-aware sentence boundaries.
- **Batch sentences to 2,000-3,000 chars per chunk** for quality, even when the API allows more. This preserves natural intonation better than maxing out the limit.
- **ElevenLabs' `previousText`/`nextText` parameters** are the single biggest quality improvement for chunked synthesis. Pass the last ~150 chars of the prior chunk and first ~150 chars of the next chunk. Also chain `previous_request_ids` (up to 3) for voice consistency.
- **MP3 concatenation works with `Buffer.concat()` when using CBR format** (`mp3_44100_128`). But ID3v2 headers must be stripped from chunks 2+:

```typescript
function stripId3Header(buffer: Uint8Array): Uint8Array {
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f)
    return buffer.subarray(10 + size)
  }
  return buffer
}
```

**Source:** best-practices-researcher, ElevenLabs API documentation

### Provider Selection & Smart Defaults

```typescript
// src/services/tts/elevenlabs.ts (or future adapters)

// Static config — maps BCP 47 to preferred provider + voice
const PROVIDER_DEFAULTS = {
  en: { provider: "elevenlabs", voiceId: "aria" },
  es: { provider: "elevenlabs" },
  fr: { provider: "elevenlabs" },
} as const satisfies Record<
  string,
  { provider: VoiceoverProviderName; voiceId?: string }
>

// Singleton adapter instances (follows getOpenrouter() pattern)
let _elevenlabs: TTSAdapter | undefined

function getElevenLabs(): TTSAdapter {
  if (!_elevenlabs) {
    _elevenlabs = createElevenLabsAdapter(env.ELEVENLABS_API_KEY!)
  }
  return _elevenlabs
}

// Main entry point — matches codebase's flat-function-export style
export function getTTSAdapter(provider?: VoiceoverProviderName): TTSAdapter {
  const name = provider ?? "elevenlabs" // default to first configured
  switch (name) {
    case "elevenlabs":
      return getElevenLabs()
    // case "google-tts": return getGoogleTTS()  // add when implemented
    default:
      throw new VoiceoverError(
        "PROVIDER_UNAVAILABLE",
        name,
        `Unknown provider: ${name}`,
      )
  }
}

export function selectProviderForLanguage(language: BCP47): {
  adapter: TTSAdapter
  voiceId?: string
} {
  const langKey = language.split("-")[0] // "en-US" → "en"
  const config = PROVIDER_DEFAULTS[langKey as keyof typeof PROVIDER_DEFAULTS]
  const providerName = config?.provider ?? "elevenlabs"
  return { adapter: getTTSAdapter(providerName), voiceId: config?.voiceId }
}
```

### Workflow Integration

Voiceover runs **after** the existing parallel group completes, since it depends on translation output for non-source languages:

```
transcription (sequential)
    ↓
[translation, chapters, metadata, embeddings] (parallel)
    ↓
voiceover (per language, bounded parallelism) ← NEW
```

```typescript
// In videoEnrichment.ts — after Promise.all([...parallel steps])

if (options.generateVoiceover) {
  const voiceoverLanguages = [sourceLanguage, ...(translateTo ?? [])]

  // Mark aggregate voiceover step as running
  await markStepRunning(input.jobId, "voiceover")

  const results: Record<string, string> = {} // lang → artifact key
  let anyFailed = false

  for (const lang of voiceoverLanguages) {
    try {
      const artifactKey = await stepVoiceover(
        assetId,
        jobId,
        lang,
        transcript,
        translations,
        options.voiceoverProvider,
        options.voiceoverVoiceId,
      )
      results[lang] = artifactKey
    } catch (err) {
      anyFailed = true
      // Log per-language failure but continue with other languages
    }
  }

  // Store per-language results in artifacts JSON field
  await updateJob(jobId, {
    artifacts: { ...existingArtifacts, voiceover: results },
  })

  if (anyFailed) {
    await markStepFailed(input.jobId, "voiceover", "Some languages failed")
  } else {
    await markStepComplete(input.jobId, "voiceover")
  }
}
```

### Research Insights: Workflow

**Per-language step tracking (architecture-strategist):**
The single "voiceover" step name cannot express per-language status. If Spanish succeeds but French fails, a naive approach marks the whole step "failed" and the Spanish success is invisible. Solution: use a single aggregate "voiceover" step for the UI table row, but store per-language results in the job's `artifacts` JSON field (`{ voiceover: { es: "key", fr: "key" } }`). The UI can render per-language sub-status from this field.

**Checkpoint/resume (performance-oracle):**
Before starting each language, check if a completed artifact already exists. On process restart, the next pipeline invocation picks up where it left off:

```typescript
if (await artifactExists(`${assetId}/voiceover-${lang}.mp3`)) continue
```

**Bounded parallelism (performance-oracle):**
Sequential per-language is the safe default, but for 10+ languages, use `p-limit` with concurrency of 3:

```typescript
import pLimit from "p-limit"
const limit = pLimit(3)
await Promise.all(voiceoverLanguages.map(lang => limit(() => stepVoiceover(...))))
```

**`after()` fragility (julik-frontend-races-reviewer):**
`after()` is designed for lightweight post-response work, not multi-minute processing. For voiceover jobs with many languages (5+ minutes total), a Railway restart kills in-flight work with no recovery. The checkpoint/resume pattern above mitigates this. Long-term, configure the `useworkflow.dev` SDK for durable execution, or move to a dedicated job queue.

### Re-Run Mechanism

New API endpoint for step-level re-execution:

```
POST /api/jobs/{jobId}/rerun-step
Body: { step: "voiceover", language: "es", provider?: "google-tts", voiceId?: "es-ES-Standard-A" }
```

This endpoint:

1. **Validates input** with strict Zod schema (enum-validated provider, regex-validated voiceId, BCP 47 language)
2. **Guards against concurrent re-runs** — returns 409 Conflict if the step is already `running`
3. Marks the step as `running`
4. Uses `after()` to run the voiceover generation in the background (returns 202 Accepted immediately)
5. Overwrites the existing S3 artifact directly (S3 PutObject is atomic — no partial writes)
6. On success: updates the VideoVariant metadata and step status
7. On failure: step marked failed, previous artifact remains untouched (CMS mutation hasn't run)

```typescript
// Strict input validation
const rerunSchema = z.object({
  step: z.literal("voiceover"),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  provider: z.enum(["elevenlabs", "google-tts", "amazon-polly"]).optional(),
  voiceId: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
})

// Concurrency guard
const step = job.steps.find((s) => s.name === "voiceover")
if (step?.status === "running") {
  return NextResponse.json(
    { error: "This step is already being re-run. Please wait." },
    { status: 409 },
  )
}
```

### Research Insights: Re-Run

**Simplified artifact handling (code-simplicity-reviewer):**
The temp-key-swap pattern is unnecessary. S3 PutObject is atomic at the object level — there are no partial writes. Just overwrite the artifact directly. If the write fails, the step is marked failed and the previous audio + CMS metadata remain untouched (CMS mutation runs after S3 write succeeds). This saves ~15 lines of swap logic.

**409 Conflict guard (julik-frontend-races-reviewer):**
Without this, two managers clicking "Re-run" within seconds of each other trigger competing generations. The loser overwrites the winner. The guard is cheap to implement and prevents real confusion.

**Polling restart (julik-frontend-races-reviewer):**
When a job reaches `completed` status, the UI stops polling. A re-run changes a step back to `running`, but other managers won't see it. Solution: the re-run button's success handler force-restarts the poll loop, and add a 60s background heartbeat for completed jobs.

**Source:** code-simplicity-reviewer, julik-frontend-races-reviewer, security-sentinel

### CMS Schema Changes

#### 1. Add `"voiceover"` to job-step component enum

**File:** `apps/cms/src/components/enrichment/job-step.json`

Add `"voiceover"` to the `name` enum array. In Strapi v5, adding a value to a component enum is additive — the underlying CHECK constraint is updated automatically on restart. No data migration needed.

#### 2. New `enrichment.generation-metadata` component

```json
{
  "collectionName": "components_enrichment_generation_metadata",
  "info": {
    "displayName": "Generation Metadata",
    "description": "AI generation provenance for enrichment artifacts"
  },
  "attributes": {
    "provider": { "type": "string", "required": true },
    "model": { "type": "string" },
    "voiceId": { "type": "string" },
    "voiceName": { "type": "string" },
    "generatedAt": { "type": "datetime", "required": true },
    "inputTextHash": { "type": "string" }
  }
}
```

Using a Strapi component (not a JSON field) because Strapi v5 JSON fields produce untyped GraphQL output. A component gives typed fields for `@forge/graphql` codegen.

The `inputTextHash` field (SHA-256 of the input text) enables post-hoc auditing of what text was synthesized.

#### 3. Attach to VideoVariant

Add to VideoVariant schema:

```json
"generationMetadata": {
  "type": "component",
  "repeatable": false,
  "component": "enrichment.generation-metadata"
}
```

#### 4. Fix duplicate `aiGenerated` field

Clean up the duplicate `aiGenerated` definition in VideoVariant schema (pre-existing bug, lines 93-103). Do this in Phase 1 before adding `generationMetadata`, in an isolated commit.

#### 5. AI-generated variant `coreId`

Use prefix `ai-{uuid}` for AI-generated VideoVariants. The core sync system uses numeric IDs, so no collision. The existing `softDeleteUnseen` function filters by `source: "core"`, so AI variants are safe from accidental deletion during syncs.

### Research Insights: CMS Schema

**Draft status enforcement (data-integrity-guardian, HIGH):**
If the variant is accidentally created as published, it immediately becomes visible to end users via GraphQL. The implementation **must** explicitly pass `status: "draft"` in the create mutation. Add an acceptance test that queries for published variants and confirms the new AI variant does not appear.

**Application-layer validation (data-integrity-guardian):**
Enforce that `aiGenerated: true` implies `generationMetadata` is populated. Without this, AI variants with no provenance trail make auditing impossible.

**Explicit artifact key (data-integrity-guardian):**
Consider adding an `artifactUrl` or `artifactKey` string field to `generationMetadata` so the CMS record explicitly links to the S3 object, rather than relying on a derived convention.

**Source:** data-integrity-guardian, security-sentinel

### Environment Variables

```
# ElevenLabs (initial provider)
ELEVENLABS_API_KEY=
```

Add to `apps/manager/src/config/env.ts` as an optional field. Voiceover is only available when at least one provider is configured. Do **not** add env vars for Google Cloud TTS or Amazon Polly until those adapters are implemented.

### Research Insights: Environment

**AWS Polly credentials (security-sentinel):**
When adding Polly, use IAM roles with temporary credentials (STS AssumeRole) instead of static access keys. This is standard AWS best practice.

**Key rotation runbook (security-sentinel):**
Document a rotation procedure: which keys to rotate, how to do it in Railway, and what needs redeploying. Add to operational docs.

## Technical Considerations

### Performance

- **Streaming S3 upload (P0):** Stream audio chunks directly to S3 via `@aws-sdk/lib-storage` `Upload` instead of accumulating buffers in memory. This drops peak memory from O(total_audio_size) to O(max_chunk_size), ~1MB vs potentially 100MB+ for long videos.
- **Batched text chunks (P0):** Batch sentences up to the provider's character limit (not one-per-API-call). A 10-minute transcript might have 150-300 sentences; batching reduces API calls by 5-10x.
- **Checkpoint/resume (P0):** Check if a completed artifact exists before generating each language. Process restarts pick up where they left off.
- **Bounded parallelism (P1):** Use `p-limit(3)` for concurrent per-language generation when multiple languages are requested.
- **Content-hash caching (P2):** If the same text+voice combination was previously synthesized, skip regeneration.
- **ElevenLabs model selection:** Flash v2.5 for low latency (40k char limit, ~75ms), Multilingual v2 for quality (10k limit, 29 languages).
- **Audio format:** Use `mp3_44100_128` (CBR) for reliable frame concatenation. CBR ensures consistent bitrate across chunks.

### Error Handling

- `VoiceoverError` class with `code`, `provider`, `retryable`, and `retryAfterMs` fields.
- Error messages sanitized to strip credentials before persisting to CMS.
- Exponential backoff with full jitter; honor `Retry-After` headers from providers.
- The workflow's existing `runParallelStep()` error isolation handles step-level failures.
- Per-language failures logged but don't block other languages.

### Security

- **Rate limiting (P1):** Implement per-session rate limiting on job creation and re-run endpoints. At minimum: max 10 jobs per user per minute, max 5 re-runs per voiceover step per job.
- **Input validation:** Strict Zod schemas on all endpoints. Provider validated against enum, voiceId against `^[a-zA-Z0-9_-]+$`, language against BCP 47.
- **API keys:** Stored in Railway env vars, validated by Zod. Never logged. Error messages sanitized by `VoiceoverError`.
- **Preview URL validation:** If voice preview URLs are rendered in UI, validate against provider domain allowlists. Set CSP `media-src` to restrict to known TTS provider origins.
- **Authorization:** Document that all Managers have equal access to all jobs. The re-run endpoint uses the same `authenticateRequest()` as existing routes.

## System-Wide Impact

### Interaction Graph

1. Manager creates job with `generateVoiceover: true` → API route passes option to workflow input
2. Workflow completes transcription + parallel steps → voiceover runs per-language
3. Voiceover service → chunks text → calls adapter `synthesize()` per chunk → streams to S3
4. Voiceover service → `createVideoVariant` mutation → CMS (draft status, explicitly)
5. CMS EnrichmentJob step status updates via `updateStepStatus()` (read-then-write with mutex)
6. Re-run endpoint → validates → 409 if already running → `after()` background execution

### Error Propagation

- TTS provider errors → caught by adapter → wrapped as `VoiceoverError` (sanitized) → step marked failed → job continues with other languages
- S3 write errors → bubble up from multipart upload → step marked failed
- CMS mutation errors → step marked failed, audio artifact already saved to S3 (recoverable — artifact key logged for manual cleanup)

### State Lifecycle Risks

- **Orphaned S3 artifacts:** If CMS mutation fails after S3 write succeeds, an orphaned object remains. Log the artifact key as a warning. Consider periodic cleanup for objects with no corresponding CMS record.
- **Repeatable component updates:** Uses the existing mutex-serialized `updateStepStatus()`.
- **jobUpdateLocks memory leak:** The per-job mutex Map grows without bound. Clean up entries after promise settlement.

### API Surface Parity

- New endpoint: `POST /api/jobs/{id}/rerun-step`
- Existing endpoint modified: `POST /api/jobs` — accepts `options.generateVoiceover`, `options.voiceoverProvider`, `options.voiceoverVoiceId`
- UI already has voiceover checkbox; needs re-run button on voiceover step rows (Phase 4)
- Provider/voice override dropdowns deferred to re-run dialog only (not new-job form)

## Acceptance Criteria

### Functional Requirements

- [ ] ElevenLabs adapter implements `TTSAdapter` and can generate audio for English and Spanish
- [ ] `getTTSAdapter()` dispatches to the correct provider singleton
- [ ] `selectProviderForLanguage()` maps languages to defaults and allows override
- [ ] Voiceover step runs after the parallel enrichment group when `generateVoiceover` is true
- [ ] Input text is sourced from transcript (source language) or translation output (other languages)
- [ ] Text chunking uses `Intl.Segmenter` and batches sentences within provider character limits
- [ ] ElevenLabs adapter passes `previousText`/`nextText` for chunk continuity
- [ ] Audio is streamed to S3 via multipart upload (not buffered in memory)
- [ ] Generated audio artifact key: `{assetId}/voiceover-{lang}.mp3`
- [ ] Draft VideoVariant is created in CMS with explicit `status: "draft"`, `source: "manager"`, `aiGenerated: true`, and `generationMetadata` component populated
- [ ] AI-generated variants use `coreId` format `ai-{uuid}`
- [ ] Manager can re-run voiceover step with a different provider via `POST /api/jobs/{id}/rerun-step`
- [ ] Re-run returns 409 Conflict if the step is already running
- [ ] Per-language results stored in job's `artifacts` JSON field
- [ ] Checkpoint: existing artifacts are skipped on retry/restart
- [ ] `"voiceover"` appears in the CMS job-step enum and step status updates work correctly
- [ ] Draft variant does NOT appear in published GraphQL queries (explicit test)

### Non-Functional Requirements

- [ ] At least one TTS provider API key must be configured for voiceover to be available
- [ ] Voiceover generation for a single language completes within 120 seconds for videos under 15 minutes
- [ ] Provider API keys never appear in logs, error messages, or API responses
- [ ] Adding a new TTS provider requires only: implement `TTSAdapter` type, register in `getTTSAdapter()`, add env var
- [ ] Peak memory usage for voiceover stays under 50MB per language (streaming upload)

### Quality Gates

- [ ] Unit tests for text chunking with edge cases (empty text, single sentence, text at exact limit, CJK text with `Intl.Segmenter`)
- [ ] Unit tests for ID3 header stripping and MP3 buffer concatenation
- [ ] Unit tests for provider selection and fallback logic
- [ ] Unit tests for `VoiceoverError` message sanitization
- [ ] Integration test: end-to-end voiceover generation → S3 streaming upload → CMS draft variant creation
- [ ] Integration test: re-run with different provider replaces artifact and updates metadata
- [ ] CMS schema change validated by running Strapi locally and confirming GraphQL codegen succeeds
- [ ] Draft status verification test: query published variants, confirm AI variant absent

## Implementation Phases

### Phase 1: CMS Schema & Foundation

**Files to modify:**

- `apps/cms/src/components/enrichment/job-step.json` — add `"voiceover"` to name enum
- `apps/cms/src/api/video-variant/content-types/video-variant/schema.json` — fix duplicate `aiGenerated`, add `generationMetadata` component
- `apps/cms/src/components/enrichment/generation-metadata.json` — new component (with `inputTextHash` field)
- `packages/graphql/` — run codegen to regenerate types

**Tasks:**

- [ ] Fix duplicate `aiGenerated` field in VideoVariant (isolated commit, verify Strapi restarts cleanly)
- [ ] Add `"voiceover"` to job-step name enum
- [ ] Create `enrichment.generation-metadata` component (provider, model, voiceId, voiceName, generatedAt, inputTextHash)
- [ ] Attach `generationMetadata` to VideoVariant schema
- [ ] Run Strapi locally to validate schema
- [ ] Run gql.tada codegen in `packages/graphql/`
- [ ] Verify generated types include new enum value and component
- [ ] Verify existing enrichment jobs and variants are unaffected (run baseline SQL queries)

**Success criteria:** Strapi starts cleanly, GraphQL schema includes voiceover step enum and generation metadata fields, existing data unchanged.

### Phase 2: Provider Adapter Layer

**Files to create:**

- `apps/manager/src/services/tts/types.ts` — adapter type, shared types, `VoiceoverError`, branded `BCP47`
- `apps/manager/src/services/tts/elevenlabs.ts` — ElevenLabs adapter + `getTTSAdapter()` + `selectProviderForLanguage()` + inline text chunking

**Files to modify:**

- `apps/manager/src/config/env.ts` — add `ELEVENLABS_API_KEY` as optional

**Tasks:**

- [ ] Define `TTSAdapter`, `VoiceoverSynthesizeInput`, `VoiceoverSynthesizeResult`, `VoiceoverError` types
- [ ] Implement `BCP47` branded type with `parseBCP47()` validation
- [ ] Implement `VoiceoverAudioFormat` discriminated union
- [ ] Implement text chunking with `Intl.Segmenter` (sentence-boundary batching, configurable char limit, CJK support)
- [ ] Implement ID3 header stripping for MP3 concatenation
- [ ] Implement ElevenLabs adapter with `previousText`/`nextText` chunk continuity, CBR `mp3_44100_128` output
- [ ] Implement `getTTSAdapter()` singleton dispatch and `selectProviderForLanguage()`
- [ ] Implement retry with exponential backoff + full jitter, honor `Retry-After` headers
- [ ] Add ElevenLabs API key to env validation (optional)
- [ ] Unit test chunker with edge cases (empty text, single sentence, exact limit, CJK, oversized sentence)
- [ ] Unit test ID3 stripping and buffer concatenation
- [ ] Unit test provider selection and fallback
- [ ] Unit test `VoiceoverError` message sanitization

**Success criteria:** ElevenLabs adapter can synthesize audio from text with chunk continuity, chunking works for long multilingual inputs, provider dispatch routes correctly.

### Phase 3: Voiceover Service & Workflow Integration

**Files to create:**

- `apps/manager/src/services/voiceover.ts` — voiceover service (follows existing service pattern)

**Files to modify:**

- `apps/manager/src/workflows/videoEnrichment.ts` — add `stepVoiceover()`, wire into orchestration after parallel group
- `apps/manager/src/lib/workflow-steps.ts` — conditionally include `"voiceover"` in initial steps
- `apps/manager/src/app/api/jobs/route.ts` — accept `options.generateVoiceover`, `options.voiceoverProvider`, `options.voiceoverVoiceId` in request schema
- `apps/manager/src/app/api/enrich/route.ts` — pass voiceover options through
- `apps/manager/src/types/job.ts` — add voiceover-specific fields to `JobOptions` if not already present

**Tasks:**

- [ ] Implement `voiceover.ts` service: select provider → chunk text → synthesize per chunk with continuity → stream to S3 via multipart upload → create draft VideoVariant
- [ ] Add `stepVoiceover()` function with `"use step"` directive in workflow
- [ ] Wire voiceover into orchestration (after parallel group, conditional on `generateVoiceover`)
- [ ] Implement checkpoint/resume: skip languages with existing artifacts
- [ ] Store per-language results in job's `artifacts` JSON field
- [ ] Update `buildInitialSteps()` to conditionally include voiceover step
- [ ] Extend `createJobSchema` in API route to accept voiceover options
- [ ] Pass options through from API routes to workflow input
- [ ] Create draft VideoVariant with explicit `status: "draft"`, `generationMetadata`, `source: "manager"`, `aiGenerated: true`, `coreId: "ai-{uuid}"`
- [ ] Compute and store `inputTextHash` in generation metadata
- [ ] Integration test: full pipeline with voiceover enabled
- [ ] Verify draft variant does NOT appear in published queries

**Success criteria:** End-to-end enrichment job with voiceover generates audio via streaming upload, creates draft VideoVariant in CMS with full metadata.

### Phase 4: Re-Run & UI

**Files to create:**

- `apps/manager/src/app/api/jobs/[id]/rerun-step/route.ts` — re-run endpoint

**Files to modify:**

- `apps/manager/src/features/jobs/live-job-steps-table.tsx` — add re-run action button for voiceover steps, add polling heartbeat for completed jobs

**Tasks:**

- [ ] Implement `POST /api/jobs/{id}/rerun-step` endpoint with strict Zod validation
- [ ] Add 409 Conflict guard for concurrent re-runs
- [ ] Use `after()` for background execution, return 202 Accepted immediately
- [ ] Overwrite S3 artifact directly (atomic PutObject/multipart upload)
- [ ] Update step status and VideoVariant metadata on completion
- [ ] Add re-run button to voiceover step in LiveJobStepsTable
- [ ] Add provider/voice selection in re-run dialog
- [ ] Force-restart poll loop from re-run success handler
- [ ] Add 60s background heartbeat polling for completed jobs (to catch re-runs by other managers)
- [ ] Implement rate limiting: max 5 re-runs per voiceover step per job
- [ ] Test re-run happy path and failure path
- [ ] Test concurrent re-run returns 409

**Success criteria:** Manager can re-run voiceover with a different provider, concurrent re-runs are blocked, UI reflects re-run status in real-time.

## Alternative Approaches Considered

1. **OpenRouter for TTS** — Rejected. OpenRouter's TTS support is limited and doesn't offer the voice catalog depth, language coverage, or audio quality of dedicated TTS providers. (see origin: Key Decisions)

2. **Side-by-side comparison** — Deferred. Re-run is simpler and sufficient for MVP. Comparison UI adds significant complexity (parallel generation, comparison player, selection flow). (see origin: Key Decisions)

3. **Segment-level TTS** — Deferred. Per-cue generation with timestamp alignment adds complexity (prosody, timing, silence insertion) that isn't needed for narration-style content. (see origin: Key Decisions)

4. **Store metadata as JSON field** — Rejected in favor of a Strapi component. JSON fields are untyped in Strapi v5's GraphQL output. A component gives typed fields for `@forge/graphql` codegen.

5. **Interface-based Strategy pattern** — Simplified. The codebase uses flat function exports with singleton clients, not formal interface + registry patterns. The adapter layer uses a `getTTSAdapter()` dispatch function matching the existing `getOpenrouter()` / `getMux()` convention.

6. **Temp-key-swap for re-runs** — Dropped. S3 PutObject is atomic. Simple overwrite achieves the same safety with less code.

## Dependencies & Prerequisites

- Translation step must complete before voiceover can run for non-source languages (pipeline ordering)
- Transcription step must complete before source-language voiceover
- At least one TTS provider API key must be configured
- Strapi must be running locally for schema changes and codegen (standard GraphQL Change Flow)

## Risk Analysis & Mitigation

| Risk                                      | Likelihood | Impact   | Mitigation                                                                                                                  |
| ----------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| TTS provider rate limiting                | Medium     | Medium   | Exponential backoff with jitter, honor `Retry-After`, bounded parallelism with `p-limit`                                    |
| Audio quality varies by language/provider | High       | Medium   | Smart defaults steer to best provider per language; re-run enables fallback                                                 |
| Chunked audio has audible seams           | Medium     | High     | ElevenLabs `previousText`/`nextText` + `previous_request_ids` for prosodic continuity; CBR MP3; sentence-boundary splitting |
| OOM from large audio buffers              | Medium     | High     | S3 multipart streaming upload; peak memory O(chunk_size) not O(total_audio)                                                 |
| `after()` killed by Railway restart       | Medium     | High     | Checkpoint/resume per language; skip completed artifacts on retry                                                           |
| Concurrent re-runs corrupt state          | Medium     | Medium   | 409 Conflict guard on re-run endpoint                                                                                       |
| Draft variant accidentally published      | Low        | Critical | Explicit `status: "draft"`; acceptance test verifying absence from published queries                                        |
| Strapi v5 enum migration issue            | Low        | High     | Test locally first; additive enum change, no data migration                                                                 |
| Long generation times for many languages  | Medium     | Low      | Voiceover is opt-in; bounded parallelism reduces wall-clock; checkpoint/resume                                              |

## Deployment Checklist

### Pre-Deploy

- [ ] Verify `ELEVENLABS_API_KEY` in Railway environment
- [ ] Run baseline SQL queries against production (save results)
- [ ] Confirm no in-flight enrichment jobs (`status IN ('pending', 'running')`)
- [ ] Schema changes validated on staging

### Deploy Order

**CMS first, then Manager.** The Manager depends on the new `"voiceover"` enum value existing in Strapi.

### Post-Deploy Verification

```sql
-- Verify CHECK constraint includes 'voiceover'
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'components_enrichment_job_steps'::regclass
  AND contype = 'c' AND conname LIKE '%name%';

-- Verify generation_metadata table created
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'components_enrichment_generation_metadata'
);

-- Verify existing data unchanged
SELECT source, COUNT(*) FROM video_variants GROUP BY source;
SELECT name, COUNT(*) FROM components_enrichment_job_steps GROUP BY name;
```

### Rollback

Fully reversible — all changes are additive. Revert commit, redeploy. If AI-generated data exists, clean up with:

```sql
DELETE FROM video_variants WHERE core_id LIKE 'ai-%';
DELETE FROM components_enrichment_job_steps WHERE name = 'voiceover';
```

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-28-ai-voiceover-requirements.md](docs/brainstorms/2026-03-28-ai-voiceover-requirements.md) — Key decisions carried forward: Cloud TTS over OpenRouter, smart defaults over explicit selection, re-run over side-by-side comparison, draft variants, full-video first.

### Internal References

- Enrichment pipeline orchestrator: `apps/manager/src/workflows/videoEnrichment.ts`
- Service pattern example: `apps/manager/src/services/translation.ts`
- Storage API: `apps/manager/src/services/storage.ts:181` (`writeArtifact`)
- Job state management: `apps/manager/src/lib/state.ts`
- Job types: `apps/manager/src/types/job.ts:16` (`WorkflowStepName`)
- Workflow steps: `apps/manager/src/lib/workflow-steps.ts:6` (`FORGE_STEPS`)
- CMS job-step component: `apps/cms/src/components/enrichment/job-step.json`
- VideoVariant schema: `apps/cms/src/api/video-variant/content-types/video-variant/schema.json`
- UI job form: `apps/manager/src/app/dashboard/jobs/new-job-form.tsx:25`
- UI step display: `apps/manager/src/features/jobs/live-job-steps-table.tsx:53`
- Auth middleware: `apps/manager/src/lib/auth.ts:92` (`authenticateRequest`)

### Institutional Learnings

- Strapi v5 repeatable components require full-array read-then-write: `docs/solutions/cms/strapi-enrichment-job-content-type.md`
- Strapi v5 GraphQL silently truncates nested relations at 10 items: `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`
- Strapi v5 relation clearing requires `{ set: [] }`: `docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md`
- VideoForge manager architecture: `docs/solutions/platform/videoforge-manager-integration.md`
- Railway S3 with local fallback: `docs/solutions/platform/optional-railway-s3-local-fallback.md`

### External References

- ElevenLabs TTS API: `https://elevenlabs.io/docs/api-reference/text-to-speech/convert`
- ElevenLabs context continuity: `previousText`/`nextText`/`previous_request_ids` parameters
- ElevenLabs rate limits: Free=2, Starter=3, Creator=5, Pro=10, Scale=15 concurrent
- `Intl.Segmenter` (MDN): Built-in multilingual sentence/word segmentation, Node.js 16+
- `@aws-sdk/lib-storage` `Upload`: S3 multipart upload with streaming support
- `p-limit`: Bounded concurrency for parallel language processing
