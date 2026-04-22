---
title: "feat: AI-Powered Subtitle Translation Pipeline"
type: feat
status: active
date: 2026-03-28
origin: docs/brainstorms/2026-03-28-subtitle-translation-pipeline-requirements.md
---

# feat: AI-Powered Subtitle Translation Pipeline

## Overview

Replace the manager app's full-text translation step with a 3-phase, split-brain subtitle translation pipeline that produces timed VTT subtitle files for 50+ target languages. The pipeline separates creative translation from structural re-timing to handle the "geometry of language" problem — where languages like Japanese compress and German reorders content — without blank screens or broken timing.

## 2026-04-04 Audit Update

The core pipeline described here has now landed in the branch, but the implementation settled on a few simplifications:

- the orchestrator lives at `src/services/subtitleTranslation/index.ts` rather than a single `src/services/subtitleTranslation.ts` file
- per-language artifact fan-out is implemented and persisted, but per-language `languageResults` are not yet stored on the job step state
- the remaining unchecked items below are follow-up state-tracking or extra validation gaps, not missing core pipeline work

## Problem Statement / Motivation

The current translation service (`apps/manager/src/services/translation.ts`) translates the full transcript as a text blob. It produces no timed subtitle files for translated languages. To serve translated subtitles in the video player, a new pipeline is needed that:

1. Preserves subtitle timing alignment across structurally diverse languages
2. Handles language geometry (Japanese compression, German verb brackets, RTL scripts)
3. Produces WebVTT files per language alongside full translated text for search/metadata

The split-brain approach is chosen over single-pass because research (Tam et al.) confirms format constraints degrade LLM quality — and at 50+ languages, that gap compounds (see origin: `docs/brainstorms/2026-03-28-subtitle-translation-pipeline-requirements.md`).

## Proposed Solution

### Architecture

```
Source VTT (from Mux transcription)
        ↓
┌─── Phase 1: Smart Chunking (algorithmic) ───┐
│  Group segments into 3-5 line thought blocks │
│  based on sentence boundaries                │
└──────────────────┬──────────────────────────-┘
                   ↓
        ┌── Per Language (50+ parallel) ──┐
        │                                 │
        │  Phase 2: Creative Translation  │
        │  (LLM — meaning only, no       │
        │   structural constraints)       │
        │          ↓                      │
        │  Phase 3: LLM Re-timing         │
        │  (LLM — redistribute text       │
        │   across time slots)            │
        │          ↓                      │
        │  Validation                     │
        │    ├─ valid → ✓ done            │
        │    └─ invalid → correction loop │
        │         ├─ retry (1x)           │
        │         └─ deterministic        │
        │            fallback             │
        │          ↓                      │
        │  Write artifacts                │
        │  • subtitles-{lang}.vtt         │
        │  • translation-{lang}.json      │
        └─────────────────────────────────┘
```

### Deferred Question Resolutions

These questions were deferred from the brainstorm. Resolved using codebase research:

| Question                               | Resolution                                              | Rationale                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model selection** (R2)               | Gemini 2.5 Flash for both phases                        | Current default; fast and cheap. Creative translation quality is good for most languages. Can override per-language via R10 custom prompts if needed. |
| **Chunk size** (R2)                    | 3-5 segments, algorithmic                               | Scan for sentence-ending punctuation. No LLM call needed — saves ~33% cost at scale.                                                                  |
| **Merged slot boundaries** (R3)        | New slot spanning full merged range                     | First segment's `start` to last segment's `end`. Simple and correct.                                                                                  |
| **Correction retries** (R4)            | 1 retry with error feedback                             | Matches Vimeo's approach. Diminishing returns beyond 1.                                                                                               |
| **Parallelism limits** (R7)            | 10 concurrent languages, sequential phases per language | Prevents OpenRouter rate limiting. Each language's 3 phases run sequentially.                                                                         |
| **Cost estimate** (R7)                 | ~$0.50 per video at 50 languages                        | ~25 chunks × 2 LLM calls × 50 langs = 2,500 calls. At Gemini Flash rates, viable for batch processing.                                                |
| **Smart chunking** (R2)                | Algorithmic, not LLM-driven                             | Sentence boundary detection is deterministic, free, and reliable.                                                                                     |
| **VTT metadata** (R6)                  | Include NOTE headers                                    | Language code and generation timestamp in WEBVTT header.                                                                                              |
| **Prompt/glossary storage** (R10, R11) | JSON config files per language                          | `src/config/languages/{lang}.json` — simple to start, can migrate to Strapi CMS later.                                                                |
| **Glossary injection** (R11)           | Structured list in system prompt                        | "Use these exact translations: [term] → [translation]" — most effective for LLM compliance.                                                           |

