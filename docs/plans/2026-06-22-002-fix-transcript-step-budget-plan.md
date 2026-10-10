---
title: "fix: Keep transcript backfill process steps below the worker ceiling"
type: fix
date: "2026-06-22"
---

# fix: Keep transcript backfill process steps below the worker ceiling

## Summary

The transcript embedding resume runner still lets a durable processing step run past the roughly 300 second Graphile/useworkflow task boundary. The hotfix will stop starting another Mastra launch wave when the remaining step budget cannot safely contain the wave's configured timeout.

---

## Problem Frame

Production run `wrun_01KVPDSDX54JPV9FFVR43FQV4W` was cancelled after the ledger showed duplicate `step_started` events. Step `step_01KVPDSH3EZVRTPB31HK15BX2B` ran from `2026-06-22 01:10:32 UTC` to `2026-06-22 01:15:48 UTC`, completed on attempt 2, and emitted two `step_started` events. The run had already entered the same event-log corruption family as the previous all-language failure.

The current runner checks `stepMaxDurationMs` only before a new wave starts. That allows a second 120 second Mastra-launch wave to start even when overhead from source loading, DB checks, and timeout handling can push the step beyond the worker ceiling.

---

## Requirements

- R1. A transcript process step must not start a launch wave when the configured launch timeout plus a safety buffer cannot fit inside the remaining step budget.
- R2. Each process step must still launch at least one wave when work remains, so the workflow cannot deadlock on a too-small budget.
- R3. Unprocessed groups must be returned for the workflow-level loop to continue in a later durable step.
- R4. Existing `MODEL_UPGRADE` resume skip semantics must stay unchanged so healthy enriched rows are not re-embedded.
- R5. The runbook and compound learning must record the new production failure shape and the fix.

---

## Key Technical Decisions

- **Budget by projected wave duration:** Use `launchTimeoutMs` plus a small fixed safety buffer when deciding whether another wave may start. Elapsed time alone is insufficient because the next wave can legally consume the full launch timeout.
- **Always allow the first wave:** If the budget is misconfigured or the first wave itself runs long, processing one wave is still the least-bad progress path. Later waves should be deferred.
- **Keep this hotfix in Admin:** The immediate production failure is the Admin durable step boundary. A first-class detached Mastra launch/status surface remains follow-up work because it needs queueing and concurrency controls.

---

## Implementation Units

### U1. Guard Process Waves By Remaining Step Budget

- **Goal:** Prevent `stepProcessTranscriptEmbeddingGroups` from starting a new wave that can push the step across the worker ceiling.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** None.
- **Files:** `apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts`, `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts`.
- **Approach:** Add a conservative wave-start guard that compares elapsed time, `launchTimeoutMs`, and a safety buffer against `stepMaxDurationMs`. If at least one wave has already run and the next wave cannot fit, return the remaining groups through `unprocessedGroups`.
- **Patterns to follow:** Existing target-sharded batching in `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` and existing pending-confirmation tests in `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts`.
- **Test scenarios:** A process step with two waves and a near-exhausted budget returns the second wave as unprocessed before launching it. A process step with work remaining still launches the first wave even when the projected budget is tight. Existing resume-skip tests still pass.
- **Verification:** Focused Admin workflow tests pass and the step guard is covered by a failing-before/passing-after test.

### U2. Update Operational Learning

- **Goal:** Preserve the root cause and operator guidance for future agents.
- **Requirements:** R5.
- **Dependencies:** U1.
- **Files:** `docs/solutions/workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md`, `docs/solutions/workflow-issues/bound-durable-workflow-step-payloads-before-persistence.md`.
- **Approach:** Add a checkpoint explaining that bounded pending-confirmation payloads are not enough when processing steps can still launch multiple timeout-sized waves. Cross-link the new lesson from the existing step-payload learning.
- **Test scenarios:** Test expectation: none -- documentation-only update.
- **Verification:** Compound frontmatter validation passes for any new or modified solution note.

---

## Risks & Dependencies

- More durable process steps will be created because timeout-heavy batches may do one wave per step. This is acceptable because small steps are safer than retrying poisoned long steps.
- The current Mastra route still waits synchronously for workflow completion. This hotfix stops Admin event-log corruption; it does not fully solve detached Mastra orchestration.

---

## Operational Notes

The poisoned production run was cancelled before this plan was written. After deploy, resume through the existing Admin GraphQL mutation with `mode: MODEL_UPGRADE`, `coreIds: ["1_jf-0-0"]`, and no language filter. The expected proof is that new `stepProcessTranscriptEmbeddingGroups` rows complete below the worker boundary and no duplicate `step_started` events appear.
