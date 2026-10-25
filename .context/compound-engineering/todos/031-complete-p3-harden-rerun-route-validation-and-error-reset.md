---
status: complete
priority: p3
issue_id: "031"
tags: [code-review, manager, rerun, api, state]
dependencies: []
---

# Harden Rerun Route Validation And Error Reset

The transcription rerun endpoint has a couple of smaller robustness gaps: malformed JSON can currently turn into a 500, and reruns do not clear prior error history before restarting the job.

## Problem Statement

These issues do not appear to corrupt data, but they make the rerun API noisier and the operator UI harder to trust. A simple bad request should return a clean 400, and a successful rerun should not keep the old run’s error badge as if nothing changed.

## Findings

- [`route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:97) calls `request.json()` directly without the guard pattern used in adjacent manager routes.
- If the request body is malformed JSON, the route throws before Zod validation and can surface as a 500 instead of the intended client error.
- [`route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:128) resets status, steps, and artifacts, but [`state.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts:556) does not let `updateJob(...)` clear `errors`.
- That means a successful rerun can still carry the old error log and related error badge even though the job has been intentionally restarted.

## Proposed Solutions

### Option 1: Match The Existing Route Hardening Pattern

**Approach:** Wrap `request.json()` in a local `try/catch`, return a 400 on invalid JSON, and extend `updateJob(...)` so rerun routes can explicitly clear `errors` when resetting the job.

**Pros:**

- Consistent with nearby routes.
- Small, low-risk fix.
- Cleans up operator-visible state after reruns.

**Cons:**

- Slightly broadens `updateJob(...)` write surface.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Add A Dedicated `resetJobForRerun(...)` State Helper

**Approach:** Centralize rerun reset behavior in a state helper that clears errors, steps, and completion fields consistently.

**Pros:**

- Reduces route-level reset drift.
- Easier to reuse for future rerun flows.

**Cons:**

- More abstraction than the immediate bug strictly needs.

**Effort:** 2-4 hours

**Risk:** Low

## Recommended Action

Implemented Option 1. The rerun route now returns a clean `400` for malformed
JSON and explicitly clears `errors` when resetting a job for rerun.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts)

**Related components:**

- Job detail error log rendering

**Database changes:**

- No migration required.

## Resources

- **Adjacent guarded route pattern:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/route.ts:65](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/route.ts:65)
- **Rerun reset call:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:128](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:128)

## Acceptance Criteria

- [x] Malformed JSON sent to the rerun endpoint returns a 400 instead of a 500.
- [x] Resetting a job for rerun clears prior error-log entries unless the product decides to preserve them separately as historical state.
- [x] Successful reruns do not keep the previous run’s error badge as if the failure is still current.
- [x] Tests cover invalid JSON and rerun reset behavior.

## Work Log

### 2026-04-12 - Review Finding

**By:** Codex

**Actions:**

- Compared the rerun route’s request parsing to the adjacent manager route pattern.
- Confirmed that rerun reset writes cannot currently clear `errors`.
- Grouped two smaller robustness issues into one follow-up todo.

**Learnings:**

- These are smaller than the routing/audit bugs above, but they still make rerun state feel less trustworthy.

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Wrapped `request.json()` in a local `try/catch` so malformed rerun payloads
  return `400` with a clear `Invalid JSON body` error.
- Extended `updateJob(...)` and the rerun reset write to accept `errors: []`,
  which clears the prior error log when a rerun successfully starts.
- Added rerun route and state-layer coverage for invalid JSON handling and error
  clearing on rerun reset.
- Ran:
  - `pnpm --filter @forge/manager test -- src/lib/state.test.ts "src/app/api/jobs/[id]/transcription/rerun/route.test.ts"`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`

**Validation Evidence:**

- Route tests now assert malformed JSON returns `400` instead of surfacing as an
  uncaught server error.
- State and rerun-route tests confirm a rerun reset writes `errors: []`, so the
  next run does not inherit the previous failure badge as current state.

**Learnings:**

- Small route-hardening fixes matter here because rerun is an operator recovery
  path; it has to feel predictable when everything else is already going wrong.
