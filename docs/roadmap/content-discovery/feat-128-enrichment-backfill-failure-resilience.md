---
id: "feat-128"
title: "Enrichment backfill failure resilience"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-19"
duration: 1
depends_on:
  - "feat-126"
blocks: []
tags:
  - "admin"
  - "manager"
  - "ai-pipeline"
  - "reliability"
---

## Problem

The production full-catalog manager enrichment and admin scene-embedding backfill surfaced three distinct failure classes after `feat-126` fixed manager dispatch backpressure:

1. Manager scene-analysis triggers return `validation_failed` for catalog rows missing required dispatch fields, and should not require a pre-existing subtitle URL when a Mux asset can generate subtitles.
2. Manager transcript jobs can start but fail while waiting for Mux-generated subtitle tracks to become ready.
3. Admin scene-embedding backfill can fail individual locale targets on transient Prisma or OpenRouter response errors.

These failures need targeted resilience and operator visibility without conflating data-quality blockers with retryable runtime failures.

## Entry Points — Read These First

1. `apps/manager/src/lib/admin-trigger-route.ts` — manager admin-trigger receiver, validation classification, queue logs.
2. `apps/manager/src/lib/admin-video-lookup.ts` — manager-to-admin GraphQL lookup for dispatch fields.
3. `apps/manager/src/services/transcription.ts` — Mux subtitle readiness polling and transcript artifact production.
4. `apps/manager/src/workflows/transcriptOnlyPipeline.ts` — manager transcript-only artifact producer.
5. `apps/manager/src/workflows/sceneAnalysisPipeline.ts` — manager scene-analysis artifact producer.
6. `apps/admin/src/services/video.service.ts` — admin `videosByCoreIds` dispatch-field picker.
7. `apps/admin/src/services/scene-embedding.service.ts` — admin scene indexer, OpenRouter call, Prisma write transaction.
8. `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — per-target outcome shaping and report output.

## Grep These

```
grep -rn "validation_failed\\|missing required dispatch fields" apps/manager/src apps/admin/src
grep -rn "waitForReadySubtitleTrack\\|transcription_waiting_for_subtitles" apps/manager/src
grep -rn "SceneIndexError\\|storage_failed\\|Embedding response validation failed" apps/admin/src
grep -rn "scene_index_failed\\|run-embeds.scene.complete" apps/admin/src
```

## What To Build

1. Make manager validation failures more actionable and less over-strict:
   - Preserve `validation_failed` as a synchronous non-retryable result.
   - Include stable missing-field details that distinguish primary language and mux variant gaps.
   - Let scene-analysis and transcript jobs start without `subtitleUrl` when a Mux asset is available.
   - Keep response shape backward-compatible for admin callers.
2. Harden Mux transcript readiness:
   - Avoid treating a short-lived generated-subtitle wait as a final job failure when Mux is still preparing.
   - Add a retryable typed error or clearer runtime signal for subtitle readiness timeout.
   - Keep forced ElevenLabs behavior unchanged.
3. Harden admin scene embedding target retries:
   - Retry transient OpenRouter embedding response/request failures before marking a target failed.
   - Retry transient Prisma transaction/write failures (`P1017`, `P2028`) for the same target before surfacing `storage_failed`.
   - Keep artifact-invalid, permission, duplicate-scene, and empty-description errors non-retryable.
4. Improve reportability for operators:
   - Failed scene-embedding outcomes should retain sanitized error classes/codes.
   - The final report remains safe to paste: no URLs, keys, DB strings, vector literals, or raw provider response bodies.

## Constraints

- Do not mask missing mux catalog data as a retryable manager failure.
- Do not add CMS coupling to manager.
- Do not introduce required Railway env vars.
- Do not change generated GraphQL artifacts by hand.
- Do not broaden into `feat-127` durable job state or `feat-125` admin UI.
- Do not kill or mutate the currently running production scene backfill from this PR.

## Verification

- Manager tests prove validation failures name the missing dispatch fields and remain non-retryable.
- Manager transcription tests prove subtitle readiness timeout is classified/logged as retryable operational failure and longer waits remain bounded.
- Admin scene-embedding service tests prove transient Prisma `P1017`/`P2028` writes are retried and sanitized.
- Admin scene-embedding workflow/service tests prove transient embedding provider failures retry before producing `scene_index_failed`.
- Run:

```
pnpm --filter @forge/manager test -- src/lib/admin-trigger-route.test.ts src/app/api/admin-trigger/scene-analysis/route.test.ts src/app/api/admin-trigger/transcript/route.test.ts src/workflows/sceneAnalysisPipeline.test.ts src/workflows/transcriptOnlyPipeline.test.ts src/services/transcription.test.ts
pnpm --filter @forge/admin test -- src/services/scene-embedding.service.test.ts
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/admin typecheck
```
