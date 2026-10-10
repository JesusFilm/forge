---
id: "feat-035"
title: "Manager Pipeline Transparency Workspace"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-05-12"
duration: 21
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "quality"
---

## Problem

The current manager UI shows step status and artifacts, but it does not explain why an output should be trusted. Operators need a per-video workspace for inspecting transcription, translation, metadata, and audio outputs with provenance, quality hints, and retry controls.

## Entry Points — Read These First

1. `apps/manager/src/features/coverage/coverage-report-client.tsx` — existing report type model and language/report switching
2. `apps/manager/src/features/jobs/live-job-detail-header.tsx` — current video/job summary shell and Mux watch link
3. `apps/manager/src/features/jobs/live-job-steps-table.tsx` — artifact lists, step descriptions, and status rendering
4. `apps/manager/src/workflows/videoEnrichment.ts` — step orchestration and artifact emission points
5. `apps/manager/src/services/transcription.ts`, `apps/manager/src/services/translation.ts`, `apps/manager/src/services/metadata.ts`, `apps/manager/src/services/storage.ts` — artifact generation and storage contracts

## Grep These

- `REPORT_CONFIG|ReportType` in `apps/manager/src/features/coverage/coverage-report-client.tsx`
- `subtitlesVtt|subtitlePostProcessManifest|voiceover|artifactManifest` in `apps/manager/src/features/jobs/`
- `uploadArtifact|downloadArtifact` in `apps/manager/src/services/`
- `transcription|translation|metadata|voiceover` in `apps/manager/src/workflows/videoEnrichment.ts`

## What To Build

1. New route: `apps/manager/src/app/dashboard/pipeline/[id]/page.tsx`
   - Loads one video/job and renders stage-specific sections for Transcription, Translation, Metadata, and Audio.
2. New UI module: `apps/manager/src/features/pipeline/`
   - Provenance panel with source language, provider/model, timestamps, verification state, and step status.
   - Stage-specific viewers for transcript cues, translation diffs, metadata JSON/preview, and audio artifacts.
3. Add quality surfacing:
   - Highlight cue gaps, low-confidence transcript spans, missing target languages, and failed artifact generation.
4. Add operator controls:
   - Re-run failed/suspect stages from the transparency page without returning to the queue list.

## Constraints

- Reuse existing artifacts in storage for the first iteration. Do NOT invent a parallel persistence model.
- Do NOT build full subtitle or metadata editing here; this is inspect-and-retry, not authoring.
- Follow existing manager dashboard patterns. Do NOT introduce a new UI framework.

## Verification

- Open `/dashboard/pipeline/[job-id]` for a completed job and inspect all stages from one page.
- A translation failure shows the failing stage, the current artifact state, and a retry action.
- Transcript artifacts render readable cue-level detail instead of a raw blob download only.
- Language switching updates the inspected output without a full page navigation.
