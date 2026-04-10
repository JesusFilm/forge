---
date: 2026-03-28
topic: subtitle-translation-pipeline
---

# AI-Powered Subtitle Translation Pipeline

## Problem Frame

JFP distributes video content to 50+ languages. The current manager pipeline translates only the full transcript as a text blob — it produces no timed subtitle files for translated languages. To serve translated subtitles in the video player, a new pipeline is needed that handles the "geometry of language" problem (where different languages compress, expand, or reorder content relative to the source) without producing blank screens or broken timing.

The core tension: LLMs optimized for fluency break the structural contract that subtitle timing grids depend on. A speaker's four lines of filler become one clean Japanese sentence. German verb brackets resist mid-sentence splitting. One-to-one line mapping is structurally impossible for many of JFP's 50+ target language pairs.

## Requirements

- R1. **Replace existing translation step** — The new subtitle translation pipeline replaces the current full-text translation step in the video enrichment workflow. It produces both timed subtitle files (VTT) and full translated text per language.

- R2. **Split-brain architecture** — Separate creative translation from structural re-timing into distinct LLM calls, following Vimeo's proven pattern. Never ask a single prompt to be both fluent and structurally compliant.
  - **Phase 1: Smart Chunking** — Group source VTT segments into logical thought blocks of ~3-5 segments based on sentence boundaries, ensuring the LLM always sees a complete thought.
  - **Phase 2: Creative Translation** — Translate each chunk purely for meaning with zero structural constraints. The LLM is free to handle verb brackets, reorder syntax, and compress filler naturally.
  - **Phase 3: LLM Re-timing** — A separate LLM call re-distributes the translated text across the original time window for that chunk.

- R3. **Dynamic re-timing over forced slot-filling** — When a translation compresses content (e.g., 4 English lines → 1 Japanese sentence), merge adjacent subtitle slots into fewer, longer slots rather than repeating text or leaving blanks. When translation expands, split at natural language boundaries. No single subtitle slot should exceed ~7 seconds on screen; if a merged slot would exceed this, split the translated text across multiple slots within that time range.

- R4. **Correction loop** — When Phase 3 re-timing produces invalid output (overlapping times, text outside the chunk's time window, etc.), retry with explicit error feedback.

- R5. **Deterministic fallback** — When the correction loop fails, a rule-based algorithm takes over to produce valid subtitle timing. Every chunk must reach the user in a valid state — no blank screens, no silent failures.

- R6. **Translated VTT output** — Produce one WebVTT subtitle file per target language, stored as an artifact (`subtitles-{lang}.vtt`). Also store the full translated text as a derived artifact (`translation-{lang}.json`) for metadata/search use.

- R7. **Parallel language execution** — Fan out translations across 50+ target languages concurrently. Each language's 3-phase pipeline runs independently.

- R8. **Preserve workflow interface** — The new pipeline fits into the existing `videoEnrichment` workflow as a replacement for the current translation step. Same input contract (jobId, assetId, source language, target languages). Same artifact storage patterns.

- R9. **Graceful language-level failure** — If translation completely fails for a target language (API errors, unsupported language, repeated LLM failures), skip that language and log the failure in job status. Do not block other languages. Do not produce a partial or placeholder VTT.

- R10. **Optional per-language custom prompts** — Each target language can have an optional custom prompt that supplements the default system prompts across all pipeline phases. When present, it's injected into creative translation (Phase 2) and re-timing (Phase 3) to guide language-specific behavior — register, dialect, terminology, display preferences, etc. When absent, the pipeline uses defaults only. Examples: "use simplified Chinese characters," "use formal register for Korean," "prefer shorter subtitle lines for Arabic RTL display."

- R11. **Per-language vocabulary/glossary** — Each target language can have an optional glossary of term mappings (source term → target translation) injected into the creative translation phase (Phase 2). Glossary entries take precedence over the LLM's default translation choices. Designed for domain-specific terms that LLMs consistently mistranslate: proper names, theological vocabulary, organization-specific terms, and transliterations. When no glossary exists for a language, the pipeline uses the LLM's default translations.

## Success Criteria

- Translated subtitles never show blank screens during active speech
- Subtitle timing feels natural — no jarring jumps from merged/split slots, no single subtitle exceeds ~7 seconds
- Translation quality is high across structurally diverse languages (Japanese, Arabic, Hindi, German, Mandarin) — not just European languages
- Pipeline completes reliably for 50+ languages per video without manual intervention
- Full translated text remains available for search/metadata use cases

## Scope Boundaries

- **In scope:** Subtitle translation pipeline for the manager app, replacing the current translation step
- **Not in scope:** Transcription changes (Mux transcription stays as-is), video player subtitle rendering, CMS content type changes, subtitle editing UI
- **Not in scope:** Real-time/streaming translation — this is batch processing triggered by enrichment jobs
- **Not in scope:** Translation memory (automatic learning from past translations)

## Key Decisions

- **Split-brain over single-pass:** Research (Tam et al.) confirms format constraints degrade LLM reasoning quality. At 50+ languages, this quality gap compounds. Three focused passes outperform one constrained pass.
- **Dynamic re-timing over forced 1:1 mapping:** Merging/splitting slots produces more natural translated subtitles than Vimeo's approach of repeating phrases to fill empty slots. Better UX at the cost of translated VTT having different segment counts than the source.
- **Replace rather than complement:** The new pipeline subsumes the current full-text translation — no need to run both. Full text is derivable from translated segments.
- **LLM re-timing over algorithmic re-timing:** At 50+ diverse languages, LLM-driven line breaking produces more natural results than character-ratio algorithms, especially for languages with no word boundaries (CJK) or right-to-left scripts. The extra LLM call is justified by the quality requirement.

## Dependencies / Assumptions

- Mux-generated VTT transcription remains the source input (no changes to transcription step)
- OpenRouter continues to be the LLM provider; model selection deferred to planning
- Railway S3 storage has sufficient capacity for ~50x more subtitle artifacts per video
- The workflow SDK (or plain async execution) can handle fanning out to 50+ parallel language pipelines

## Outstanding Questions

### Resolve Before Planning

_(none — all product decisions resolved)_

### Deferred to Planning

- [Affects R2][Needs research] Which LLM models are best suited for creative translation vs structural re-timing? (creative may need a larger model; re-timing may work with a faster/cheaper one)
- [Affects R2][Technical] What is the optimal chunk size (3-5 segments)? Should it vary by source language density?
- [Affects R3][Technical] How should merged subtitle slots handle the time boundaries? Extend the first slot's end time to cover the merged range? Or create a new slot spanning the full range?
- [Affects R4][Technical] How many correction retries before escalating to fallback? Vimeo uses 1 retry.
- [Affects R7][Technical] What parallelism limits should apply? Rate limiting against OpenRouter, memory constraints, etc.
- [Affects R7][Needs research] Cost estimation: at 3 LLM calls × N chunks × 50+ languages, what is the per-video cost? Which model tiers keep this viable?
- [Affects R2][Technical] Should the smart chunking phase be LLM-driven or algorithmic? Sentence boundary detection may suffice without an LLM call.
- [Affects R6][Technical] Should translated VTT files include metadata headers (language, source video, generation timestamp)?
- [Affects R10, R11][Technical] Where should per-language custom prompts and glossaries be stored? Candidates: Strapi CMS (language config content type), config file in the manager app, or passed as part of enrichment job input.
- [Affects R11][Technical] How should glossary terms be injected into the prompt? As a structured list in the system prompt, as few-shot examples, or as explicit find-and-replace post-processing?

## Next Steps

→ `/ce:plan` for structured implementation planning
