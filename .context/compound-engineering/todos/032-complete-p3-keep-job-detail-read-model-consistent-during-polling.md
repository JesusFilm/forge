---
status: complete
priority: p3
issue_id: "032"
tags: [code-review, manager, jobs, read-model, polling]
dependencies: []
---

# Keep Job Detail Read Model Consistent During Polling

The job detail page initially loads a richer record shape than the one returned by the polling API, so source titles can disappear after the first client refresh.

## Problem Statement

This is a lower-severity read-model drift bug, but it works against the repo’s documented pattern of promoting metadata once and letting all consumers read the same shape. The detail page should not lose `sourceCollectionTitle` or `sourceMediaTitle` simply because polling switched from the server-rendered query to the thinner `/api/jobs/[id]` response.

## Findings

- [`page.tsx`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx:16) queries `video { title parents { title } }` on initial render.
- [`route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/route.ts:13) serves the polled detail payload by calling `getJob(id)`.
- [`state.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts:111) defines `GET_JOB` without `JOB_SOURCE_FIELDS`, so `getJob(...)` does not include the `video` relation used to derive source titles.
- The learnings doc in [`manager-job-read-model-source-language-metadata-20260409.md`](/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md) recommends fixing shared read-model projections instead of letting list/detail consumers drift.

## Proposed Solutions

### Option 1: Add `JOB_SOURCE_FIELDS` To `GET_JOB`

**Approach:** Make `getJob(...)` return the same source-title data already used by list/detail read models so polling preserves the initial page shape.

**Pros:**

- Smallest fix.
- Aligns the polling API with the existing page loader.
- Matches the repo’s shared read-model pattern.

**Cons:**

- Slightly increases the single-job API payload.

**Effort:** 1 hour

**Risk:** Low

---

### Option 2: Have The Detail Polling API Use The Same Query As The Page Loader

**Approach:** Reuse the richer detail query in the API route or centralize it in a shared read-model helper.

**Pros:**

- Avoids future drift between server render and polling.
- Makes the detail page contract explicit.

**Cons:**

- Slightly more refactoring than the minimal fix.

**Effort:** 2-3 hours

**Risk:** Low

## Recommended Action

Implemented Option 1. `getJob(...)` now includes `JOB_SOURCE_FIELDS`, so the
polled `/api/jobs/[id]` payload preserves the same source-title metadata used by
the initial server render.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/route.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/route.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx)

**Related components:**

- Job detail header in [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)

**Database changes:**

- No migration required.

## Resources

- **Known pattern:** [/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md](/Users/o/.codex/worktrees/f3a4/forge/docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md)
- **Polling route:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/route.ts:13](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/[id]/route.ts:13)
- **Thin GET_JOB query:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts:111](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/state.ts:111)

## Acceptance Criteria

- [x] Polling the job detail page preserves `sourceCollectionTitle` and `sourceMediaTitle`.
- [x] The polled `/api/jobs/[id]` payload matches the source-title fields used on the initial server render.
- [x] Tests cover the read-model shape used by detail polling.

## Work Log

### 2026-04-12 - Review Finding

**By:** Codex

**Actions:**

- Compared the detail page’s initial query to the polled `/api/jobs/[id]` response path.
- Confirmed the API route uses `getJob(...)`, whose `GET_JOB` query omits `JOB_SOURCE_FIELDS`.
- Cross-checked the repo learning about shared read-model consistency.

**Learnings:**

- This is a classic projection drift bug: the UI is not wrong, the polled record is thinner than the initial one.

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Added `JOB_SOURCE_FIELDS` to the `GET_JOB` query in `state.ts`, so the polled
  detail API carries the same `video` relation data used to derive source
  titles on first render.
- Kept the shared mapper tolerant of job nodes that omit `video`, so existing
  summary/utility call sites still parse safely.
- Added state-layer tests covering the richer `GET_JOB` projection.
- Ran:
  - `pnpm --filter @forge/manager test -- src/lib/state.test.ts src/lib/state-create.test.ts`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`

**Validation Evidence:**

- State tests now assert that the polled detail query includes the source-title
  fields used by the job detail page.

**Learnings:**

- This was a projection drift fix, not a rendering fix. Once the shared read
  model matched the page loader, the detail UI no longer had to special-case the
  first render versus polling.