## Technical Approach

### Key Files to Create

| File                                             | Purpose                                                |
| ------------------------------------------------ | ------------------------------------------------------ |
| `src/services/subtitleTranslation/index.ts`      | Main pipeline orchestrator — replaces `translation.ts` |
| `src/services/subtitleTranslation/chunker.ts`    | Phase 1: Smart chunking algorithm                      |
| `src/services/subtitleTranslation/translator.ts` | Phase 2: Creative translation LLM call                 |
| `src/services/subtitleTranslation/retimer.ts`    | Phase 3: LLM re-timing + correction loop + fallback    |
| `src/services/subtitleTranslation/types.ts`      | Shared types and Zod schemas                           |
| `src/lib/vtt.ts`                                 | Extracted VTT utilities (from `transcription.ts`)      |
| `src/config/languages/`                          | Per-language JSON config (prompt + glossary)           |

### Key Files to Modify

| File                               | Change                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| `src/services/transcription.ts`    | Extract VTT utilities to `src/lib/vtt.ts`, import from there    |
| `src/workflows/videoEnrichment.ts` | Replace translation step with new subtitle translation pipeline |
| `src/lib/state.ts`                 | Add per-language result tracking to step status                 |

### Critical Integration Findings

From SpecFlow analysis — 4 gaps to address:

**C1. Workflow contract mismatch.** The current workflow passes `text` to the translation step, but the new pipeline needs `segments[]`. **Fix:** The new service reads the `transcript.json` artifact directly from storage (it contains segments with timing). No need to change the workflow's data passing.

**C2/C3. Partial success modeling.** The Strapi EnrichmentJob step status is binary (completed/failed), but 48/50 languages succeeding is a partial success. **Fix:** Add a `languageResults` field to the translation step's metadata. Each language gets `{ lang, status, error? }`. Step-level status: "completed" if ≥1 language succeeded, "failed" if all failed.

**C4. parseLLMJson for correction loop.** The existing `parseLLMJson` silently returns a fallback, but the correction loop needs to distinguish retriable validation failures from catastrophic parse failures. **Fix:** Create a `validateRetimingOutput` function that throws typed errors. Use `parseLLMJson` only for the final fallback path.

### Implementation Phases

#### Phase 1: Foundation

Extract shared utilities and set up types.

- [x] Extract `parseVTT()`, `segmentsToVTT()`, `formatVTTTime()`, `parseVTTTime()` from `src/services/transcription.ts` → `src/lib/vtt.ts`
- [x] Update `transcription.ts` to import from `src/lib/vtt.ts`
- [x] Create `src/services/subtitleTranslation/types.ts` with Zod schemas:

```typescript
// src/services/subtitleTranslation/types.ts
import { z } from "zod"

export type TranscriptSegment = {
  start: number // seconds
  end: number // seconds
  text: string
}

export type Chunk = {
  index: number
  segments: TranscriptSegment[]
  startTime: number
  endTime: number
  sourceText: string // joined segment text
}

export const RetimingOutputSchema = z.object({
  segments: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      text: z.string().min(1),
    }),
  ),
})

export type RetimingOutput = z.infer<typeof RetimingOutputSchema>

export type LanguageConfig = {
  customPrompt?: string
  glossary?: Record<string, string> // source term → target translation
}

export type LanguageResult = {
  lang: string
  status: "completed" | "failed"
  error?: string
  artifactKeys?: { vtt: string; json: string }
}
```

- [x] Create `src/config/languages/` directory with example config:

```json
// src/config/languages/ja.json (example)
{
  "customPrompt": "Use natural, modern Japanese. Avoid overly formal keigo unless the speaker is clearly formal.",
  "glossary": {
    "Jesus Film": "ジーザス・フィルム",
    "Gospel": "福音"
  }
}
```

**Success criteria:** VTT utilities extracted without breaking transcription. Types compile. Example config loads.

#### Phase 2: Smart Chunking

Algorithmic sentence-boundary grouping.

- [x] Create `src/services/subtitleTranslation/chunker.ts`:

