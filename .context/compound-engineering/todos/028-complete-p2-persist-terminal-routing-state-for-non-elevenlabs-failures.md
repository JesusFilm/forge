---
status: complete
priority: p2
issue_id: "028"
tags: [code-review, manager, transcription, audit, reliability]
dependencies: []
---

# Persist Terminal Routing State For Non-ElevenLabs Failures

The new routing report is only durably persisted when failures are wrapped in `TranscriptionExecutionError`. Several Mux-path and preflight failure paths still throw plain `Error`, which drops the provider audit trail.

## Problem Statement

The branch introduces `transcriptionRouting` as the durable source of provider truth, but some failure paths still bypass it. When that happens, the workflow records only a generic failed step and loses the attempt history that operators need to understand what provider was selected, what failed, and whether a rerun actually finished.

## Findings

- [`transcription.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:508) starts a Mux attempt, but failures from `ensureGeneratedSubtitlesForAsset(...)` or `transcribeViaMux(...)` escape as plain `Error`.
- [`videoEnrichment.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/workflows/videoEnrichment.ts:249) only persists routing artifacts when the thrown error carries `routingReport`.
- Forced ElevenLabs preflight rejections in [`transcription.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:546), [`transcription.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:558), and [`transcription.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:570) also throw before a terminal attempt record is persisted.
- That can leave reruns with a failed job and no durable explanation, or even a still-running attempt entry if the rerun route appended one first.

## Proposed Solutions

### Option 1: Normalize All Provider Failures Into `TranscriptionExecutionError`

**Approach:** Wrap Mux-path failures and forced-provider preflight rejections in `TranscriptionExecutionError` after finalizing the relevant attempt state, so the workflow catch can always persist `transcriptionRouting`.

**Pros:**

- Keeps one error contract for all provider-selection failures.
- Preserves operator-visible audit history across all failure modes.
- Smallest conceptual change.

**Cons:**

- Requires careful refactoring around preflight validation and Mux helper errors.
- Easy to miss one edge path without targeted tests.

**Effort:** 2-4 hours

**Risk:** Medium

---

### Option 2: Teach The Workflow To Persist Structured Routing Context Independently

**Approach:** Let the workflow catch any transcription failure and reconstruct/persist the routing report separately, instead of relying on the service layer to wrap everything.

**Pros:**

- Makes the workflow robust even if lower layers throw plain errors.
- Centralizes persistence of failure evidence.

**Cons:**

- The workflow has less context than the provider-selection code.
- Easier to duplicate or drift from the transcription service’s state machine.

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Implemented Option 1. All transcription-provider terminal failures now funnel
through `TranscriptionExecutionError` with a finalized routing report, so the
workflow can durably persist attempt history for both Mux-path and forced
ElevenLabs preflight failures.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/workflows/videoEnrichment.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/workflows/videoEnrichment.ts)

**Related components:**

- Transcription routing metadata in [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts)
- Rerun route in [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts)

**Database changes:**

- No migration required.

## Resources

- **Known pattern:** [/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md](/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md)
- **Mux-path attempt start:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:508](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:508)
- **Workflow failure persistence:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/workflows/videoEnrichment.ts:249](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/workflows/videoEnrichment.ts:249)

## Acceptance Criteria

- [x] Any Mux-path transcription failure persists a terminal `transcriptionRouting` attempt with an explanation.
- [x] Forced-provider preflight failures also persist terminal routing state instead of leaving only a generic step failure.
- [x] Rerun attempts never remain stuck in `running` after a terminal failure.
- [x] Tests cover Mux failure and forced-ElevenLabs preflight failure paths.

## Work Log

### 2026-04-12 - Review Finding

**By:** Codex

**Actions:**

- Traced which transcription failures become `TranscriptionExecutionError` and which remain plain `Error`.
- Verified the workflow only persists routing metadata when the error carries `routingReport`.
- Merged duplicate findings from multiple specialist reviewers into one provider-audit issue.

**Learnings:**

- The routing-report design is solid, but its persistence contract is not yet consistently applied.
- Missing audit trail on failure is especially painful for reruns because it erases the reason the operator asked for the rerun in the first place.

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Added `failAttemptWithRoutingReport(...)` in `transcription.ts` to finalize
  failed attempts and throw `TranscriptionExecutionError` with the updated
  routing report attached.
- Wrapped the Mux path so failures from generated-subtitle preparation or Mux
  transcription finalize the Mux attempt as `failed` and persist
  `fallbackReason` instead of escaping as plain errors.
- Changed forced ElevenLabs preflight failures such as missing source URL to
  finalize the ElevenLabs attempt before throwing.
- Added transcription tests covering a failing Mux path and a forced
  ElevenLabs rerun with no source URL.
- Ran:
  - `pnpm --filter @forge/manager test -- src/services/transcription.test.ts src/workflows/videoEnrichment.test.ts`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`

**Validation Evidence:**

- The focused transcription suite now asserts that both failure paths throw
  `TranscriptionExecutionError` carrying terminal routing state.
- The broader manager regression suite passed with the workflow consuming and
  persisting those finalized reports.

**Learnings:**

- The workflow catch path was already good; the missing piece was making every
  provider failure honor the same structured error contract.
