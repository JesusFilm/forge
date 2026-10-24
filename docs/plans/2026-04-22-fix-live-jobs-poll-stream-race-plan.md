---
title: "fix: Live jobs poll/stream race after SSE updates"
type: fix
status: completed
date: 2026-04-22
branch: feat/manager-live-jobs-sse-fallback
related_roadmap:
  - docs/roadmap/media-generation/feat-106-manager-live-jobs-sse-fallback.md
related_docs:
  - docs/plans/2026-04-22-feat-manager-live-jobs-sse-fallback-plan.md
  - docs/brainstorms/2026-04-22-manager-live-jobs-sse-fallback-brainstorm.md
todos:
  - "001"
---

# fix: Live jobs poll/stream race after SSE updates

## Overview

Review of the shipped live-jobs SSE work found one merge-blocking correctness
issue in the shared realtime controller: an older in-flight poll can still
apply after a newer stream event, which lets stale `/api/jobs` data overwrite
fresher SSE state in the list or detail views.

## Problem Statement

`apps/manager/src/features/jobs/live-jobs-realtime.ts` currently cancels
follow-up polling when stream events arrive, but it does not invalidate or
ignore an already-running manual refresh or reconciliation poll. That leaves two
bad outcomes in the live path:

1. A stale poll response can replace newer stream state after `snapshot` or
   `job-upsert` already moved the UI forward.
2. `requestResync()` can drop a needed reconciliation because it exits early
   whenever any poll is active, even if that poll is not the reconciliation that
   live mode actually needs.

This is a core trust issue for the feature: operators can briefly see the right
state and then watch the UI roll back to an older one.

## Proposed Solution

Treat stream-applied state as a version boundary that older polls cannot cross.
The fix should:

1. Invalidate in-flight poll generations whenever a newer stream event is
   applied.
2. Preserve reconciliation intent while another poll mode is active instead of
   dropping `needsResync`.
3. Keep manual refresh available, but ignore any result that is older than the
   newest stream-applied state.
4. Cover both list and detail controller behavior with focused regression tests
   before changing the implementation.

## Technical Approach

### 1. Tighten controller sequencing in `live-jobs-realtime.ts`

- Add a monotonic stream-generation or state-version marker that increments when
  `snapshot` or `job-upsert` is applied.
- Capture that marker when each poll starts.
- In `runPoll()`, apply the response only if:
  - the request is still the newest poll request, and
  - no newer stream generation has been applied since the poll began.

### 2. Preserve reconciliation intent explicitly

- Split "a poll is active" from "the requested reconciliation is satisfied."
- If `requestResync()` is called while a manual refresh is active, keep
  `needsResync: true` and schedule a follow-up reconciliation once the active
  poll finishes or is superseded.
- Avoid clearing `needsResync` just because an older poll returned
  successfully.

### 3. Keep degraded-mode behavior honest

- Ensure reconnect recovery still performs one authoritative reconciliation
  fetch after stream reconnect.
- Make sure terminal-job polling pause behavior remains intact after the race
  fix, especially for the detail screen.

## Red/Green TDD Plan

1. Add a failing controller test where a manual poll starts, a newer
   `job-upsert` arrives, and the stale poll result is ignored.
2. Add a failing controller test where a resync poll starts, a newer
   `snapshot` arrives, and the older poll does not clobber state.
3. Add a failing controller test where `requestResync()` fires during a manual
   poll and reconciliation still happens afterward.
4. Implement the smallest controller-state changes needed to make those tests
   pass.
5. Refactor only after the regression suite is green.

## User Smoke Test

After the fix lands:

1. Open the jobs list in one browser tab.
2. Start a manual refresh or otherwise trigger an in-flight poll.
3. Create or mutate a job through a second tab or authenticated API call so the
   list receives a newer SSE update first.
4. Verify the list never rolls back to the older pre-stream state when the poll
   resolves.
5. Repeat on a job detail page and confirm the attempts/status view does not
   regress after a live rerun update.
6. Capture a screenshot or equivalent trace showing the final state remained the
   newest one.

## Acceptance Criteria

- A poll started before a newer stream event cannot overwrite that newer state.
- `needsResync` is preserved until a qualifying reconciliation actually lands.
- Existing degraded polling and reconnect behavior still works.
- `pnpm --filter @forge/manager test` passes with the new regression coverage.
- `pnpm --filter @forge/manager lint` passes.
- `pnpm --filter @forge/manager typecheck` passes.
- A real browser smoke confirms list and detail do not roll back after the
  race scenario.

## Validation Results

- `pnpm --filter @forge/manager test` passed: 74 files, 427 tests.
- `pnpm --filter @forge/manager lint` passed.
- `pnpm --filter @forge/manager typecheck` passed.
- Browser smoke screenshot:
  `/tmp/b830-fix-live-list-20260423.png`
- Browser smoke screenshot:
  `/tmp/b830-fix-live-detail-20260423.png`

## References

- Todo: `todos/001-pending-p1-live-jobs-poll-stream-race.md`
- Current implementation:
  `apps/manager/src/features/jobs/live-jobs-realtime.ts`
- Live jobs feature plan:
  `docs/plans/2026-04-22-feat-manager-live-jobs-sse-fallback-plan.md`
