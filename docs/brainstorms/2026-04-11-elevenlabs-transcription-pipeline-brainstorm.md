---
date: 2026-04-11
topic: elevenlabs-transcription-pipeline
---

# ElevenLabs Voice Isolator + Scribe Alternative Transcription Pipeline

## What We're Building

Add an optional ElevenLabs transcription path to the Manager enrichment workflow for hard-audio cases while preserving the current downstream contract. For source languages supported by ElevenLabs Scribe, Forge should run Voice Isolator first and then transcribe with Scribe. For languages ElevenLabs does not support, Forge should continue using the current Mux-generated subtitle path.

This is a selective alternative, not a full migration. The canonical outputs remain the same as today: `transcript.json` and `subtitles.vtt` should continue to feed subtitle translation, chapters, metadata, embeddings, storage, and Mux subtitle sync without requiring consumer changes. Operators also need a manual rerun path that can explicitly choose the transcription provider for a given job.

## Why This Approach

We considered keeping this work as a benchmark-only effort under the existing alternative-provider roadmap ticket, making ElevenLabs manual-only, and making ElevenLabs the default path for supported languages with a safe fallback. The recommended shape is selective default routing with manual override.

That gives the product a real quality improvement on noisy film audio without turning the whole pipeline into a provider migration. It preserves the current Mux path for unsupported languages, keeps the rest of the enrichment workflow stable, and still gives operators a concrete recovery and QA tool when they want to compare outputs or rerun a specific asset.

## Key Decisions

- Default provider routing is language-based: use ElevenLabs for source languages it supports, otherwise use Mux.
- Every ElevenLabs transcription job runs Voice Isolator before Scribe.
- If an ElevenLabs transcription run fails or times out, the same workflow run automatically falls back to Mux.
- Operators can manually rerun a job with an explicit provider selection per job.
- The public artifact contract stays unchanged in v1: downstream steps continue reading canonical transcript and subtitle artifacts rather than provider-specific formats.
- Diarization is captured internally during ElevenLabs transcription but is not exposed in subtitle output in v1.
- Speaker-aware subtitle output is deferred to a later feature.

## Resolved Questions

- Activation model: selective default routing with manual per-job override
- Diarization handling: capture internally only for v1
- Voice Isolator usage: always on for ElevenLabs jobs
- Failure behavior: automatic same-run fallback to Mux

## Open Questions

_(none - product decisions resolved)_

## Deferred to Planning

- Where ElevenLabs language support is defined and how it is updated safely
- How provider selection and rerun overrides are represented in job input, job state, and UI
- Whether ElevenLabs completion is handled by polling, webhook callbacks, or a hybrid flow inside the current workflow model
- Which audio source is sent to Voice Isolator and whether isolated audio is persisted or treated as ephemeral
- What internal artifact shape stores diarization, provider diagnostics, and fallback history without changing the current consumer contract
- What retry and timeout thresholds trigger Mux fallback

## Follow-up Feature

Speaker-aware subtitle output should be handled as a separate feature after this pipeline lands. This first milestone should retain diarization internally so later work can expose speaker labels without redoing transcription. The existing roadmap ticket [feat-050](../roadmap/media-generation/feat-050-speaker-attribution-for-subtitles.md) is the natural home for that follow-up.

## Next Steps

-> `/ce:plan` using this brainstorm plus the current manager pipeline in `apps/manager/src/services/transcription.ts` and `apps/manager/src/workflows/videoEnrichment.ts`
