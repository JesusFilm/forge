---
date: 2026-04-13
topic: manager-agent-dry-run-mode
related:
  - docs/brainstorms/2026-04-12-manager-agents-automations-requirements.md
  - docs/plans/2026-04-12-feat-manager-agents-automations-plan.md
  - docs/roadmap/media-generation/feat-084-manager-agents-automations.md
  - docs/roadmap/media-generation/feat-087-manager-agent-dry-run-mode.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
  - docs/solutions/integration-issues/manager-transcription-routing-artifact-boundary-20260412.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
---

# Manager Agent Dry-Run Mode

## What We're Building

Add a dry-run mode for Manager agents and automations so an operator can launch an agent, let it use the same template, schedule, refresh-mode, eligibility, duplicate-skip, and per-run cap logic as a live run, and receive a durable report of what would have happened without mutating canonical systems.

The only allowed persistence in dry-run mode is operational evidence: the automation run record and a job/run artifact report. Dry-run must not create normal enrichment jobs, update CMS content or vector indexes, or create/update/delete Mux tracks. Read-only CMS and Mux inspection is allowed when it is needed to explain the report.

## Requirements

- R1. Dry-run is available for manual agent launches and scheduled automation runs.
- R2. Dry-run uses the same eligibility, cap, refresh-mode, target-language, and duplicate detection logic as live automation runs.
- R3. Dry-run records an operator-facing report artifact with eligible counts, selected candidate identifiers, skipped duplicate counts, target languages, template, refresh mode, cap, and a plain-language summary.
- R4. Dry-run does not call the normal job creation path or enqueue `runVideoEnrichment`.
- R5. Dry-run does not update canonical CMS content, CMS vector indexes, or Mux subtitle tracks.
- R6. Dry-run still appears in automation run history with a visible dry-run marker rather than disappearing as a preview-only action.
- R7. Existing active/paused lifecycle, lease claiming, no-op handling, and `nextRunAt` advancement remain intact.

## Approaches Considered

### Recommended: Runner-Level Report-Only Dry Run

Add a dry-run run mode at the automation dispatch boundary. `enqueueAutomationRun` should run candidate discovery and selection, then produce a dry-run report instead of calling `createEnrichmentJobs`.

Pros: smallest safe slice, reuses the most important logic, and blocks Mux/CMS side effects before the workflow starts. Cons: it reports what would be enqueued rather than running expensive AI generation.

### Full Workflow Side-Effect Sandbox

Let dry-run create a special job and run the enrichment workflow while replacing Mux and CMS writers with report-only adapters.

Pros: richer report of generated outputs and downstream sync decisions. Cons: much larger blast radius because every workflow side-effect boundary needs a dry-run adapter and tests.

### UI-Only Preview

Add a Manager preview button that calls read-only eligibility endpoints and shows the next candidates without recording a run.

Pros: very cheap to build. Cons: it does not satisfy the request to launch an agent and leaves no durable run history or artifact report.

## Why This Approach

The runner-level report-only design is the best default because the clearest side-effect boundary already exists in `apps/manager/src/features/agents/automation-runner.ts`: it computes candidates, skips duplicates, and then calls `createEnrichmentJobs(...)`. Dry-run should stop at that boundary and write a report artifact instead of starting the normal enrichment pipeline.

This follows the Manager backfill dry-run precedent: share the real queue/selection logic, but stop before expensive or mutating processing. It also matches the existing artifact-backed operator UI pattern used by transcription routing, Mux sync, embedding sync, and scene embedding sync reports.

## Key Decisions

- Scope: dry-run covers Manager agents/automations, not every enrichment API in the app.
- Default behavior: report what would be enqueued, not full AI-generated output.
- Persistence: allow automation run history and report artifacts only; block canonical CMS writes and Mux mutations.
- Run mode: prefer an explicit `runMode: "live" | "dry_run"` or equivalent marker over overloading existing statuses.
- Counts: keep `enqueuedCount` at `0` for dry-run; put `wouldEnqueueCount` and candidate details in the dry-run report.
- Safety: dry-run may read from CMS and Mux, but must not call writer APIs such as CMS sync/index endpoints or Mux track create/update/delete.
- UI: run history should label dry-run cycles and link to the report so operators can audit what the agent would have done.

## Dry-Run Report Contract

The report should be a metadata artifact, not a downloadable enrichment file. Recommended shape:

```ts
type AutomationDryRunReport = {
  kind: "metadata"
  data: {
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
}
```

The implementation plan can decide whether this lives directly on `enrichment-automation-run` JSON data or on a dry-run-only job artifact record. The product requirement is that operators can find the report from run history, and no normal enrichment job is created by default.

## Resolved Questions

- Dry-run should be an execution mode, not a separate free-form agent template.
- The first version should use real eligibility and selection, then stop before normal job creation.
- The only permitted dry-run persistence is operational report/history data.
- Mux reads are allowed for explanation; Mux writes are not.
- CMS reads are allowed for eligibility; canonical content/index writes are not.
- Scheduled dry-runs should continue advancing `nextRunAt` just like no-op and live runs.

## Open Questions

None for the brainstorm. Defaults above were chosen intentionally so planning can proceed without another clarification round.

## Next Steps

Proceed to `/workflows:plan docs/brainstorms/2026-04-13-manager-agent-dry-run-mode-brainstorm.md` for implementation details.
