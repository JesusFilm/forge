---
status: complete
priority: p2
issue_id: "028"
tags: [code-review, cms, reliability, automations]
dependencies: []
---

# Make Automation Dispatch Completion Idempotent

## Problem Statement

After the CMS scheduler successfully dispatches a run to Manager, `completeCycle()` performs follow-up updates to the run record and automation lease state. If those completion writes fail after Manager already enqueued jobs, the automation can be reclaimed after lease expiry and dispatch duplicate work.

## Findings

- `apps/cms/src/api/enrichment-automation/services/scheduler.ts` calls `managerClient.enqueueAutomationRun()` and then `completeCycle()`.
- `completeCycle()` updates the run attempt and then the automation cycle state. A failure in either write can leave the lease/run state inconsistent after external work was already enqueued.
- Once the lease expires, the same due automation can be claimed again, risking duplicate jobs and confusing run history.

## Proposed Solutions

### Option 1: Add Compensating Completion Handling

**Approach:** Catch completion failures after dispatch, mark the run/automation into a durable failed state when possible, and clear or extend the lease deliberately.

**Pros:**

- Smallest targeted reliability fix.
- Keeps the existing scheduler architecture.

**Cons:**

- Still relies on best-effort recovery if the database is unavailable.

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 2: Make Dispatch Idempotent by Run Key

**Approach:** Ensure Manager enqueue is idempotent for a scheduler run or automation key so repeated dispatch after lease expiry cannot duplicate jobs.

**Pros:**

- Stronger protection against retries and partial failures.
- Helps with future scheduler replay behavior.

**Cons:**

- Requires careful interaction with existing running-job duplicate suppression.

**Effort:** 1 day

**Risk:** Medium

## Recommended Action

Implemented Option 1: add post-dispatch completion recovery that preserves the successful dispatch result while retrying automation cycle completion.

## Technical Details

Affected files:

- `apps/cms/src/api/enrichment-automation/services/scheduler.ts`
- `apps/cms/src/api/enrichment-automation/services/scheduler.test.ts`
- `apps/manager/src/features/agents/automation-runner.ts` if idempotency moves to Manager.

## Resources

- Review finding from workflows-review on 2026-04-12.

## Acceptance Criteria

- [x] A post-dispatch completion write failure cannot cause duplicate Manager work after lease expiry.
- [x] Scheduler tests cover Manager dispatch success followed by run or automation completion failure.
- [x] Run history and lease state remain diagnosable after partial completion failure.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Captured workflows-review reliability finding on scheduler post-dispatch completion.

**Learnings:**

- Dispatching external work before all local completion writes are durable needs an idempotency or compensation story.

### 2026-04-12 - Implemented

**By:** Codex

**Actions:**

- Separated Manager dispatch failure handling from post-dispatch CMS completion failure handling.
- Added a completion retry path that keeps the original success status, clears the lease, and advances the next run.
- Verified with the scheduler red/green test and the full CMS/root test suites.

**Learnings:**

- Treating post-dispatch completion as its own recovery path avoids converting a successful enqueue into a failed dispatch result.
