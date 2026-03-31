---
id: "feat-014"
title: "Voiceover / Text-to-Speech Service"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-04-14"
duration: 28
depends_on: []
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
---

## Entry Points — Read These First

1. `apps/manager/src/types/job.ts` — search for `voiceover`: `WorkflowStepName` already includes it, `JobOptions.generateVoiceover` exists
2. `apps/manager/src/services/transcription.ts` — `TranscriptionResult` type (input for primary language voiceover)
3. `apps/manager/src/services/translation.ts` — `TranslationResult` type (input for translated voiceovers)
4. `apps/manager/src/workflows/videoEnrichment.ts` — workflow to add voiceover step
5. `apps/manager/src/services/storage.ts` — artifact storage pattern: `uploadArtifact(assetId, 'voiceover-en.mp3', buffer)`
6. `apps/cms/src/api/language-audio-preview/content-types/language-audio-preview/schema.json` — audio content type with `codec`, `bitrate`, `duration`, `size` fields

## Grep These

- `generateVoiceover` in `apps/manager/` — already typed in job options
- `"voiceover"` in `apps/manager/src/types/` — workflow step name exists
- `getOpenrouter` in `apps/manager/src/lib/openrouter.ts` — shared client, check if TTS endpoint is available
- `uploadArtifact` in `apps/manager/src/services/storage.ts` — S3 write pattern

## What To Build

1. New file: `apps/manager/src/services/voiceover.ts`

   ```typescript
   export type VoiceoverResult = {
     language: string
     audioUrl: string // S3 artifact URL
     duration: number // seconds
     size: number // bytes
     codec: string // e.g. "mp3"
     model: string // TTS model used
   }

   export async function generateVoiceover(
     assetId: string,
     text: string,
     language: string,
   ): Promise<VoiceoverResult>
   ```

2. Evaluate TTS provider — check OpenRouter for TTS endpoints first (consistent with existing pattern). Fallback options: ElevenLabs API, Google Cloud TTS. Choose ONE.

3. Wire into `videoEnrichment.ts` as a new step after translation. Only runs when `options.generateVoiceover === true`.

4. Store artifacts as `{assetId}/voiceover-{lang}.mp3` in S3.

5. Update `EnrichmentJob` artifact tracking to include voiceover outputs.

## Constraints

- Do NOT add voiceover to the default enrichment flow. It should only run when explicitly requested via `generateVoiceover: true`.
- Do NOT build a voice selection UI yet. Use a single default voice per language.
- Ministry context — the voice tone must be appropriate. If the provider supports voice selection, choose a neutral, warm tone.
- Follow the exact same error handling pattern as `apps/manager/src/services/translation.ts`.

## Verification

- Call `generateVoiceover(testAssetId, "This is a test.", "en")` — returns `VoiceoverResult` with valid S3 URL
- Download the audio from S3 — it's playable MP3
- Run enrichment with `generateVoiceover: true` — voiceover step completes, artifacts tracked in job

## Success Criteria

- Audio files generated for primary language transcript
- Audio files generated for translated languages
- Artifacts in S3 at `{assetId}/voiceover-{lang}.mp3`
- EnrichmentJob tracks voiceover artifacts
