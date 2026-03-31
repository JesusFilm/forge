---
date: 2026-03-28
topic: ai-voiceover
---

# AI Voiceover for Media Enrichment

## Problem Frame

JFP's media enrichment pipeline already generates transcripts, translations, chapters, metadata, and embeddings — but has no voiceover capability. The `voiceover` step exists as a placeholder in the job types and UI, with no implementation behind it. Managers need to generate AI voiceovers across many languages using external TTS providers, with the ability to swap providers when quality doesn't meet expectations for a given language or video.

## Requirements

- R1. **Provider adapter pattern** — Support multiple external Cloud TTS providers (e.g., ElevenLabs, Google Cloud TTS, Amazon Polly, Azure Speech) behind a common adapter interface. Each adapter handles authentication, voice catalog access, and audio generation for its provider.

- R2. **Smart provider selection** — System automatically selects the best provider for a given language based on a configurable language-to-provider mapping. Manager only intervenes if unhappy with the result.

- R3. **Provider override on re-run** — When a manager is unsatisfied with a voiceover result, they can re-run the voiceover step with a different provider selected explicitly. This replaces the previous result.

- R4. **Voice selection with defaults** — System uses a sensible default voice per language/provider combination. Manager can override the voice choice when creating or re-running a voiceover job.

- R5. **Context-aware input text** — Voiceover uses the translated text for dubbed (non-source) languages, and the original transcript for source-language voiceover.

- R6. **Full-video audio generation** — Generate one continuous audio track from the full script. Segment-level (per-cue) generation is out of scope for this iteration.

- R7. **Artifact storage** — Store generated audio files to S3 using the existing `writeArtifact()` pattern (Railway S3 with local fallback).

- R8. **Draft VideoVariant creation** — After successful generation, automatically create a VideoVariant in CMS as a draft with:
  - `source: "manager"` (AI-generated indicator)
  - `aiGenerated: true`
  - Generation metadata: model/provider used, generation date, voice ID

- R9. **CMS schema updates** — Add `"voiceover"` to the EnrichmentJob step enum. Extend VideoVariant or add a related component to store generation metadata (provider, model, voice, generated date).

- R10. **Provider credential management** — Provider API keys configured via environment variables (Railway service settings), not hardcoded. Each provider adapter reads its own credentials from env.

## Success Criteria

- Manager can trigger voiceover generation for any language supported by at least one configured provider
- Manager can re-run voiceover with a different provider and see the new result replace the old one
- Generated audio is stored as an S3 artifact and a draft VideoVariant is created in CMS with full generation metadata
- Adding a new TTS provider requires only implementing the adapter interface and adding configuration — no changes to the orchestration or UI

## Scope Boundaries

- **In scope:** Full-video voiceover, multi-provider support, smart defaults, re-run with override, draft variant creation
- **Out of scope:** Segment-level / per-cue TTS with timing alignment (future enhancement)
- **Out of scope:** Side-by-side provider comparison UI (future enhancement)
- **Out of scope:** Audio post-processing (noise reduction, normalization, mixing with original audio)
- **Out of scope:** Automatic lip-sync or video re-rendering

## Key Decisions

- **Cloud TTS APIs over OpenRouter:** Unlike other enrichment services that use OpenRouter for LLM calls, voiceover uses dedicated TTS provider APIs (ElevenLabs, Google Cloud TTS, etc.) which offer purpose-built voice catalogs and audio generation.
- **Smart defaults over explicit selection:** Reduces friction for the common case. Provider/voice selection is automatic based on language, with manual override available.
- **Re-run over side-by-side:** MVP keeps it simple — manager listens, decides, and can re-run with a different provider. No need for parallel generation or comparison UI yet.
- **Draft variants:** Generated voiceovers are created as drafts, giving managers a review step before content goes live.
- **Full-video first:** Narration-style continuous audio is simpler and covers the primary use case. Segment-level timing adds significant complexity better addressed as a follow-up.

## Dependencies / Assumptions

- Translation step must complete before voiceover can run for non-source languages (pipeline ordering dependency)
- Transcription step must complete before voiceover can run for source language
- At least one TTS provider must be configured (API key in env) for voiceover to be available
- Provider language support catalogs may need periodic updating as providers add languages

## Outstanding Questions

### Resolve Before Planning

(None — all product decisions resolved)

### Deferred to Planning

- [Affects R1][Needs research] Which TTS providers to implement first? Likely ElevenLabs (broad language support, high quality) as the initial adapter, with others added incrementally.
- [Affects R2][Technical] How to structure the language-to-provider mapping — config file, CMS content type, or env-based JSON? Planner should evaluate trade-offs.
- [Affects R4][Needs research] How to discover and cache available voices per provider — API call at startup, periodic refresh, or static mapping?
- [Affects R8][Technical] Whether to extend the existing VideoVariant schema or add a new `generation-metadata` component for storing provider/model/voice info.
- [Affects R9][Technical] Whether the CMS EnrichmentJob step enum migration can be a simple addition or requires a data migration for existing jobs.

## Next Steps

→ `/ce:plan` for structured implementation planning
