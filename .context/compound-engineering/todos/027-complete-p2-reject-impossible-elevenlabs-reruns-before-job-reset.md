---
status: complete
priority: p2
issue_id: "027"
tags: [code-review, manager, rerun, elevenlabs, validation]
dependencies: []
---

# Reject Impossible ElevenLabs Reruns Before Job Reset

The rerun endpoint currently accepts `provider: "elevenlabs"` as long as a source URL exists, even when the job still has `auto` or otherwise unsupported source-language state.

## Problem Statement

This route can reset a completed job back to `pending`, append a new running attempt, and dispatch background work that is guaranteed to fail moments later. That creates avoidable churn in job state and produces a worse operator experience than rejecting the rerun request up front.

## Findings

- [`route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:109) only checks for a persisted `sourceInputUrl` before allowing a forced ElevenLabs rerun.
- The rerun workflow later calls [`transcription.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:558), where forced ElevenLabs throws if the source language is unresolved, and [`transcription.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:570) throws if the language is unsupported.
- Because those checks happen after the job reset, the API accepts a rerun that it could have rejected synchronously with a 409 or 400.
- If this path fails before a terminal routing report is persisted, the operator sees a pending/running transition followed by a failed job instead of a clear immediate validation error.

## Proposed Solutions

### Option 1: Validate Source Language Before Resetting The Job

**Approach:** In the rerun route, derive the effective source language from durable metadata (`finalSourceLanguageCode`, materialization metadata, or `job.sourceLanguageCode`) and reject forced ElevenLabs reruns unless it is concrete and supported.

**Pros:**

- Prevents guaranteed-failure reruns from mutating job state.
- Gives operators immediate, actionable feedback.
- Keeps the rerun contract aligned with the provider requirements enforced deeper in the transcription service.

**Cons:**

- Requires agreeing on the authoritative source-language field for reruns.
- May reveal gaps in older jobs that were created before source-language metadata existed.

**Effort:** 1-3 hours

**Risk:** Low

---

### Option 2: Require Explicit Language Input For Unsupported/Unknown Cases

**Approach:** Extend the rerun API/UI so the operator must provide a concrete source language when choosing ElevenLabs and the existing job state is not sufficient.

**Pros:**

- Handles historical jobs with incomplete metadata.
- Makes the operator intent explicit.

**Cons:**

- Broader API and UI scope.
- Adds extra operator friction for normal reruns.

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Implemented Option 1. The rerun route now resolves the effective source
language from durable job metadata before any reset write and rejects forced
ElevenLabs reruns with a 409 when the language is unresolved or unsupported.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts)

**Related components:**

- Rerun controls in [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- Transcription routing metadata in [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts)

**Database changes:**

- No migration required for the minimal validation fix.

## Resources

- **Known pattern:** [/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md](/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md)
- **Rerun route guard:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:109](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/transcription/rerun/route.ts:109)
- **Provider preconditions:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:558](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/transcription.ts:558)

## Acceptance Criteria

- [x] Forced ElevenLabs reruns are rejected before job reset when the source language is unresolved or unsupported.
- [x] The API returns a clear validation error without resetting the job to `pending`.
- [x] The rerun UI surfaces the validation failure instead of showing a doomed rerun begin and then fail.
- [x] Tests cover unsupported/unresolved-language rerun requests.

## Work Log

### 2026-04-12 - Review Finding

**By:** Codex

**Actions:**

- Reviewed the forced rerun route and the deeper provider preconditions in the transcription service.
- Confirmed the route only validates source URL presence before resetting the job.
- Verified that forced ElevenLabs later throws on unresolved or unsupported source languages.

**Learnings:**

- The current route accepts reruns it already knows cannot succeed.
- This is a route-level validation gap, not an ElevenLabs API integration issue.

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Added `resolveRerunSourceLanguageCode(...)` to the rerun route so forced
  ElevenLabs requests validate against the best available durable language
  source before resetting the job.
- Rejected unresolved and unsupported ElevenLabs reruns with `409` responses
  instead of mutating the job into a doomed pending/running state.
- Added rerun route coverage for unresolved-language and unsupported-language
  requests.
- Ran:
  - `pnpm --filter @forge/manager test -- src/services/transcription.test.ts "src/app/api/jobs/[id]/transcription/rerun/route.test.ts"`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`
- Ran a browser smoke on local manager using job
  `dtzrem58e6jiron6drn6hz6c` and clicked `Rerun with ElevenLabs`.

**Validation Evidence:**

- The detail UI stayed on the failed job and rendered the inline error
  `This job does not have a concrete source language for ElevenLabs reruns.`
- No pending/running rerun state was introduced before the validation error was
  shown.
- Screenshot saved to
  `output/validation/2026-04-12-manager-routing/job-detail-dtzrem58e6jiron6drn6hz6c-rerun-validation.png`

**Learnings:**

- Route-level validation is the right place to stop impossible reruns because it
  gives the operator a fast, legible answer and preserves the prior job state.
