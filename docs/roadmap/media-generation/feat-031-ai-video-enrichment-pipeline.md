---
id: "feat-031"
title: "AI Video Enrichment Pipeline"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-03-18"
duration: 31
depends_on:
  - "feat-030"
blocks:
  - "feat-035"
  - "feat-037"
  - "feat-038"
  - "feat-041"
  - "feat-048"
  - "feat-049"
  - "feat-050"
  - "feat-087"
  - "feat-106"
  - "feat-184"
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

Videos lacking metadata need AI-generated content — descriptions, titles, topics, thumbnails — to become discoverable and useful. A pipeline through AI generates this content to bring metadata to life, transforming raw videos into enriched, searchable content.

## Entry Points — Read These First

1. `apps/manager/src/workflows/videoEnrichment.ts` — the enrichment workflow orchestrator
2. `apps/manager/src/services/` — individual AI services (transcription, translation, embeddings)
3. `apps/manager/src/types/job.ts` — `WorkflowStepName`, `JobOptions`, enrichment types
4. `apps/manager/src/services/storage.ts` — artifact storage pattern for enrichment outputs
5. `apps/manager/src/lib/openrouter.ts` — shared AI model client

## Grep These

- `videoEnrichment\|WorkflowStep` in `apps/manager/src/` — enrichment workflow
- `generateVoiceover\|transcription\|translation` in `apps/manager/src/` — AI pipeline steps
- `uploadArtifact` in `apps/manager/src/` — S3 artifact storage
- `openrouter\|OpenRouter` in `apps/manager/src/` — AI model client usage

## What Was Built

1. Built the VideoForge AI video enrichment pipeline in `apps/manager/`.
2. Implemented workflow steps: transcription, translation, embedding generation.
3. Integrated with OpenRouter for AI model access.
4. S3 artifact storage for enrichment outputs (audio, text, metadata).
5. Job tracking with typed workflow step names and options.

**Still in progress:** Voiceover/TTS generation, additional enrichment steps, and scaling to the full video library.

## Verification

- `apps/manager/src/workflows/videoEnrichment.ts` — workflow file exists with step definitions
- `apps/manager/src/services/` — transcription, translation, and embedding services present
- Enrichment jobs can be triggered from the Manager dashboard
