---
id: "feat-125"
title: "Admin full-catalog manager enrichment trigger for scene analysis and transcripts"
owner: "nisal"
priority: "P0"
status: "cancelled"
start_date: "2026-05-19"
duration: 3
depends_on:
  - "feat-119"
  - "feat-126"
  - "feat-127"
blocks: []
tags:
  - "admin"
  - "manager"
  - "ai-pipeline"
  - "embeddings"
  - "operator-tools"
---

## Closure Decision

Cancelled on 2026-07-21. The mutation, CLI, catalog lookup, validation, and
Manager dispatch path were delivered, but the proposed full-catalog UI,
preflight experience, durable progress, retry controls, and audit trail were
not. Scene enrichment was subsequently retired, so the remaining work is not
being pursued under this ticket. Any future operator workflow should be scoped
afresh against the pipelines and data ownership that exist at that time.

## Problem

Admin's scene and transcript embedding backfills are downstream of manager artifacts:

- scene embeddings require manager's `{assetId}/scene-analysis.json`
- transcript embeddings require manager's `{assetId}/embeddings.json`

`feat-119` added a decoupled `triggerManagerEnrichment` GraphQL mutation and CLI, but the current operator flow is too manual for full-catalog readiness:

1. run an embed backfill
2. inspect `missingArtifacts`
3. trigger `scene-analysis` or `transcript` manually
4. handle max-100 batching by hand or script
5. rerun the embed backfill later

The production run on 2026-05-18 exposed the gap clearly: transcript missing artifacts could be triggered from a report, but scene-analysis missing artifacts had to be reconstructed from logs because the scene backfill was still running. The trigger outcome also showed many `VALIDATION_FAILED` items because manager's admin-trigger route requires dispatch fields from admin (`muxAssetId`, `subtitleUrl`, `primaryLanguageBcp47`) and there is no admin surface that previews these blockers before dispatch.

Operators need one admin-owned surface that runs against the entire video suite and triggers both upstream manager jobs deliberately, with batching, previews, status counts, retryable failure capture, and an audit trail.

## Entry Points — Read These First

1. `apps/admin/src/graphql/mutations/manager-enrichment.ts` — existing mutation that forwards paired `assetIds` + `coreIds` to manager's `/api/admin-trigger/{kind}` endpoints. Keep this mutation backward-compatible.
2. `apps/admin/src/services/manager-trigger.service.ts` — outbound admin-to-manager HTTP client and outcome classifier. Reuse its `STARTED`, `ALREADY_IN_FLIGHT`, `VALIDATION_FAILED`, `NOT_FOUND`, and `DISPATCH_FAILED` mapping.
3. `apps/admin/src/scripts/trigger-enrichment.ts` — existing CLI that consumes `missingArtifacts` reports. Its batching/report parsing behavior should inform the new full-catalog trigger implementation.
4. `apps/admin/src/services/video.service.ts` and `apps/admin/src/graphql/types/video.ts` — `videosByCoreIds` dispatch-fields projection consumed by manager. The new admin surface should reuse this shape for preflight validation.
5. `apps/manager/src/lib/admin-trigger-route.ts` — receiver for `/api/admin-trigger/{scene-analysis,transcript}`. It caps requests at 100 items, dedupes by assetId, and uses a process-local in-flight map.
6. `apps/manager/src/app/api/admin-trigger/scene-analysis/route.ts` — manager route that runs `runSceneAnalysisPipeline` and writes `scene-analysis.json`.
7. `apps/manager/src/app/api/admin-trigger/transcript/route.ts` — manager route that runs `runTranscriptOnlyPipeline` and writes `embeddings.json`.
8. `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` and `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — report shapes with `missingArtifacts`; useful for an optional "trigger only currently missing artifacts" mode.

## Grep These

```
grep -rn "triggerManagerEnrichment" apps/admin/src
grep -rn "trigger-enrichment" apps/admin/src/scripts
grep -rn "videosByCoreIds\\|VideoForEnrichment" apps/admin/src
grep -rn "admin-trigger" apps/manager/src
grep -rn "VALIDATION_FAILED\\|DISPATCH_FAILED\\|ALREADY_IN_FLIGHT" apps/admin/src apps/manager/src
grep -rn "scene-analysis.json\\|embeddings.json" apps/admin/src apps/manager/src
```

## What To Build

Build an admin operator surface that triggers both manager enrichment pipelines across the full video catalog.

### Surface

Add an admin dashboard page under the existing admin app, likely:

- `apps/admin/src/app/dashboard/embeddings/manager-enrichment/page.tsx`
- or an adjacent tab inside the existing embeddings dashboard if that is the local design pattern.

The surface must support:

1. **Full catalog mode** — enumerate every admin video that can be dispatched to manager, pair each row as `{ assetId, coreId }`, and trigger both kinds:
   - `kind: "scene-analysis"`
   - `kind: "transcript"`
2. **Missing-artifacts mode** — optionally accept/import a `run-embeds` report and trigger only its `missingArtifacts`.
3. **Preflight validation** before dispatch:
   - count total videos
   - count dispatchable videos
   - count videos missing `subtitleUrl`
   - count videos missing `muxAssetId`
   - count videos missing `primaryLanguageBcp47`
   - show samples for each blocker
4. **Batching**:
   - send at most 100 items per GraphQL/manager request
   - run scene-analysis and transcript as separate kind-specific batches
   - expose per-kind progress and final summaries
5. **Audit trail**:
   - persist a structured run record somewhere admin can read later
   - at minimum, store the operator-visible summary and raw outcomes as JSON; preferably use an admin DB table if one exists for operational runs
   - include start/end timestamps, operator id, kind, item counts, outcome counts, validation-failed samples, dispatch-failed samples, and retryable flags
6. **Retry affordance**:
   - allow retrying only `DISPATCH_FAILED` / retryable outcomes
   - do not blindly retry `VALIDATION_FAILED` until dispatch fields are fixed

### API shape

Prefer adding admin-native mutations rather than making the page call manager directly:

```ts
type ManagerEnrichmentFullCatalogKind = "scene-analysis" | "transcript" | "both"