```typescript
// src/services/subtitleTranslation/chunker.ts
const SENTENCE_ENDINGS = /[.!?。！？…]+\s*$/

export function chunkSegments(
  segments: TranscriptSegment[],
  targetSize: number = 4,
): Chunk[] {
  // Group segments into thought blocks of ~targetSize
  // Break at sentence boundaries when possible
  // Never break mid-sentence if avoidable
  // Each chunk: { index, segments, startTime, endTime, sourceText }
}
```

- [x] Handle edge cases: single-segment chunks at end, very long segments, empty segments
- [x] Unit test with varied VTT inputs: clean sentences, filler-heavy speech, single-word segments

**Success criteria:** Chunks consistently 3-5 segments. Never splits mid-sentence. Covers the full time range without gaps.

#### Phase 3: Creative Translation (Phase 2 of pipeline)

LLM translation with no structural constraints.

- [x] Create `src/services/subtitleTranslation/translator.ts`:

```typescript
// src/services/subtitleTranslation/translator.ts
export async function translateChunk(
  chunk: Chunk,
  targetLanguage: string,
  config?: LanguageConfig,
): Promise<string> {
  // System prompt: translate for meaning only
  // Inject glossary terms if present
  // Inject custom prompt if present
  // Returns: translated text block (single string)
}
```

- [x] System prompt structure:
  - Base: "Translate the following text to {language}. Translate for meaning and natural fluency. Do not worry about line count or timing."
  - Glossary (if present): "Use these exact translations for the following terms: {term} → {translation}, ..."
  - Custom prompt (if present): appended after base instructions
- [x] Use `getOpenrouter()` shared client with `DEFAULT_MODEL`
- [x] Structured JSON logging: `{ event: 'translate_chunk', language, chunkIndex, inputTokens }`

**Success criteria:** Translations are fluent and natural. Glossary terms are respected. No structural constraints in output.

#### Phase 4: LLM Re-timing + Correction Loop + Fallback (Phase 3 of pipeline)

The structural pass — redistribute translated text across time slots.

- [x] Create `src/services/subtitleTranslation/retimer.ts`:

```typescript
// src/services/subtitleTranslation/retimer.ts
const MAX_SLOT_DURATION = 7 // seconds

export async function retimeChunk(
  chunk: Chunk,
  translatedText: string,
  targetLanguage: string,
  config?: LanguageConfig,
): Promise<TranscriptSegment[]> {
  // 1. LLM re-timing call
  // 2. Validate output with Zod schema
  // 3. Validate constraints (no overlaps, within time window, max 7s)
  // 4. If invalid → correction loop (1 retry with error feedback)
  // 5. If still invalid → deterministic fallback
}

export function deterministicRetime(
  chunk: Chunk,
  translatedText: string,
): TranscriptSegment[] {
  // Distribute text proportionally by character length
  // Merge slots when translation is shorter than source
  // Split at natural breaks (spaces, punctuation) when translation is longer
  // Enforce max 7s per slot
  // Always produces valid output
}
```

- [x] Re-timing LLM prompt: "Given the original subtitle segments with timestamps and the translated text, break the translated text into subtitle segments that fit within the original time window [{startTime} - {endTime}]. Rules: no single segment longer than 7 seconds, no overlapping times, break at natural phrase boundaries."
- [x] Validation function (`validateRetimingOutput`):
  - Segments are within chunk's time window
  - No overlapping start/end times
  - No segment exceeds 7 seconds
  - All text from translation is present (no dropped content)
  - No empty text
- [x] Correction loop: pass validation errors as explicit feedback: "Your output had overlapping times at segments 2 and 3. Fix this."
- [x] Deterministic fallback: character-ratio proportional distribution
- [x] Custom prompt injection in re-timing phase if present
- [x] Structured logging at each stage: `{ event: 'retime_attempt', language, chunkIndex, attempt, valid }`

**Success criteria:** Valid VTT segments for every chunk, every language. No blank screens. Max 7s per slot. Deterministic fallback always produces valid output.

#### Phase 5: Pipeline Orchestrator + Parallel Execution

Wire everything together and replace the existing translation step.

- [x] Create the subtitle translation orchestrator under `src/services/subtitleTranslation/index.ts`:

