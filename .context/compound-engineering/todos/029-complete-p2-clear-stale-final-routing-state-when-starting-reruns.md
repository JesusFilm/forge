---
status: complete
priority: p2
issue_id: "029"
tags: [code-review, manager, rerun, ui, state]
dependencies: []
---

# Clear Stale Final Routing State When Starting Reruns

Starting a transcription rerun appends a new running attempt but leaves the previous run’s terminal routing fields in place, so the job can look finalized while the rerun is still pending or running.

## Problem Statement

The rerun flow is supposed to treat `transcriptionRouting` as the durable source of provider truth, but the route currently carries forward stale `finalProvider`, `finalSourceLanguageCode`, `fallbackReason`, and `diarization` from the previous run. That means the UI and any other consumer of the artifact manifest can read obsolete “final” state during an in-flight rerun.

## Findings

- [`route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:68) builds the rerun report by appending a running attempt onto the existing report as-is.
- [`route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:123) immediately persists that report back into `artifacts`.
- [`live-job-steps-table.tsx`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx:807) renders `transcriptionRoutingReport.finalProvider` directly in the detail panel.
- The solution doc for this branch describes `transcriptionRouting` as the single durable source of provider truth and rerun provenance, which stale final fields undermine.

## Proposed Solutions

### Option 1: Strip Terminal Fields When Constructing A Rerun Report

**Approach:** When starting a rerun, preserve attempt history and source metadata but clear `finalProvider`, `finalSourceLanguageCode`, `fallbackReason`, and `diarization` until the new attempt completes.

**Pros:**

- Keeps the persisted state truthful during reruns.
- Minimal scope.
- Works with the existing UI by naturally rendering “pending” final state.

**Cons:**

- Loses easy access to the previous final snapshot unless it is preserved elsewhere.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Preserve Previous Final State Under Explicit Historical Keys

**Approach:** Move the old final state into a clearly historical subfield before starting a rerun, then repopulate the live final fields on completion.

**Pros:**

- Preserves both current and previous provider outcomes.
- Richer audit trail.

**Cons:**

- Expands the metadata contract.
- Requires more UI and test updates.

**Effort:** 3-5 hours

**Risk:** Medium

## Recommended Action

Implemented Option 1. The rerun route now clears terminal routing fields before
appending a new running attempt, while preserving prior attempt history and
source metadata.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts)

**Related components:**

- Rerun controls and provider summary in the job detail page

**Database changes:**

- No migration required for the minimal fix.

## Resources

- **Known pattern:** [/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md](/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md)
- **Rerun report construction:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:68](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:68)
- **Detail panel render:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx:807](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx:807)

## Acceptance Criteria

- [x] Starting a rerun clears or clearly marks stale final-provider fields in `transcriptionRouting`.
- [x] During a pending/running rerun, the detail UI does not present the previous run’s provider as the current final state.
- [x] Attempt history from previous runs is still preserved.
- [x] Tests cover rerun-start state before the new transcription completes.

## Work Log

### 2026-04-12 - Review Finding

**By:** Codex

**Actions:**

- Reviewed rerun report construction and the detail panel rendering path.
- Confirmed that the route preserves terminal fields from the previous run while appending a new running attempt.
- Cross-checked the branch solution doc’s stated “single source of provider truth” goal.

**Learnings:**

- This is a state-truth bug more than a UI bug.
- The current UI is faithfully rendering stale data because the persisted rerun state is stale.

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Updated `buildRerunRoutingReport(...)` to delete stale terminal fields
  (`currentAttemptId`, `finalProvider`, `finalSourceLanguageCode`,
  `fallbackReason`, and `diarization`) before appending the new running attempt.
- Preserved historical attempts and source metadata while making the live rerun
  report truthful for the current run.
- Added rerun route coverage that asserts stale final-provider fields are absent
  immediately after a rerun starts.
- Ran:
  - `pnpm --filter @forge/manager test -- "src/app/api/jobs/[id]/transcription/rerun/route.test.ts"`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`

**Validation Evidence:**

- Route tests now confirm rerun-start artifacts report `Final: pending` instead
  of surfacing the previous run’s final provider while the new attempt is in
  flight.

**Learnings:**

- Clearing stale terminal state at rerun start keeps the UI honest without
  sacrificing attempt history.
