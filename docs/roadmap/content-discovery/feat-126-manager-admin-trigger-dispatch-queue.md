---
id: "feat-126"
title: "Manager admin-trigger dispatch queue for enrichment backfills"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-19"
duration: 1
depends_on:
  - "feat-119"
blocks:
  - "feat-127"
  - "feat-125"
tags:
  - "manager"
  - "admin"
  - "ai-pipeline"
  - "operator-tools"
  - "reliability"
---

## Problem

The production enrichment trigger run on 2026-05-18 showed that manager accepted many transcript-only artifact jobs as `STARTED`, but only a subset produced `{assetId}/embeddings.json`. Manager Railway logs showed repeated Mux `429 Too many requests` errors during the same burst.

The admin-trigger receiver currently schedules one background callback per accepted item. When admin sends full batches, manager fans out Mux-heavy transcript work immediately. `STARTED` therefore means "accepted for background dispatch", not "durably queued" or "will run under provider-safe concurrency".

## Entry Points — Read These First

1. `apps/manager/src/lib/admin-trigger-route.ts` — shared receiver for `/api/admin-trigger/{scene-analysis,transcript}`. It validates, dedupes, tracks process-local in-flight entries, and schedules background dispatches.
2. `apps/manager/src/app/api/admin-trigger/transcript/route.ts` — wires transcript requests to `runTranscriptOnlyPipeline`.
3. `apps/manager/src/app/api/admin-trigger/scene-analysis/route.ts` — wires scene requests to `runSceneAnalysisPipeline`.
4. `apps/manager/src/workflows/transcriptOnlyPipeline.ts` — transcript-only artifact producer; calls Mux transcription first, then writes embeddings.
5. `apps/manager/src/services/transcription.ts` — Mux subtitle polling/fetch path that hit rate limits in production.
6. `apps/manager/src/lib/admin-trigger-route.test.ts` — shared receiver tests.
7. `apps/manager/src/app/api/admin-trigger/transcript/route.test.ts` and `apps/manager/src/app/api/admin-trigger/scene-analysis/route.test.ts` — route integration tests.

## Grep These

```
grep -rn "processAdminTriggerRequest" apps/manager/src
grep -rn "admin-trigger.dispatch" apps/manager/src
grep -rn "transcript_only_pipeline" apps/manager/src
grep -rn "ADMIN_TRIGGER" apps/manager/src/config apps/manager/CLAUDE.md
grep -rn "429\\|rate" apps/manager/src/services
```

## What To Build

Add bounded manager-side dispatch for admin-triggered enrichment pipelines.

1. Replace per-item immediate `after()` fan-out with a process-local queue shared by `/api/admin-trigger/scene-analysis` and `/api/admin-trigger/transcript`.
2. Process queued jobs with a conservative concurrency cap so one admin request cannot stampede Mux.
   - Default this slice to a hardcoded cap of 3 concurrent dispatches per manager process.
   - Treat the cap as a per-process guardrail, not a durable cross-instance provider limit. During the immediate prod backfill, assume manager is running as a single active instance; cross-instance concurrency control belongs to a follow-up if Railway is scaled horizontally.
   - Validate the cap operationally by watching manager logs for Mux 429s on the next small retry before re-firing large transcript batches.
3. Keep the existing response contract:
   - accepted items still return `started`
   - validation failures remain synchronous per item
   - `already_in_flight` still protects duplicate asset/kind requests
4. Bound total pending manager work as well as active concurrency:
   - reject new trigger requests with a retryable 503 when the process-local pending queue is full
   - do not partially accept a request when the queue has no capacity
   - keep this as a manager backpressure signal, not a new per-item result status
5. Keep the queue in process memory for this slice. Durable cross-deploy status belongs to a follow-up unless implementation finds a small existing local pattern.
   - `started` in this slice means accepted by the current manager process, not durably persisted
   - feat-125 must not present `started` as completed progress; artifact existence remains the completion signal until durable job state exists
6. Keep queued/running idempotency entries alive until dispatch settles. Do not let the legacy 5-minute TTL prune jobs that are still queued or running.
7. Keep the queue runner attached to Next `after()` lifecycle. A request's scheduled background task must await the queued jobs it accepted through settlement instead of enqueueing detached promises and returning immediately.
8. Add log breadcrumbs that distinguish accepted, queued, started-running, completed, rejected-queue-full, and failed queued jobs without logging secrets.
9. Make the cap configurable by optional env var only if needed; default behavior must boot without new required Railway variables.

## Constraints

- Do not create or depend on CMS `EnrichmentJob` rows for this admin-trigger path.
- Do not broaden into the admin operator UI from `feat-125`.
- Do not change the public request/response shape of `/api/admin-trigger/*`.
- Do not hand-edit generated GraphQL outputs.
- Do not make a new required env var that could break Railway boot.
- Do not solve durable accepted-job semantics in this PR; create a follow-up if feat-125 needs durable progress state before broad operator rollout.

## Verification

- Focused tests prove that multiple accepted items are queued and only the configured number run concurrently.
- Tests prove that separate trigger requests and mixed transcript/scene-analysis requests share the same queue cap.
- Tests prove queue-full backpressure returns a retryable 503 without accepting more work.
- Tests prove the in-flight slot is retained while a queued/running job is outstanding and released after completion or failure.
- Tests prove queued/running jobs are not pruned by stale wall-clock TTL while dispatch is unresolved.
- Tests prove scheduled `after()` work remains pending until the accepted queued jobs settle.
- Tests prove synchronous validation failures still return without queueing work.
- Run:

```
pnpm --filter @forge/manager test -- src/lib/admin-trigger-route.test.ts src/app/api/admin-trigger/transcript/route.test.ts src/app/api/admin-trigger/scene-analysis/route.test.ts
pnpm --filter @forge/manager typecheck
```
