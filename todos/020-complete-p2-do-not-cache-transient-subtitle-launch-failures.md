---
status: complete
priority: p2
issue_id: "020"
tags: [code-review, reliability, idempotency, mastra]
dependencies: []
---

# Do Not Cache Transient Subtitle Launch Failures

## Problem Statement

The Mastra subtitle run route stores every launch result in its idempotency
map, including transient failures such as `manager_unavailable` and
`mastra_runtime_error`. A retry with the same idempotency key then receives the
cached failure without attempting to start the workflow again.

## Findings

- `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts` converts thrown workflow
  launch errors into a `mastra_runtime_error` response.
- `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts` stores the result for
  the idempotency key regardless of whether `result.ok` is true.
- `apps/manager/src/app/api/enrich/route.ts:530` marks the Manager job failed
  when the Mastra launch result is not ok.

## Proposed Solutions

### Option 1: Cache Only Accepted Runs And Deterministic Conflicts

**Approach:** Store idempotency records only after a run is accepted, and do not
memoize transient startup failures.

**Pros:**
- Retries can recover from temporary Manager/Mastra outages.
- Keeps idempotency useful for accepted runs.

**Cons:**
- Needs tests for repeated transient failures and later success.

**Effort:** Small

**Risk:** Low

---

### Option 2: Persist Failure Records With Retry Policy

**Approach:** Store failure records with a retryable flag or expiration.

**Pros:**
- More explicit operational semantics.

**Cons:**
- More state machinery than V1 likely needs.

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Use Option 1 for V1: cache accepted runs and payload fingerprints, but allow the
same idempotency key to retry after transient launch failures.

## Technical Details

Affected files:

- `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts`
- `apps/mastra/src/mastra/workflows/subtitle-enrichment.test.ts`
- `apps/manager/src/services/mastra-subtitle-enrichment.ts`

## Resources

- PR: https://github.com/JesusFilm/forge/pull/886

## Acceptance Criteria

- [x] Same-payload retry after a transient launch failure attempts launch again.
- [x] Same-payload retry after an accepted run returns the stable accepted run.
- [x] Different-payload retry with the same key still returns
  `idempotency_conflict`.
- [x] Manager retry semantics are documented or tested.

## Work Log

### 2026-05-05 - Review Finding

**By:** Codex

**Actions:**
- Reviewed Mastra idempotency handling.
- Identified that transient failures are stored as stable results.

**Learnings:**
- Idempotency should stabilize accepted side effects, not permanently pin
  temporary startup failures.

### 2026-05-05 - Retry Semantics Fix

**By:** Codex

**Actions:**
- Updated the Mastra subtitle run handler to cache idempotency records only for
  successful accepted launches.
- Added a red/green test where the same idempotency key receives a transient
  `manager_unavailable` response and then succeeds on retry.

**Learnings:**
- The idempotency map should represent accepted workflow side effects, not
  temporary runtime startup errors.