type ManagerEnrichmentFullCatalogInput = {
  kind: ManagerEnrichmentFullCatalogKind
  mode: "full-catalog" | "missing-artifacts"
  dryRun?: boolean
  limit?: number
  coreIds?: string[]
}

type ManagerEnrichmentFullCatalogSummary = {
  kind: "scene-analysis" | "transcript"
  totalCandidates: number
  dispatchable: number
  started: number
  alreadyInFlight: number
  notFound: number
  validationFailed: number
  dispatchFailed: number
  missingMuxVariant: number
  missingSubtitle: number
  missingPrimaryLanguage: number
  retryableDispatchFailed: number
}
```

Implementation options:

1. Add a new mutation such as `triggerFullCatalogManagerEnrichment(input)` that performs preflight + batching server-side and returns a run id.
2. Add a query such as `managerEnrichmentRun(id)` so the dashboard can poll.
3. If a long-running GraphQL request would exceed Railway/proxy limits, enqueue a background job/run and return immediately with `{ runId }`.

### Full-catalog enumeration

Do not depend on CMS for the video list. Manager's admin-trigger route already gets dispatch fields from admin via `videosByCoreIds`; this surface should be admin-native too.

The full-catalog candidate set should come from admin's video database:

- include non-deleted videos with a stable `coreId`
- pair each `coreId` to the manager artifact `assetId`
- document clearly whether `assetId` is still CMS `videos.id` or has moved to an admin-native id
- if `assetId` still requires the core-id mapping snapshot, make the dependency explicit and validate the mapping before dispatch

### Logging

Use Railway-safe plain-string logs for request-path observability:

```
[manager-enrichment] event=batch_started kind=scene-analysis batch=3 count=100
[manager-enrichment] event=batch_complete kind=transcript batch=4 started=27 validation_failed=73 dispatch_failed=0
```

Do not emit JSON-shaped `console.log(JSON.stringify(...))` from Next.js route handlers; Railway logsV2 can silence or mangle those lines.

## Constraints

- Do not couple admin embeddings to manager enrichment automatically. This is an explicit operator-triggered surface, not an implicit side effect of `run-embeds`.
- Do not call manager directly from the browser. Browser actions go through admin GraphQL/server code so bearer tokens remain server-side.
- Do not exceed manager's 100-item request cap.
- Do not treat `VALIDATION_FAILED` as retryable. Missing subtitle/mux/primary-language data must be fixed upstream or excluded explicitly.
- Do not block on CMS `EnrichmentJob` records for idempotency. The admin-trigger route currently uses manager's in-memory in-flight guard; this ticket can add admin-side audit records, but should not assume manager writes `EnrichmentJob` for admin-trigger dispatch.
- Do not require a completed embed report for full-catalog mode.
- Do not hand-edit generated GraphQL env/type outputs; regenerate typed clients if schema changes require it.

## Verification

1. **Dry run**:
   - Open the admin surface in production-like env.
   - Run full-catalog dry-run.
   - Verify counts for total candidates, dispatchable, missing subtitle, missing mux variant, and missing primary language are non-zero and internally consistent.
2. **Scoped trigger**:
   - Run with `limit=5` or a small `coreIds` filter.
   - Verify both `scene-analysis` and `transcript` batches call manager and return outcome summaries.
   - Confirm manager receives `/api/admin-trigger/scene-analysis` and `/api/admin-trigger/transcript` requests.
3. **Batch cap**:
   - Unit/integration test with 201 candidates.
   - Verify three batches: 100, 100, 1.
4. **Validation preview**:
   - Include fixtures missing subtitle, mux variant, and primary language.
   - Verify they are counted before dispatch and reported as non-retryable.
5. **Retry**:
   - Simulate a manager 502 for one batch.
   - Verify outcomes are `DISPATCH_FAILED` with `retryable: true`.
   - Retry only those items and verify non-retryable validation failures are not resent.
6. **Audit trail**:
   - After a run, reload the page and verify the run summary/outcomes remain visible.
   - Verify raw secrets/bearer tokens are never persisted or logged.
7. **Production smoke**:
   - Trigger a small full-catalog sample in prod.
   - Verify manager writes at least one `{assetId}/scene-analysis.json` and one `{assetId}/embeddings.json`.
   - Re-run the corresponding admin embed backfill for those coreIds and verify the prior `artifact_missing` skips become successful embeds.
