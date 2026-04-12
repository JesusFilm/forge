---
id: "feat-081"
title: "ElevenLabs Voice Isolator + Scribe Transcription Pipeline"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-13"
duration: 21
depends_on:
  - "feat-031"
blocks:
  - "feat-050"
tags:
  - "manager"
  - "ai-pipeline"
  - "quality"
  - "subtitles"
---

## Problem

The current Forge transcription path is Mux-generated subtitles, which keeps the enrichment pipeline simple but struggles on noisy film audio, background music, and overlapping speakers. We need a production implementation of an alternative transcription path using ElevenLabs Voice Isolator + Scribe that improves subtitle quality for supported languages without breaking the existing transcript, subtitle, translation, or Mux-sync contracts.

## Entry Points — Read These First

1. `apps/manager/src/services/transcription.ts` — current Mux-first transcription flow and canonical transcript/subtitle artifact contract
2. `apps/manager/src/workflows/videoEnrichment.ts` — transcription step boundary and fallback/orchestration surface
3. `apps/manager/src/app/api/jobs/route.ts` — job creation path and rerun input shape
4. `apps/manager/src/app/dashboard/jobs/new-job-form.tsx` — operator controls for starting jobs and future provider selection
5. `apps/manager/src/types/job.ts` — job options, step names, and any provider/fallback audit metadata
6. `apps/manager/src/config/env.ts` — validated environment variable surface for ElevenLabs credentials and routing config
7. `apps/manager/src/services/storage.ts` — artifact persistence and any internal-only provider diagnostics or diarization artifacts
8. `apps/manager/src/lib/vtt.ts` — canonical segment and VTT conversion contract that downstream steps already consume
9. `docs/brainstorms/2026-04-11-elevenlabs-transcription-pipeline-brainstorm.md` — product decisions for provider routing, Voice Isolator usage, fallback, and diarization scope

## Grep These

- `transcribe|transcribeViaMux|waitForReadySubtitleTrack` in `apps/manager/src/services/`
- `stepTranscribe|runVideoEnrichment` in `apps/manager/src/workflows/videoEnrichment.ts`
- `new-job-form|rerun|JobOptions` in `apps/manager/src/`
- `artifactKeys|transcript|subtitles` in `apps/manager/src/`
- `env.` in `apps/manager/src/`

## What To Build

1. Add an ElevenLabs transcription path that runs Voice Isolator first and then Scribe for source languages supported by ElevenLabs.
2. Keep Mux as the default fallback for source languages ElevenLabs does not support.
3. If an ElevenLabs transcription run fails or times out, automatically retry the same workflow run through the existing Mux transcription path instead of failing the whole job immediately.
4. Preserve the current canonical artifact contract (`transcript.json` and `subtitles.vtt`) so translation, chapters, metadata, embeddings, storage, and Mux subtitle sync continue to work without same-PR consumer rewrites.
5. Add manual per-job rerun controls so an operator can explicitly choose the transcription provider when reprocessing an asset.
6. Capture ElevenLabs diarization internally in a durable internal artifact or job metadata shape, but do not expose speaker-aware subtitle output in this ticket.
7. Record provider selection, fallback reason, and final transcription source in job state so QA and operators can understand what actually happened.
8. Document a follow-up path for speaker-attributed subtitle output rather than folding it into this implementation.

## Constraints

- Do NOT replace Mux globally; this is a selective provider path with fallback, not a full migration.
- Do NOT break the current transcript/subtitle artifact contract consumed by subtitle translation and downstream enrichment steps.
- Do NOT require speaker-aware subtitle rendering or CMS schema changes in this ticket.
- Prefer a narrow provider abstraction around transcription routing over a monorepo-wide multi-provider framework.
- Keep external credentials and provider account setup out of the repo; all new env vars must be validated in manager config only.

## Verification

- Run manager unit tests covering provider routing, ElevenLabs success, unsupported-language fallback, and same-run failure fallback to Mux
- Confirm a supported-language job writes the same canonical transcript and subtitle artifacts the rest of the pipeline already expects
- Confirm an unsupported-language job skips ElevenLabs and succeeds through Mux
- Confirm an ElevenLabs failure or timeout falls back to Mux and records the fallback in job state or artifacts
- Confirm an operator can rerun a job with an explicit provider selection from the Manager UI or API without breaking the workflow
- Confirm diarization is captured internally while subtitle output remains compatible with existing consumers
