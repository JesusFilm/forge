---
status: complete
priority: p3
issue_id: "029"
tags: [code-review, manager, reliability, automations]
dependencies: []
---

# Paginate Running Automation Key Lookup

## Problem Statement

Automation duplicate suppression only reads the first page of pending/running enrichment jobs. If the live queue grows beyond that page, the runner can miss an active automation key and enqueue duplicate work.

## Findings

- `apps/manager/src/features/agents/automation-runner.ts` fetches running jobs with `pagination: { pageSize: 200 }`.
- The duplicate-suppression set is built only from that first page.
- At more than 200 pending/running jobs, active automation keys outside the first page are invisible to the runner.

## Proposed Solutions

### Option 1: Paginate All Running Automation Jobs

**Approach:** Fetch all pending/running automation job pages until exhaustion and build the key set from every page.

**Pros:**

- Directly fixes the blind spot.
- Simple to test with mocked paginated responses.

**Cons:**

- Can be heavier if the queue is very large.

**Effort:** 2-3 hours

**Risk:** Low

---

### Option 2: Query Candidate Keys Directly

**Approach:** Build expected keys for selected candidate videos and query only matching running job artifacts if the API supports it.

**Pros:**

- More scalable than reading the entire live queue.

**Cons:**

- Harder if artifacts are opaque JSON and not filterable in GraphQL.

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Implemented Option 1: paginate running automation jobs until exhaustion before building the duplicate-suppression key set.

## Technical Details

Affected files:

- `apps/manager/src/features/agents/automation-runner.ts`
- `apps/manager/src/features/agents/automation-runner.test.ts`

## Resources

- Review finding from workflows-review on 2026-04-12.

## Acceptance Criteria

- [x] Duplicate suppression sees running automation keys beyond the first 200 jobs.
- [x] Tests cover paginated running-job responses.
- [x] Query behavior remains bounded and observable for large queues.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Captured workflows-review finding about the fixed 200-job page size in `listRunningAutomationKeys()`.

**Learnings:**

- Duplicate suppression is only as reliable as the active-key read window.

### 2026-04-12 - Implemented

**By:** Codex

**Actions:**

- Updated running automation key lookup to request 200-job pages until it receives a short page.
- Added a regression test where the duplicate automation key appears only on page 2.
- Verified with `pnpm --filter @forge/manager test -- src/features/agents/automation-runner.test.ts`, full Manager tests, and root `pnpm test`.

**Learnings:**

- The pagination loop keeps the previous page size while removing the first-page blind spot.