```typescript
// src/services/subtitleTranslation/index.ts
import pLimit from "p-limit"

const CONCURRENCY_LIMIT = 10

export async function translateSubtitles(options: {
  assetId: string
  sourceLanguage: string
  targetLanguages: string[]
}): Promise<LanguageResult[]> {
  // 1. Read transcript.json artifact (contains segments)
  // 2. Parse source VTT segments
  // 3. Smart chunk the segments (once, shared across all languages)
  // 4. Fan out: p-limit(10) across target languages
  //    Per language:
  //      a. Load language config (prompt + glossary) if exists
  //      b. For each chunk: translate → retime → validate
  //      c. Assemble final VTT from all retimed segments
  //      d. Write subtitles-{lang}.vtt artifact
  //      e. Derive and write translation-{lang}.json artifact
  //      f. Return LanguageResult
  // 5. Collect all LanguageResults
  // 6. Log summary: { event: 'translation_complete', succeeded, failed, total }
}
```

- [x] Add `p-limit` dependency: `pnpm add p-limit --filter @forge/manager`
- [x] VTT output with metadata headers:

```
WEBVTT
NOTE language: ja
NOTE generated: 2026-03-28T12:00:00Z
NOTE source: {assetId}

00:00:01.000 --> 00:00:04.500
翻訳されたテキスト
```

- [x] Derived full text: join all retimed segments' text, store as `translation-{lang}.json` with same format as current `TranslationResult`
- [x] Per-language error isolation: try/catch around each language's pipeline. Failed language → `LanguageResult { status: 'failed', error }`. Never blocks other languages.

**Success criteria:** 50+ languages translate in parallel (10 concurrent). Each produces valid VTT + JSON. Failures isolated per language.

#### Phase 6: Workflow Integration + State Management

Replace the translation step in the enrichment workflow.

- [x] Update `src/workflows/videoEnrichment.ts`:
  - Replace the existing translation step with `translateSubtitles()`
  - Input: reads `transcript.json` artifact directly (not text from workflow context)
  - Output: per-language artifacts written to storage
- [ ] Update `src/lib/state.ts`:
  - Add `languageResults: LanguageResult[]` to the translation step metadata
  - Step status: "completed" if ≥1 language succeeded, "failed" if all failed
  - Carry per-language errors for dashboard visibility
- [x] Remove or deprecate old `src/services/translation.ts` (replaced by new pipeline)
- [x] Ensure `writeArtifact` handles concurrent writes from 10 parallel languages safely (S3 is naturally concurrent; local fallback may need mutex for directory creation)

**Success criteria:** Enrichment jobs produce translated VTT files. Job state shows per-language results. Old translation service removed.

## System-Wide Impact

### Interaction Graph

1. `POST /api/jobs` → creates enrichment job → triggers `videoEnrichment` workflow
2. Workflow: transcription step → `translateSubtitles()` (replaces old translation step) → chapters/metadata/embeddings (unchanged)
3. `translateSubtitles()` → reads `transcript.json` artifact → chunks → fans out 50+ language translations → writes `subtitles-{lang}.vtt` + `translation-{lang}.json` artifacts → updates job step status
4. Each language translation → 2 OpenRouter LLM calls per chunk (creative translation + re-timing) → potential correction retry → potential deterministic fallback

### Error & Failure Propagation

- **OpenRouter API errors**: Caught per-language. After 3 retries (OpenRouter client default), language is marked failed. Other languages continue.
- **LLM output validation failures**: Caught per-chunk. Correction loop retries 1x. Then deterministic fallback. Never propagates to language failure unless the text itself is unusable.
- **Storage write failures**: Caught per-language. If VTT artifact write fails, language is marked failed.
- **Strapi state update failures**: Logged but not fatal. Pipeline continues. Dashboard may show stale state.

### State Lifecycle Risks

- **Concurrent artifact writes**: 10 languages write to S3 simultaneously. S3 handles this natively. Local fallback uses directory-per-asset, so writes to different files don't conflict.
- **Job step status updates**: Strapi v5's repeatable component limitation means read-then-write for the steps array. With concurrent language completions, the final step update should be a single write after all languages complete (not per-language updates).
- **Partial failure state**: The `languageResults` array captures the full picture. Step status summarizes it. No orphaned state.

### Integration Test Scenarios

