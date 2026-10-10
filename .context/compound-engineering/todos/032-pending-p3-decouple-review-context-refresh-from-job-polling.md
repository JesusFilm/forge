---
status: pending
priority: p3
issue_id: "032"
tags: [code-review, performance, manager, review-player]
dependencies: []
---

# Decouple Review Context Refresh From Job Polling

## Problem Statement

The review-context fetch is keyed on `job.updatedAt`, so normal job polling can repeatedly reload review context and hit Strapi, Mux, and artifact reads even when the review inputs did not materially change.

## Findings

- `apps/manager/src/features/jobs/live-job-detail-screen.tsx:43` runs the review-context effect.
- `apps/manager/src/features/jobs/live-job-detail-screen.tsx:88` keys the effect on `initialJob.id` and `job.updatedAt`.
- Job step/status polling updates `job.updatedAt`, which can trigger extra review-context requests while a job is active.

## Proposed Solutions

### Option 1: Load Review Context Once After Mount

**Approach:** Key the effect only on `initialJob.id` unless an explicit refresh is requested.

**Pros:**

- Avoids unnecessary expensive lookups.
- Simple to reason about.

**Cons:**

- Review context may not update automatically when artifacts become available.

**Effort:** 30-60 minutes

**Risk:** Low

### Option 2: Refresh Only on Artifact-Relevant Changes

**Approach:** Derive a review-specific signature from artifact manifest keys and relevant playback/video IDs.

**Pros:**

- Keeps live updates when review inputs change.
- Avoids status-only reloads.

**Cons:**

- Slightly more logic and test coverage.

**Effort:** 1-2 hours

**Risk:** Medium

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**

- `apps/manager/src/features/jobs/live-job-detail-screen.tsx`

## Resources

- Review finding from architecture/performance review on 2026-04-12.

## Acceptance Criteria

- [ ] Job status-only polling does not reload review context.
- [ ] Review context still refreshes when review-relevant artifacts or playback inputs change.
- [ ] Tests or browser instrumentation cover the refresh behavior.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Reviewed `LiveJobDetailScreen` effect dependencies and polling update flow.
- Identified expensive refresh path keyed to general `updatedAt`.

**Learnings:**

- Live operational pages should separate high-frequency status polling from heavier enrichment comparison loads.
