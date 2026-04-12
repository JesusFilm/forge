---
title: "Manager ElevenLabs routing and rerun flow: durable provider state with non-destructive transcript promotion"
category: integration-issues
module: Manager
date: 2026-04-11
problem_type: integration_issue
component: workflow
symptoms:
  - "Manager could only transcribe through Mux, even when noisy media would benefit from ElevenLabs Voice Isolator + Scribe"
  - "Operators had no durable visibility into which transcription provider actually ran, why a fallback happened, or whether a rerun honored the requested provider"
  - "A transcription rerun risked either silently switching providers or destructively clearing downstream state without preserving the last successful canonical transcript/subtitles"
root_cause: missing_capability
resolution_type: code_fix
severity: high
tags:
  - manager
  - transcription
  - elevenlabs
  - mux
  - routing
  - rerun
  - workflow
  - artifacts
affected_components:
  - apps/manager/src/types/job.ts
  - apps/manager/src/lib/transcription-routing-report.ts
  - apps/manager/src/lib/state.ts
  - apps/manager/src/services/transcription.ts
  - apps/manager/src/services/elevenlabs-transcription.ts
  - apps/manager/src/workflows/videoEnrichment.ts
  - apps/manager/src/app/api/jobs/route.ts
  - apps/manager/src/app/api/enrich/route.ts
  - apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts
  - apps/manager/src/features/jobs/live-job-steps-table.tsx
related_docs:
  - docs/plans/2026-04-11-feat-elevenlabs-transcription-pipeline-plan.md
  - docs/roadmap/media-generation/feat-081-elevenlabs-transcription-pipeline.md
  - docs/solutions/platform/videoforge-manager-integration.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
---

# Manager ElevenLabs routing and rerun flow: durable provider state with non-destructive transcript promotion

## Problem

Manager's original transcription pipeline was Mux-only. That made the
enrichment workflow predictable, but it left no production path for
ElevenLabs Voice Isolator + Scribe, no durable provider audit trail, and no
operator-safe rerun path when QA wanted to compare Mux and ElevenLabs on the
same job.

The hard part was not just calling another API. The workflow needed explicit
rules for:

- when automatic routing is allowed to choose ElevenLabs
- how ElevenLabs failure is recorded without being mistaken for success
- how forced reruns avoid silently changing providers
- how to keep canonical `transcript` and `subtitles` artifacts stable for
  downstream translation, chapters, metadata, embeddings, and Mux sync

## Root Cause

The previous implementation had one transcription provider and therefore no
durable routing model.

- `transcription.ts` only knew how to resolve Mux subtitles into the canonical
  transcript contract.
- job state had no first-class place to store provider attempts, fallback
  reasons, or rerun provenance.
- rerun handling did not yet have a transcription-specific recovery path that
  could clear downstream derived artifacts without destroying the last known
  good transcript/subtitles pair.

This was a workflow-state gap more than an API-client gap.

## Solution

### Keep provider truth in a metadata artifact, not the canonical outputs

`apps/manager/src/lib/transcription-routing-report.ts` now owns a durable
`transcriptionRouting` metadata artifact that stores:

- the original ingest `sourceInputUrl`
- attempt history
- requested provider vs resolved provider
- fallback reasons
- final provider and final source language
- internal diarization summary

That lets the UI and rerun route reason about provider history without changing
the shape of `transcript.json` or `subtitles.vtt`.

### Route automatically only when source-language truth is concrete

`apps/manager/src/services/transcription.ts` now accepts a requested provider
mode:

- `automatic`
- `elevenlabs`
- `mux`

Automatic routing only chooses ElevenLabs when both of these are true:

1. the source language is concrete and supported
2. the original source input URL is available for ElevenLabs processing

Otherwise the job uses Mux directly. If an automatic ElevenLabs attempt fails
after being selected, the workflow records that failed attempt and fails the
job instead of quietly treating a Mux fallback as success.

Forced reruns do not silently switch providers:

- forced `elevenlabs` fails if it cannot run
- forced `mux` always stays on Mux

### Promote canonical transcript/subtitles only after success

The workflow keeps provider-attempt state separate from canonical artifact
promotion.

- failed ElevenLabs attempts do not overwrite the last successful canonical
  transcript/subtitles
- when ElevenLabs was required and did not complete, the workflow stops before
  promoting new canonical artifacts
- the transcription rerun route clears dependent downstream artifacts from
  transcription forward, but preserves the previous canonical transcript and
  subtitle artifacts until the new attempt succeeds

This mirrors the repo's existing non-destructive override and recovery pattern.

### Put rerun controls where operators already inspect step outcomes

`apps/manager/src/features/jobs/live-job-steps-table.tsx` now renders provider
summary pills, fallback notes, attempt cards, and explicit rerun buttons in the
transcription step detail row.

That keeps the operator workflow close to the persisted evidence:

- see which provider actually ran
- see why automatic fallback happened
- rerun with ElevenLabs or Mux from the same panel

## Verification

Targeted verification passed:

- `pnpm --filter @forge/manager test -- src/lib/transcription-routing-report.test.ts`
- `pnpm --filter @forge/manager test -- src/lib/state.test.ts`
- `pnpm --filter @forge/manager test -- src/services/transcription.test.ts`
- `pnpm --filter @forge/manager test -- src/services/elevenlabs-transcription.test.ts`
- `pnpm --filter @forge/manager test -- "src/app/api/jobs/[id]/transcription/rerun/route.test.ts"`
- `pnpm --filter @forge/manager test -- src/workflows/videoEnrichment.test.ts`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`

Browser smoke proof was captured with the real job-steps table component:

- `output/playwright/elevenlabs-routing-initial.png`
- `output/playwright/elevenlabs-routing-rerun.png`

The screenshots show the same transcription step panel before and after a real
rerun click:

- initial state: `Final: mux`, `Attempts: 2`
- rerun state: `Final: elevenlabs`, `Attempts: 3`

## Prevention

1. Treat `transcriptionRouting` as the single durable source of provider truth
   and rerun provenance.
2. Only let automatic routing choose a non-default provider when source-language
   truth is explicit and the required input surface exists.
3. Keep provider-specific diagnostics out of canonical transcript/subtitle
   outputs that downstream steps already consume.
4. For reruns of a foundational step, clear dependent artifacts first but do
   not destroy the last successful canonical outputs until replacement work
   succeeds.
5. Whenever a new override or rerun path is added, pair route-level safety
   checks with operator-visible evidence in the same UI surface.

## Related References

- [ElevenLabs transcription pipeline plan](../../plans/2026-04-11-feat-elevenlabs-transcription-pipeline-plan.md)
- [Roadmap ticket `feat-081`](../../roadmap/media-generation/feat-081-elevenlabs-transcription-pipeline.md)
- [VideoForge manager integration](../platform/videoforge-manager-integration.md)
- [Manager job read model source-language metadata](./manager-job-read-model-source-language-metadata-20260409.md)
- [Manager Mux subtitle override recovery](./manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md)