1. **Happy path**: Video with 3 target languages. All translate successfully. Verify 3 VTT files + 3 JSON files in storage. Job status shows "completed" with 3 successful language results.
2. **Partial failure**: 2 of 3 languages succeed, 1 hits OpenRouter error. Verify 2 VTT files written. Job status "completed" with the failed language logged.
3. **Correction loop triggered**: Mock LLM re-timing to return overlapping times on first attempt. Verify retry fires, correction succeeds on second attempt.
4. **Deterministic fallback**: Mock LLM re-timing to always fail. Verify deterministic fallback produces valid VTT. No blank slots.
5. **Language geometry**: Test with Japanese target (compression — 4 source slots → 1-2 merged slots) and German target (expansion — verb bracket splitting). Verify merged/split slots respect 7s max.

## Acceptance Criteria

### Functional Requirements

- [x] Source VTT segments are chunked into 3-5 segment thought blocks at sentence boundaries
- [x] Creative translation produces fluent, natural translations with no structural constraints
- [x] LLM re-timing redistributes translated text across the source time window
- [x] Dynamic re-timing merges slots when translation compresses, splits when it expands
- [x] No single subtitle slot exceeds ~7 seconds
- [x] Correction loop retries invalid re-timing output once with error feedback
- [x] Deterministic fallback produces valid timing when LLM fails
- [x] One `subtitles-{lang}.vtt` artifact per target language
- [x] One `translation-{lang}.json` artifact per target language (full text)
- [x] 50+ target languages execute in parallel (10 concurrent)
- [x] Per-language failures are isolated — don't block other languages
- [x] Per-language custom prompts are injected when present
- [x] Per-language glossary terms are injected and respected in translations
- [x] Existing enrichment workflow continues to work with new translation step
- [ ] Job state tracks per-language results (succeeded/failed with errors)

### Non-Functional Requirements

- [ ] Pipeline cost ≤ ~$1.00 per video at 50 languages (Gemini Flash rates)
- [ ] No blank screens in any translated subtitle output
- [x] Structured JSON logging at every phase boundary for observability

### Quality Gates

- [x] Unit tests for chunker, retimer (including deterministic fallback), VTT utilities
- [x] Integration test for full pipeline with mocked LLM responses
- [x] Edge case tests: empty segments, single-segment chunks, very long segments

## Dependencies & Prerequisites

- Mux-generated VTT transcription (existing, unchanged)
- OpenRouter API access with Gemini 2.5 Flash (existing)
- Railway S3 storage (existing, ~50x more artifacts per video)
- `p-limit` package for concurrency control (new dependency)

## Risk Analysis & Mitigation

| Risk                                      | Likelihood | Impact                                | Mitigation                                                                         |
| ----------------------------------------- | ---------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| OpenRouter rate limiting at 50+ languages | Medium     | Reduces throughput                    | p-limit(10) concurrency cap; can tune down                                         |
| LLM re-timing quality varies by language  | Medium     | Degraded subtitles for some languages | Deterministic fallback guarantees valid output; per-language prompts can tune      |
| Cost higher than estimated                | Low        | Budget pressure                       | Gemini Flash is cheapest tier; chunking is algorithmic (free); can batch languages |
| Strapi step status race conditions        | Low        | Stale dashboard state                 | Single write after all languages complete, not per-language                        |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-28-subtitle-translation-pipeline-requirements.md](docs/brainstorms/2026-03-28-subtitle-translation-pipeline-requirements.md) — Key decisions carried forward: split-brain architecture over single-pass, dynamic re-timing over forced 1:1 mapping, LLM re-timing over algorithmic, replace existing translation step entirely.

### Internal References

- Existing translation service: `apps/manager/src/services/translation.ts` (to be replaced)
- VTT parsing utilities: `apps/manager/src/services/transcription.ts:parseVTT()` (to be extracted)
- LLM JSON validation: `apps/manager/src/lib/parseLLMJson.ts`
- Shared OpenRouter client: `apps/manager/src/services/openrouter.ts`
- Enrichment workflow: `apps/manager/src/workflows/videoEnrichment.ts`
- Job state management: `apps/manager/src/lib/state.ts`
- Storage service: `apps/manager/src/services/storage.ts`

### Institutional Learnings

- VideoForge manager integration patterns: `docs/solutions/platform/videoforge-manager-integration.md`
- Pipeline parallel execution: `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`
- S3 storage with local fallback: `docs/solutions/platform/optional-railway-s3-local-fallback.md`
- Strapi EnrichmentJob patterns: `docs/solutions/cms/strapi-enrichment-job-content-type.md`
