---
title: "Manager Mux subtitle override: non-destructive replacement with resumable pending recovery"
category: integration-issues
module: Manager
date: 2026-04-10
problem_type: integration_issue
component: service_object
symptoms:
  - "Manual subtitle override could delete the only existing Mux subtitle track before the replacement was created"
  - "A request that died after persisting `override_pending` could strand the job in a state where the UI no longer offered a safe retry"
  - "Job state and Mux state needed a durable recovery path when override persistence or the external Mux mutation only partially completed"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - manager
  - mux
  - subtitles
  - override
  - recovery
  - reconciliation
  - state-machine
affected_components:
  - apps/manager/src/services/mux-sync/index.ts
  - apps/manager/src/services/mux-sync/index.test.ts
  - apps/manager/src/app/api/jobs/[id]/mux-sync/override/route.ts
  - apps/manager/src/app/api/jobs/[id]/mux-sync/override/route.test.ts
  - apps/manager/src/lib/mux-sync-override.ts
  - apps/manager/src/lib/mux-sync-override.test.ts
  - apps/manager/src/features/jobs/live-job-steps-table.tsx
related_docs:
  - docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
  - docs/solutions/cms/core-sync-incremental-delta-sync.md
  - docs/solutions/platform/videoforge-manager-integration.md
  - docs/plans/2026-03-28-002-feat-subtitle-translation-pipeline-plan.md
---

# Manager Mux subtitle override: non-destructive replacement with resumable pending recovery

## Problem

The first subtitle override implementation in Manager had two bad failure windows:

1. `applySubtitleOverride(...)` deleted the existing Mux subtitle track before it created the replacement track.
2. The route persisted `override_pending` before touching Mux, but an interrupted request could leave that pending state stranded with no recovery path.

That meant operators could lose the only subtitle track on a Mux asset, or get stuck with a completed job whose override button disappeared even though the operation had not actually finished.

## Root Cause

The override flow crossed an external side-effect boundary without a recoverable state model.

- The Mux writer assumed "replace" meant delete-first, then create.
- The route treated `override_pending` as a durable intermediate state, but it did not distinguish between a genuinely in-flight request and a stale interrupted one.
- The retry path still assumed an existing Mux subtitle track was present, so a failed delete-first attempt could not be safely resumed.

This was not a simple UI problem. It was an integration-state problem between Strapi job artifacts and Mux track mutation semantics.

## Solution

### Make the Mux replacement non-destructive

`apps/manager/src/services/mux-sync/index.ts` now performs override replacement in a create-first sequence:

- create a replacement subtitle track first
- use a deterministic temporary name while both tracks may coexist
- delete the original track only after the replacement exists
- rename the replacement back to the canonical subtitle label after the old track is gone

This removes the data-loss window where a failed create could leave the asset with fewer subtitle tracks than before the override began.

### Make `override_pending` resumable instead of terminal

`apps/manager/src/app/api/jobs/[id]/mux-sync/override/route.ts` and the new helper in `apps/manager/src/lib/mux-sync-override.ts` now treat pending override state as time-sensitive:

- a fresh `override_pending` comparison is treated as "already in progress"
- a stale `override_pending` comparison becomes resumable after `MUX_OVERRIDE_RESUME_AFTER_MS`
- retries rebuild the pending report, then continue the Mux-side work instead of permanently rejecting the job as "not overrideable"

This closes the wedge where a request crash could leave the job stranded forever.

### Make resumption idempotent enough to finish interrupted work

The Mux-side override writer now uses persisted comparison state plus current Mux tracks to recognize recovery cases:

- original track still exists: create replacement, then delete original
- temporary replacement exists already: finish deletion / rename work
- canonical replacement already exists and the original is gone: treat the replacement as the surviving override result

The key enabler is deterministic temporary track naming plus persisted `muxTrackId` from the prior comparison, which gives the resume path enough information to distinguish the old track from the in-progress replacement.

### Surface recovery behavior in the operator UI

`apps/manager/src/features/jobs/live-job-steps-table.tsx` now uses the same retryability rules as the route:

- fresh pending overrides do not show a second conflicting action
- stale pending overrides show `Resume override`
- failure / reconciliation states remain operator-visible through the persisted `muxSync` report

## Verification

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`

The regression coverage now explicitly includes:

- create-first override sequencing
- no delete when replacement creation fails
- stale pending override resumption
- fresh pending override rejection while a request is still in flight
- persisted failure / reconciliation reporting on route errors

## Prevention

1. Never delete external user-visible data before the replacement exists, unless the API guarantees rollback.
2. If an operation persists an in-progress state before calling an external service, define how that state becomes resumable after interruption.
3. Keep route retry gating and UI retry affordances on the same helper logic so operators do not see actions the backend will refuse.
4. For external replace operations, persist enough identifiers to distinguish "old object", "temporary replacement", and "final replacement" during recovery.
5. Add tests for interrupted-request recovery any time a route writes intermediate state before an external side effect.

## Related References

- [Mux subtitle sync plan](../../plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md)
- [Strapi enrichment job content type](../cms/strapi-enrichment-job-content-type.md)
- [Core sync incremental delta sync](../cms/core-sync-incremental-delta-sync.md)
- [VideoForge manager integration](../platform/videoforge-manager-integration.md)
- [Subtitle translation pipeline plan](../../plans/2026-03-28-002-feat-subtitle-translation-pipeline-plan.md)
