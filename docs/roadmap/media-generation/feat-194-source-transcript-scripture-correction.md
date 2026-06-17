---
id: "feat-194"
title: "Source transcript scripture correction"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on:
  - "feat-193"
blocks: []
tags:
  - "manager"
  - "mastra"
  - "transcription"
  - "gospel-content"
  - "validation"
---

## Problem

Translated subtitle scripture validation does not inspect source transcription
artifacts. Bible-story ASR mistakes such as `Son, the demon` in a blind-man
healing story can pass into translation, chapters, metadata, embeddings, scene
analysis, and review before any scripture-aware validation runs.

## Entry Points - Read These First

1. `docs/plans/2026-06-16-003-feat-source-transcript-scripture-correction-plan.md`
   - implementation plan and scope boundary.
2. `docs/roadmap/media-generation/feat-193-subtitle-scripture-accuracy-validation.md`
   - translated subtitle validation and existing Mastra scripture patterns.
3. `apps/manager/src/services/transcription.ts`
   - current transcript and source-subtitle artifact writes.
4. `apps/manager/src/workflows/videoEnrichment.ts`
   - transcription ordering and downstream enrichment fan-out.
5. `apps/mastra/src/services/subtitle-enrichment/`
   - scripture-context, Bible-source, and validation patterns to reuse.
6. `apps/manager/src/features/jobs/live-job-steps-table.tsx`
   - operator-visible transcription and validation detail display.

## Grep These

- `transcript-correction`
- `structured_transcript`
- `SubtitleScripture`
- `transcribe(`
- `transcription/rerun`
- `review-context-refresh-key`

## What To Build

- Add a Mastra-owned source transcript scripture correction route that returns
  bounded correction findings for likely Bible-story transcription artifacts.
- Add Manager-side deterministic correction application for high-confidence
  exact segment matches.
- Preserve raw transcript/subtitle artifacts whenever canonical source
  artifacts are corrected.
- Write a correction report artifact that highlights applied and flagged
  findings for reviewer audit.
- Insert correction before translation, chapters, metadata, embeddings, and
  scene analysis consume transcript text.
- Surface compact correction status in Manager job details and review context.
- Prune stale correction artifacts on transcription reruns.

## Constraints

- Do not mutate human-authored source subtitles or Core/Admin canonical data.
- Do not retime, merge, or split source transcript segments in this slice.
- Do not block enrichment when correction is unavailable or inconclusive.
- Do not replace translated subtitle scripture validation.
- Do not log provider keys, raw prompts, hidden model reasoning, or full
  external Bible passage text.

## Verification

- `pnpm --filter @forge/mastra test -- subtitle-enrichment transcript-scripture-correction`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/manager test -- transcription videoEnrichment mastra-transcript-scripture-correction job-artifacts state load-job-review-context review-context-refresh-key`
- `pnpm --filter @forge/manager typecheck`
