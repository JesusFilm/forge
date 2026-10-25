---
status: complete
priority: p2
issue_id: "027"
tags: [code-review, manager, data-consistency, review-player]
dependencies: []
---

# Preserve Review Source Context During Polling

## Problem Statement

The job detail page initially loads collection and source media titles, but polling can replace that rich job record with a leaner job payload that lacks `sourceCollectionTitle` and `sourceMediaTitle`. The review metadata card can therefore lose Collections and Source media after a job refresh.

## Findings

- `apps/manager/src/lib/state.ts:25` defines `JOB_CORE_FIELDS` with only `video.documentId`, while `JOB_SOURCE_FIELDS` carries `video.title` and `video.parents`.
- `apps/manager/src/features/jobs/live-job-detail-screen.tsx:38` stores the current `job`, and `LiveJobStepsTable` updates it through `onJobUpdate={setJob}`.
- If the poll update comes from `getJob()` / `JOB_CORE_FIELDS`, `toJobRecord()` cannot populate `sourceCollectionTitle` or `sourceMediaTitle`, so the review card loses those fields.

## Proposed Solutions

### Option 1: Include Source Fields in `JOB_CORE_FIELDS`

**Approach:** Add `video.title` and `video.parents { title }` to the shared core fragment.

**Pros:**

- Every job read has a consistent `JobRecord` shape.
- Fixes the issue at the read-model boundary.

**Cons:**

- Slightly larger payload for job reads that may not need source display data.

**Effort:** 30-60 minutes

**Risk:** Low

### Option 2: Preserve Source Context When Applying Poll Updates

**Approach:** Merge `sourceCollectionTitle` and `sourceMediaTitle` from the current job into polled updates when the update omits them.

**Pros:**

- Keeps leaner API payloads.

**Cons:**

- Adds special-case merge behavior in the screen.
- Easier for future readers to miss.

**Effort:** 1 hour

**Risk:** Medium

## Recommended Action

Completed Option 1: included source video title and parent collection titles in the core job fragment used by live polling.

## Technical Details

**Affected files:**

- `apps/manager/src/lib/state.ts`
- `apps/manager/src/lib/state.test.ts`
- `apps/manager/src/features/jobs/live-job-detail-screen.tsx`

## Resources

- Review finding from architecture/pattern review on 2026-04-12.

## Acceptance Criteria

- [x] Collection title remains visible after a job detail polling refresh.
- [x] Source media remains visible after a job detail polling refresh.
- [x] Tests cover `toJobRecord()` or screen update behavior for source context preservation.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Reviewed `JOB_CORE_FIELDS`, `JOB_SOURCE_FIELDS`, and `LiveJobDetailScreen` polling state flow.
- Identified that polled job records can overwrite initial source context with `undefined`.

**Learnings:**

- UI read models used by live polling should preserve fields required by downstream widgets.

### 2026-04-12 - Review Fix

**By:** Codex

**Actions:**

- Added `video.title` and `video.parents { title }` to `JobCoreFields`.
- Added a live `getJob()` regression test that inspects the core fragment and confirms source fields map into the review read model.
- Verified with targeted manager state tests and package typecheck/lint.

**Learnings:**

- Polling contracts need tests at the query boundary, not only at the mapper boundary.
