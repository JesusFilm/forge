---
id: "feat-087"
title: "Manager Agent Dry-Run Mode"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-14"
duration: 5
depends_on: []
blocks: []
tags:
  - "manager"
  - "cms"
  - "ai-pipeline"
---

## Problem

Manager agents can run on a schedule and enqueue real enrichment work, but operators need a safe dry-run mode before allowing an agent to mutate canonical data. Today the automation runner crosses from eligibility into job creation and workflow dispatch, which can lead to CMS sync/index writes and Mux subtitle mutations downstream.

Add a dry-run mode so an operator can launch an agent and get a durable artifact report of what would have happened without updating canonical CMS data or pushing data to Mux.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-13-manager-agent-dry-run-mode-brainstorm.md` — chosen product shape and default dry-run semantics.
2. `docs/brainstorms/2026-04-12-manager-agents-automations-requirements.md` — existing agents and scheduler product baseline.
3. `apps/manager/src/features/agents/automation-contract.ts` — current automation, run, schedule, template, and refresh-mode types.
4. `apps/manager/src/features/agents/automation-runner.ts` — main boundary where eligibility and duplicate detection currently call `createEnrichmentJobs(...)`.
5. `apps/manager/src/features/agents/automation-runner.test.ts` — best place to prove dry-run reuses selection logic but does not create live jobs.
6. `apps/manager/src/app/api/automations/runs/[id]/enqueue/route.ts` — service-to-service scheduler endpoint that should accept and validate run mode.
7. `apps/cms/src/api/enrichment-automation/services/scheduler.ts` — CMS scheduler claim, run attempt, dispatch, and completion flow.
8. `apps/cms/src/api/enrichment-automation/content-types/enrichment-automation/schema.json` — durable automation definition if run mode belongs on scheduled automations.
9. `apps/cms/src/api/enrichment-automation-run/content-types/enrichment-automation-run/schema.json` — durable run history if the dry-run report/marker belongs on run records.
10. `apps/manager/src/services/backfill.ts` — existing dry-run precedent that uses real queue logic but stops before processing.
11. `apps/manager/src/lib/mux-sync-report.ts`, `apps/manager/src/lib/embedding-sync-report.ts`, and `apps/manager/src/lib/scene-embedding-sync-report.ts` — metadata artifact report patterns.

## Grep These

- `enqueueAutomationRun|createEnrichmentJobs|selectEligibleAutomationVideos` in `apps/manager/src/features/agents/`
- `automationRunDocumentId|automationKey|artifacts.automation` in `apps/manager/src/`
- `dryRun|backfill_dry_run_estimate` in `apps/manager/src/services/backfill.ts`
- `syncTranslatedSubtitlesToMux|createTrack|deleteTrack|updateTrack` in `apps/manager/src/services/mux-sync/`
- `syncEmbeddingArtifact|syncSceneAnalysisEmbeddings|cmsPost` in `apps/manager/src/services/`
- `runDueAutomations|completeRunAttempt|completeAutomationCycle` in `apps/cms/src/api/enrichment-automation/services/`
- `AutomationRunDispatchResult|ClaimedAutomation` in `apps/cms/src/api/enrichment-automation/services/`

## What To Build

1. Add an explicit dry-run run mode to the automation contract.

Recommended starting point:

```ts
type AutomationRunMode = "live" | "dry_run"
```

Use this as a marker on run dispatch and run history. Do not overload `status` for dry-run; existing statuses such as `success`, `partial`, `failed`, and `no_op` should still describe the run result.

2. Add a dry-run report contract for automation runs.

Recommended shape:

```ts
type AutomationDryRunReport = {
  runMode: "dry_run"
  automationDocumentId: string
  automationRunDocumentId: string
  template: AutomationTemplate
  refreshMode: AutomationRefreshMode
  targetLanguageIds: string[]
  maxVideosPerRun: number
  eligibleCount: number
  skippedDuplicateCount: number
  wouldEnqueueCount: number
  selectedCandidates: Array<{
    videoDocumentId: string
    coreId: string
    outputOwner: "missing" | "ai" | "human"
    automationKey: string
  }>
  suppressedOperations: string[]
  summary: string
  generatedAt: string
}
```

The plan may store this as JSON on `enrichment-automation-run` or as a report-only job artifact, but it must be reachable from the Agents run history.

3. Update `enqueueAutomationRun(...)`.

When `runMode === "dry_run"`, run the same candidate fetch, duplicate-key listing, and `selectEligibleAutomationVideos(...)` call as live mode. Then return a dispatch result with `enqueuedCount: 0`, `jobDocumentIds: []`, and report details such as `wouldEnqueueCount`.

Do not call `createEnrichmentJobs(...)` in dry-run mode.

4. Update the Manager service-to-service enqueue endpoint.

`POST /api/automations/runs/[id]/enqueue` should accept the run mode from CMS scheduler dispatch or a Manager manual dry-run launch. Validate that dry-run uses the same template and target-language constraints as live mode.

5. Update CMS scheduler and durable records only as needed.

Scheduled dry-run automations should still be claimable, create a run attempt, complete the run, advance `nextRunAt`, clear leases, and set visible last-run metadata. If schema changes are required, add them to CMS and regenerate GraphQL types in the same implementation PR.

6. Add Manager UI affordances.

Show a dry-run marker in run history and expose the report. Add a manual dry-run launch action for an automation so an operator can test an agent without waiting for the next scheduled cycle.

## Constraints

- Do not create normal `EnrichmentJob` records in default dry-run mode.
- Do not call `runVideoEnrichment(...)` from dry-run dispatch.
- Do not call `ensureGeneratedSubtitlesForAsset(...)`, `syncTranslatedSubtitlesToMux(...)`, `applySubtitleOverride(...)`, `syncEmbeddingArtifact(...)`, or `syncSceneAnalysisEmbeddings(...)` from dry-run dispatch.
- Do not call Mux track create/update/delete APIs in dry-run mode.
- Do not call CMS sync/index writer endpoints such as `/embedding/index` or `/scene-embedding/index` in dry-run mode.
- Read-only CMS and Mux inspection is allowed when needed for eligibility or report explanation.
- Do not fake `enqueuedCount`; keep it `0` and store intended work as `wouldEnqueueCount`.
- Do not introduce free-form agent instructions in this slice.
- If CMS schema changes, regenerate GraphQL outputs in the same PR. Never hand-edit generated GraphQL files.

## Verification

- Unit tests prove dry-run calls the same eligibility and duplicate detection path as live automation runs.
- Unit tests prove dry-run does not call `createEnrichmentJobs(...)`.
- Route tests prove `POST /api/automations/runs/[id]/enqueue` accepts dry-run mode for service bearer callers and rejects malformed payloads.
- Scheduler tests prove a scheduled dry-run creates/completes a run attempt, advances `nextRunAt`, clears the lease, and records visible last-run metadata.
- UI tests or component tests prove run history labels dry-run cycles and exposes report details.
- Regression tests mock Mux and CMS writer clients and prove they are not called in dry-run mode.
- Run focused checks:
  - `pnpm --filter @forge/manager test`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`
  - `pnpm --filter @forge/cms test` if scheduler or schema code changes
  - `git diff --check`
