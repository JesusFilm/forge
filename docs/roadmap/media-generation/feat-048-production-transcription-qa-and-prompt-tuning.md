---
id: "feat-048"
title: "Production Transcription QA and Prompt Tuning"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-04-13"
duration: 18
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "quality"
---

## Problem

The enrichment pipeline now produces transcripts, but transcript quality still needs to be validated on real production video data before the workflow becomes the trusted default. We need a repeatable way to run representative production assets through transcription, inspect failures, and tighten prompts and normalization rules so subtitle quality improves instead of drifting.

## Entry Points — Read These First

1. `apps/manager/src/services/transcription.ts` — current transcription flow and artifact shape
2. `apps/manager/src/services/translation.ts` — downstream consumer that is sensitive to transcript quality
3. `apps/manager/src/services/metadata.ts` — prompt patterns already used for structured extraction
4. `apps/manager/src/workflows/videoEnrichment.ts` — orchestration flow for running transcription in the full job
5. `apps/manager/src/app/dashboard/jobs/[id]/page.tsx` — current operator view for inspecting job outputs
6. `apps/manager/src/services/storage.ts` — artifact persistence for before/after transcript comparisons

## Grep These

- `transcribeViaMux|generated_subtitles` in `apps/manager/src/services/`
- `role: "system"` in `apps/manager/src/services/`
- `artifactType` in `apps/manager/src/services/`
- `transcription|translation|metadata` in `apps/manager/src/workflows/videoEnrichment.ts`

## What To Build

1. Define a representative production-video QA set covering short clips, long-form content, multiple speakers, noisy audio, and multilingual edge cases.
2. Add a lightweight evaluation path that runs the QA set through the current transcription flow and saves transcript artifacts plus simple quality notes per asset.
3. Tighten the transcription-adjacent prompt and cleanup logic where it improves punctuation, line breaking, speaker transitions, proper nouns, and Bible-reference accuracy.
4. Record the top failure modes and the prompt or normalization changes that address them so follow-on model work has a baseline.
5. Keep the workflow compatible with `feat-031`; this ticket is for quality validation and tuning, not a provider swap.

## Constraints

- Do NOT commit raw production transcript payloads or sensitive video data into the repo.
- Do NOT change the pipeline contract in a way that breaks existing translation or metadata artifacts without an explicit migration note.
- Prefer deterministic cleanup rules over adding opaque post-processing prompts everywhere.

## Verification

- Run the QA set against the current transcription flow and save artifacts for review
- Confirm at least one before/after comparison shows measurable transcript quality improvement
- Re-run the same assets and confirm translation and metadata steps still succeed on the tuned transcript output
