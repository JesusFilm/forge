---
status: complete
priority: p2
issue_id: "030"
tags: [code-review, manager, api, automations]
dependencies: []
---

# Reject Invalid Service Enqueue Automation Payloads

## Problem Statement

The Manager service enqueue route accepts the scheduler's automation payload with `targetLanguageIds` as `unknown`, normalizes it, and delegates malformed target subtitle payloads to the runner. The runner safely no-ops multi-language target subtitle records, but the service boundary can silently accept bad automation state.

## Findings

- `apps/manager/src/app/api/automations/runs/[id]/enqueue/route.ts` validates the payload shape but does not enforce the same target-language contract as the create API.
- A malformed service payload can produce a `no_op` run instead of a clear boundary rejection.
- This makes scheduler/config data issues easier to miss in run history.

## Proposed Solutions

### Option 1: Reuse Draft Validation for Service Payloads

**Approach:** After normalizing `targetLanguageIds`, validate template, refresh mode, schedule, cap, and target-language count before calling `enqueueAutomationRun()`.

**Pros:**

- Keeps Manager API boundaries aligned.
- Gives clearer failures for malformed scheduler payloads.

**Cons:**

- Need to ensure stale records still fail in a diagnosable way rather than crashing the scheduler.

**Effort:** 2-3 hours

**Risk:** Low

---

### Option 2: Add a Dedicated Automation Payload Schema

**Approach:** Add a service-specific schema that validates persisted automation records and reports precise errors for malformed CMS data.

**Pros:**

- More explicit than reusing create-draft validation.
- Can include persisted-only fields.

**Cons:**

- More validation surface to keep in sync.

**Effort:** 3-5 hours

**Risk:** Low

## Recommended Action

Implemented Option 2: tighten the service enqueue schema and explicitly reject malformed target-subtitle target language payloads before runner dispatch.

## Technical Details

Affected files:

- `apps/manager/src/app/api/automations/runs/[id]/enqueue/route.ts`
- `apps/manager/src/app/api/automations/runs/[id]/enqueue/route.test.ts`
- `apps/manager/src/features/agents/automation-contract.ts`

## Resources

- Review finding from workflows-review on 2026-04-12.

## Acceptance Criteria

- [x] Service enqueue rejects target subtitle automations with zero or multiple target languages before runner dispatch.
- [x] Response body clearly reports validation details.
- [x] Route tests cover invalid target-language payloads.
- [x] Runner guard remains as a defensive backstop.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Captured workflows-review finding that the service enqueue boundary accepts malformed target subtitle payloads and relies on runner no-op behavior.

**Learnings:**

- The runner guard is safe, but the service route can still be stricter for better diagnostics and agent-facing parity.

### 2026-04-12 - Implemented

**By:** Codex

**Actions:**

- Tightened `targetLanguageIds` to a string-array schema at the Manager service enqueue boundary.
- Added a one-target-language check for `target_subtitles_missing` before calling the runner.
- Added route regression tests for malformed and multi-language service payloads.
- Verified with focused Manager route tests, full Manager tests, and root `pnpm test`.

**Learnings:**

- Rejecting bad service payloads at the route boundary gives clearer diagnostics than relying on a runner no-op.
