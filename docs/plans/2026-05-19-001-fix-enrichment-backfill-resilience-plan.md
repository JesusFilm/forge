---
title: "fix: Enrichment backfill failure resilience"
type: fix
status: completed
date: 2026-05-19
origin: docs/roadmap/content-discovery/feat-128-enrichment-backfill-failure-resilience.md
---

# Enrichment Backfill Failure Resilience

## Overview

`feat-126` fixed manager dispatch backpressure, but the production rerun exposed three remaining failure classes with different ownership:

- Catalog dispatch fields are missing before manager can start scene-analysis.
- Transcript jobs start but can time out waiting for Mux-generated subtitle tracks.
- Admin scene embedding can fail per-locale targets on transient OpenRouter or Prisma write failures.

This plan hardens the retryable runtime paths, improves operator signals for non-retryable data blockers, and lets scene-analysis fall back to Mux transcription when admin has no subtitle URL but does have the required Mux asset.

## Scope Boundaries

- In scope: manager validation messaging, scene-analysis subtitle fallback from Mux, manager Mux subtitle timeout classification/wait behavior, admin scene embedding retries for transient provider/DB failures.
- Out of scope: durable manager job state from `feat-127`, full-catalog admin UI from `feat-125`, CMS job-store integration, production process control, data repair scripts for missing subtitles/mux variants.
- Existing trigger and report response shapes remain compatible.

## Requirements Trace

- **R1.** Scene-analysis `validation_failed` remains a synchronous non-retryable result for missing mux/language fields, but missing subtitle URL can fall back to Mux-generated subtitles.
- **R2.** Transcript runtime subtitle readiness timeouts are identifiable as retryable Mux readiness failures, not ambiguous generic dispatch errors.
- **R3.** Scene embedding retries transient OpenRouter embedding failures before recording a failed target.
- **R4.** Scene embedding retries transient Prisma write/transaction failures such as `P1017` and `P2028` before recording `storage_failed`.
- **R5.** Reports/logs remain safe to paste and do not expose secrets, URLs, vector literals, or raw provider bodies.

## Existing Patterns

- `apps/manager/src/lib/admin-trigger-route.ts` already classifies missing fields synchronously and logs queue events without secrets.
- `apps/manager/src/services/transcription.ts` already has a `TranscriptionExecutionError` carrying a routing report; new timeout classification should fit that style.
- `apps/admin/src/services/scene-embedding.service.ts` already remaps Prisma runtime errors through `sanitizePrismaErrorMessage`.
- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` already catches per-target errors and keeps the whole run alive.

## Implementation Units

### U1: Manager Validation Diagnostics

**Goal:** Make `validation_failed` outcomes maximally actionable without treating data blockers as retryable work.

**Files:**

- Modify `apps/manager/src/lib/admin-trigger-route.ts`
- Test `apps/manager/src/lib/admin-trigger-route.test.ts`
- Review `apps/admin/src/services/video.service.ts`

**Approach:**

- Keep the current `validation_failed` status and message contract.
- Ensure missing `primaryLanguageBcp47` and `muxAssetId` are reported independently.
- Treat missing `subtitleUrl` as dispatchable when a Mux asset and language are present.
- Add/adjust tests for missing primary language, missing mux, missing subtitle fallback, and missing mux/subtitle cascades.

**Verification:**

- `pnpm --filter @forge/manager test -- src/lib/admin-trigger-route.test.ts`

### U2: Mux Subtitle Readiness Classification

**Goal:** Avoid unnecessary Mux subtitle polling for admin-triggered transcript-only jobs while keeping Mux readiness failures explicit.

**Files:**

- Modify `apps/manager/src/services/transcription.ts`
- Modify `apps/manager/src/workflows/transcriptOnlyPipeline.ts` only if needed for logging/classification.
- Test `apps/manager/src/services/transcription.test.ts`

**Approach:**

- Pass the admin-selected `subtitleUrl` through transcript and scene-analysis admin-trigger dispatch.
- When transcript-only receives a subtitle URL, fetch and parse that existing VTT directly, then write the same transcript/subtitle artifacts before generating embeddings.
- Make admin-trigger validation kind-aware: both scene-analysis and transcript require mux + primary language; subtitle URL is optional fallback input.
- When scene-analysis receives no subtitle URL, call the existing Mux transcription path to produce transcript text before chapter/scene generation.
- Introduce a typed timeout error for `waitForReadySubtitleTrack` when Mux is still preparing after the bounded wait.
- Preserve existing hard failures for errored Mux assets/tracks and missing signing keys.
- Record routing-report failure details using the typed timeout message.
- Prefer a bounded configuration-free improvement: clearer classification and, if safe, a slightly more patient default for generated subtitles without adding required env.

**Verification:**

- Tests cover still-preparing timeout, errored track, ready-after-poll, and existing ElevenLabs routing behavior.
- `pnpm --filter @forge/manager test -- src/services/transcription.test.ts`

### U3: Admin Scene Embedding Transient Retries

**Goal:** Retry retryable provider and DB failures for a target before marking it failed.

**Files:**

- Modify `apps/admin/src/services/scene-embedding.service.ts`
- Modify `apps/admin/src/services/embeddings.service.ts` only if an exported error classifier is needed.
- Test `apps/admin/src/services/scene-embedding.service.test.ts`
- Test `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts` if workflow-level retry is chosen.

**Approach:**

- Add a small local retry helper around the provider call for transient embedding errors:
  - request timeout
  - request failed
  - response validation failed
  - length/dimension mismatch stays non-retryable unless investigation proves provider intermittency can return a valid second response.
- Add a small local retry helper around the Prisma transaction for `P1017` and `P2028`.
- Keep transaction bodies idempotent; rerun is safe because parent and locale writes use conflict-safe upsert/insert patterns.
- Preserve sanitized `SceneIndexError("storage_failed")` after retries exhaust.

**Verification:**

- Tests prove first-call transient embedding failure succeeds on retry without partial DB write.
- Tests prove `P1017`/`P2028` transaction errors retry and eventually succeed.
- Tests prove non-retryable artifact errors are not retried.
- `pnpm --filter @forge/admin test -- src/services/scene-embedding.service.test.ts`

## Sequencing

1. Land U1 first because it is low risk and clarifies operator output immediately.
2. Land U2 next because active transcript jobs are currently failing on Mux subtitle readiness.
3. Land U3 last because it touches admin DB write behavior and needs focused retry/idempotency tests.
4. Run package-level focused tests, then typecheck both touched apps.

## Risks

- Retrying provider calls increases OpenRouter usage for bad inputs. Keep retries small and only for transient classes.
- Longer Mux waits keep manager queue slots busy longer. Keep the queue cap from `feat-126` as the main pressure guard.
- Retrying Prisma transactions can amplify load if the DB is already unhealthy. Use a very small retry count with backoff and sanitized logs.

## Open Follow-Ups

- Repair missing catalog mux/primary-language data outside this PR, using the validation report as the input list.
- Retry failed production scene embedding targets after the current run completes.
- Durable manager job state remains tracked by `docs/roadmap/content-discovery/feat-127-manager-durable-admin-trigger-job-state.md`.
