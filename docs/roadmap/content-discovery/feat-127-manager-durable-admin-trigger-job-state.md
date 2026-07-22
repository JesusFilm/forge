---
id: "feat-127"
title: "Manager durable admin-trigger job state for operator enrichment"
owner: "nisal"
priority: "P0"
status: "cancelled"
start_date: "2026-05-19"
duration: 2
depends_on:
  - "feat-126"
blocks:
  - "feat-125"
tags:
  - "manager"
  - "admin"
  - "ai-pipeline"
  - "operator-tools"
  - "reliability"
---

## Closure Decision

Cancelled on 2026-07-21. Durable admin-trigger job state was not delivered;
the current Manager trigger still uses process-local queue and in-flight state
that disappears on restart. This ticket is being shelved because its primary
consumer, the `feat-125` full-catalog operator surface, is also cancelled and
scene enrichment was retired. If broad enrichment triggering returns, durable
accepted-job state and restart semantics should be planned as part of that
current workflow rather than revived from this design unchanged.

## Problem

`feat-126` protects manager from stampeding Mux by moving admin-triggered transcript and scene-analysis dispatch into a bounded process-local queue. That fixes provider pressure for the immediate production backfill, but accepted work is still not durable: `started` means the current manager process accepted a job, not that a restart, deploy, or horizontal instance boundary can recover or report that job.

`feat-125` should not expose a broad operator UI that treats `started` as completed progress while manager has no durable accepted-job state. Until durable state exists, artifact presence in manager S3 remains the only reliable completion signal.

## Entry Points — Read These First

1. `apps/manager/src/lib/admin-trigger-route.ts` — current process-local queue, idempotency map, and response contract for `/api/admin-trigger/{scene-analysis,transcript}`.
2. `apps/manager/src/app/api/admin-trigger/transcript/route.ts` — transcript admin-trigger dispatcher.
3. `apps/manager/src/app/api/admin-trigger/scene-analysis/route.ts` — scene-analysis admin-trigger dispatcher.
4. `apps/manager/src/workflows/transcriptOnlyPipeline.ts` — transcript artifact producer.
5. `apps/manager/src/workflows/sceneAnalysisPipeline.ts` — scene-analysis artifact producer.
6. `apps/admin/src/services/manager-trigger.service.ts` — admin's outbound manager trigger client and outcome classifier.
7. `apps/admin/src/scripts/trigger-enrichment.ts` — current report-based trigger CLI that must remain compatible.
8. `docs/roadmap/content-discovery/feat-125-admin-full-catalog-manager-enrichment-trigger.md` — operator surface blocked on this durable state decision.

## Grep These

```
grep -rn "admin-trigger" apps/manager/src apps/admin/src
grep -rn "managerJobId\\|already_in_flight\\|STARTED" apps/manager/src apps/admin/src
grep -rn "scene-analysis.json\\|embeddings.json" apps/manager/src apps/admin/src
grep -rn "EnrichmentJob\\|job state\\|inFlight" apps/manager/src apps/cms/src apps/admin/src
```

## What To Build

Add durable manager-side accepted-job state for admin-triggered enrichment work.

1. Persist a job record when manager accepts admin-trigger work:
   - trigger kind: `scene-analysis` or `transcript`
   - `assetId`, `coreId`, and `managerJobId`
   - status at least: accepted/queued, running, completed, failed
   - timestamps for accepted, started, finished
   - retryable failure message or code when available
2. Keep the current `/api/admin-trigger/*` request/response contract backward-compatible for admin callers.
3. Preserve idempotency across process restarts and deploys by consulting durable state before accepting duplicate active `{kind, assetId}` work.
4. Decide and document the storage boundary:
   - prefer a manager-owned durable store if one exists
   - do not reintroduce CMS coupling for this admin-trigger path
   - if no manager-owned store exists, create the smallest manager-owned persistence path that fits current deploy constraints
5. Expose enough read state for `feat-125` to show operator progress without pretending `started` means complete.
6. Keep artifact existence as the final verification source of truth; durable job state is an operational progress layer, not a replacement for S3 artifact checks.

## Constraints

- Do not depend on CMS `EnrichmentJob` rows for this admin-trigger path.
- Do not break existing admin trigger scripts or mutation response parsing.
- Do not log subtitle URLs, API keys, bearer tokens, workflow keys, database URLs, or third-party credentials.
- Do not remove the process-local queue from `feat-126`; durable state complements the queue and restart semantics.
- Do not broaden into unrelated manager pipeline refactors.

## Verification

- Tests prove duplicate active jobs are rejected or reported as in-flight across a simulated process-local queue reset.
- Tests prove job state transitions through accepted/queued, running, completed, and failed.
- Tests prove existing `/api/admin-trigger/*` response shape remains compatible.
- Tests prove admin can read enough state for `feat-125` operator progress without relying on CMS.
- Run:

```
pnpm --filter @forge/manager test -- src/lib/admin-trigger-route.test.ts
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/admin typecheck
```
