---
status: complete
priority: p1
issue_id: "026"
tags: [code-review, manager, jobs, ui, transcription]
dependencies: []
---

# Surface Transcription Routing Failures In Jobs List Summary

The jobs dashboard summary view can still show a job as completed with green step dots even when the detail view correctly derives a failed transcription state from `artifacts.transcriptionRouting`.

## Problem Statement

This branch adds a new quality gate that treats unresolved ElevenLabs failures as job failures, but the main jobs list does not fetch the metadata needed to apply that rule. As a result, operators can see contradictory state between the list view and the detail page for the same job.

That is a merge-blocking regression for the feature because the primary dashboard surface can still report success for a job that should be treated as failed.

## Findings

- [`live-jobs-table.tsx`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-jobs-table.tsx:123) polls `/api/jobs?view=summary`.
- [`state.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts:64) defines `JOB_SUMMARY_FIELDS` without `artifacts`.
- [`jobs-table-presenter.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/jobs-table-presenter.ts:210) derives the displayed job status from `getTranscriptionRoutingReport(job.artifacts)`.
- When summary records omit `artifacts`, `getTranscriptionRoutingReport(...)` always sees an empty manifest, so the new failure rule never activates in the list view.
- This matches the user-reported symptom: the UI can still show green checkmarks even after the branch intentionally reclassifies unresolved ElevenLabs output as a failure.
- The solution doc in [`manager-elevenlabs-routing-and-rerun-2026-04-11.md`](/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md) explicitly treats `transcriptionRouting` as the durable source of provider truth, which the summary read model currently does not honor.

## Proposed Solutions

### Option 1: Include Artifacts In Summary Records

**Approach:** Extend `JOB_SUMMARY_FIELDS` so summary polling includes the `artifacts` JSON field and the list presenter can evaluate `transcriptionRouting` the same way the detail page does.

**Pros:**

- Fixes the mismatch at the actual data source.
- Keeps list and detail rendering logic aligned.
- Smallest behavioral change.

**Cons:**

- Increases payload size for summary polling.
- Exposes the full artifact manifest to a view that may only need one metadata entry.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Persist A Summary-Safe Derived Failure Flag

**Approach:** Derive and persist a dedicated field or metadata flag for unresolved transcription quality failures, then let the summary query read that flag without fetching the full artifact manifest.

**Pros:**

- Avoids loading the full artifact manifest on the summary endpoint.
- Makes the operator-visible job state explicit.

**Cons:**

- Adds another piece of state that can drift from `transcriptionRouting`.
- Broadens the schema/read-model surface.

**Effort:** 3-5 hours

**Risk:** Medium

## Recommended Action

Implemented Option 1. The summary read model now includes `artifacts` and
`errors`, so the jobs list derives unresolved ElevenLabs failure state from the
same `transcriptionRouting` metadata as the detail page.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-jobs-table.tsx](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-jobs-table.tsx)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/jobs-table-presenter.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/jobs-table-presenter.ts)

**Related components:**

- Job detail view in [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
- Transcription routing metadata in [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts)

**Database changes:**

- No database migration required for the minimal fix.

## Resources

- **Known pattern:** [/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md](/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md)
- **Summary query:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts:64](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts:64)
- **Polling view:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-jobs-table.tsx:123](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-jobs-table.tsx:123)

## Acceptance Criteria

- [x] The main jobs list and the job detail page agree on whether an unresolved ElevenLabs failure should display as failed.
- [x] A job with `transcriptionRouting` indicating unresolved ElevenLabs failure renders as failed in the summary list without requiring navigation to the detail page.
- [x] Summary polling still works without breaking existing list rendering.
- [x] Tests cover the summary/list path for unresolved ElevenLabs failure state.

## Work Log

### 2026-04-12 - Review Finding

**By:** Codex

**Actions:**

- Reviewed the new list/detail status logic for transcription routing failures.
- Confirmed that the list view polls `/api/jobs?view=summary` while `JOB_SUMMARY_FIELDS` omits `artifacts`.
- Verified that `getDisplayedJobStatus(...)` depends on `transcriptionRouting`, which means the summary path cannot apply the new failure rule.
- Cross-checked the branch solution doc, which treats `transcriptionRouting` as the durable source of provider truth.

**Learnings:**

- The current implementation fixes failure surfacing in the detail view, but not in the main operator list.
- This is the most likely explanation for the user-reported “green checkmarks” regression.

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Extended `JOB_SUMMARY_FIELDS` to include `artifacts` and `errors`, so summary
  polling carries `transcriptionRouting` and the list presenter can apply the
  unresolved-ElevenLabs failure rule.
- Added regression coverage in `state.test.ts` for the summary query shape and
  kept `jobs-table-presenter.test.ts` passing against the richer summary payload.
- Ran:
  - `pnpm --filter @forge/manager test -- src/lib/state.test.ts src/lib/state-create.test.ts src/lib/transcription-routing-report.test.ts src/services/elevenlabs-transcription.test.ts src/services/transcription.test.ts "src/app/api/jobs/[id]/transcription/rerun/route.test.ts" src/features/jobs/jobs-table-presenter.test.ts src/workflows/videoEnrichment.test.ts src/app/api/enrich/route.test.ts`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`
- Ran a user-like browser smoke on local manager for the real failed job
  `s0w25wdhuiw5lbzum3m3n6ku`.

**Validation Evidence:**

- `http://localhost:3002/dashboard/jobs` now renders
  `5. Preview - Dealing With Injury AD 1x1` as `Failed at Transcription`
  instead of a completed green row.
- `http://localhost:3002/dashboard/jobs/s0w25wdhuiw5lbzum3m3n6ku` renders the
  same job as `failed`, with the unresolved ElevenLabs error and provider
  attempt card visible.
- Screenshots saved under `output/validation/2026-04-12-manager-routing/`:
  - `jobs-list.png`
  - `job-detail-s0w25wdhuiw5lbzum3m3n6ku.png`

**Learnings:**

- Pulling `transcriptionRouting` into the summary read model was enough to make
  the list and detail surfaces agree without inventing a second derived status
  flag.
