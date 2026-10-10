---
title: "Manager Automation Dry-Run Report Boundary"
category: integration-issues
module: Manager
date: 2026-04-13
problem_type: integration_issue
component: automation_runner
symptoms:
  - "Operators needed to launch scheduled agents safely before allowing live CMS or Mux mutations"
  - "Automation eligibility and duplicate suppression had no report-only execution mode"
  - "Run history could not distinguish live enqueue counts from dry-run intended work"
root_cause: missing_execution_mode
resolution_type: code_fix
severity: high
tags:
  - manager
  - cms
  - agents
  - automations
  - dry-run
  - mux
  - artifacts
affected_components:
  - apps/manager/src/features/agents/automation-runner.ts
  - apps/manager/src/features/agents/automation-store.ts
  - apps/manager/src/app/api/automations/runs/[id]/enqueue/route.ts
  - apps/manager/src/app/api/automations/[id]/dry-run/route.ts
  - apps/manager/src/features/agents/automation-run-history.tsx
  - apps/cms/src/api/enrichment-automation/services/scheduler.ts
  - apps/cms/src/api/enrichment-automation/services/manager-client.ts
related_docs:
  - docs/plans/2026-04-13-feat-manager-agent-dry-run-mode-plan.md
  - docs/brainstorms/2026-04-13-manager-agent-dry-run-mode-brainstorm.md
  - docs/roadmap/media-generation/feat-087-manager-agent-dry-run-mode.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
  - docs/solutions/integration-issues/manager-transcription-routing-artifact-boundary-20260412.md
  - docs/solutions/integration-issues/manager-agents-target-subtitle-contract-and-language-labels-20260412.md
---

# Manager Automation Dry-Run Report Boundary

## Problem

Manager automations enqueue real enrichment work on a schedule. Operators needed a way to launch an agent and inspect what would have happened before allowing writes to canonical CMS content, vector indexes, or Mux tracks.

The risky boundary was the automation runner path: candidate coverage, duplicate suppression, and cap selection were safe read phases, but the next step called `createEnrichmentJobs(...)`. Once normal jobs are created, downstream workflow steps may update CMS metadata, sync subtitles to Mux, and write embedding indexes.

## Solution

Model dry-run as a first-class `runMode`, not as a status. `status` still describes the execution result (`success`, `failed`, `no_op`, and so on), while `runMode` distinguishes `live` from `dry_run`.

Keep the dry-run branch in `enqueueAutomationRun(...)` after the shared read-only selection work and before `createEnrichmentJobs(...)`. The branch should:

- fetch the same candidates as live mode
- read the same running automation keys for duplicate suppression
- call `selectEligibleAutomationVideos(...)` with the same options
- return `enqueuedCount: 0` and an empty `jobDocumentIds` array
- store intended work as `dryRunReport.data.wouldEnqueueCount`
- list suppressed mutation operations in the report artifact

Manual dry-runs should use a user-authenticated Manager route that creates and completes a durable `enrichment-automation-run` record without advancing `nextRunAt`. Scheduled dry-runs should stay in the CMS scheduler lifecycle, so claim, run creation, completion, lease cleanup, and next-run advancement still happen on cadence.

## Why This Works

The report-only branch shares the important decision logic with live mode without entering the job pipeline. That keeps dry-run honest: if the candidate fetch, duplicate keys, refresh mode, language constraints, or cap logic change, live and dry-run behavior change together.

Persisting `runMode` and `report` on the run record also keeps the Agents UI simple. The row can continue to show `0 enqueued` while the report shows how many videos would have been enqueued and which operations were intentionally suppressed.

## Prevention

1. Keep dry-run branching above job creation. Do not move it below `createEnrichmentJobs(...)` or into downstream workflow steps.
2. Keep intended work in report fields such as `wouldEnqueueCount`; never overload `enqueuedCount`.
3. Preserve separate manual and scheduled semantics. Manual dry-run should not advance schedule timing; scheduled dry-run should.
4. When adding a new automation template, add dry-run report assertions before enabling live dispatch for that template.
5. If a new downstream mutation path is added, include its service boundary in the dry-run suppressed operation list or document why it cannot be reached from automation dispatch.

## Tests And Verification

Keep these regressions in place:

- Manager runner dry-run test proving `createEnrichmentJobs(...)` is not called.
- Manager enqueue route tests for `runMode: "dry_run"` and malformed run mode rejection.
- CMS scheduler and manager-client tests proving scheduled dry-run preserves scheduler lifecycle and persists the report.
- Manual dry-run route tests for successful run creation/completion and active-lease conflict.
- Run-history rendering test for the `Dry run` marker, `would enqueue` count, selected candidates, and suppressed operations.
- Browser smoke test on the Agents UI with the dry-run report expanded.
