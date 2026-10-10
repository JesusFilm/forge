---
status: complete
priority: p1
issue_id: "001"
title: Live jobs poll/stream race can overwrite fresher SSE state
labels:
  - code-review
  - manager
  - realtime
  - correctness
created_at: 2026-04-22
---

# Problem

`createLiveJobsRealtimeController` can still apply an older `/api/jobs` poll
response after the client has already received a newer SSE `snapshot` or
`job-upsert`. The live handlers only cancel follow-up polling, not an active
manual refresh or active resync poll, so a stale REST snapshot can clobber
newer stream state in the list or detail views.

# Why It Matters

This breaks the core contract of the feature. Operators can briefly see the
right live update and then watch the UI roll back to an older state until the
next reconciliation. In the same code path, `requestResync()` exits early when
any poll is active, so a needed reconciliation can be dropped entirely if the
in-flight request was a manual refresh instead of the intended live resync.

# Evidence

- File:
  `/Users/o/.codex/worktrees/b830/forge/apps/manager/src/features/jobs/live-jobs-realtime.ts`
- Relevant lines:
  - `497-529`: `runPoll()` applies successful poll results without checking
    whether a newer stream event already advanced local state.
  - `556-572`: `requestResync()` returns early whenever `activePollController`
    is non-null.
  - `613-663`: stream handlers clear follow-up polling only, leaving active
    manual/resync polls able to complete and overwrite state.

# Proposed Fix

1. Add a stream-aware generation/version guard so any applied stream event
   invalidates older in-flight poll results before they can commit.
2. Treat incoming stream data as authoritative enough to abort or ignore active
   manual/resync polls, not just follow-up polling timers.
3. Preserve pending reconciliation intent when a non-follow-up poll is active so
   `needsResync` is not silently lost.
4. Add regression tests that cover:
   - manual refresh racing with `job-upsert`
   - list resync poll racing with `snapshot`
   - dropped stream followed by reconnect/resync without stale overwrite

# Acceptance Criteria

- A poll started before a newer stream event must never overwrite that newer
  local state.
- Manual refresh still works, but stale results are ignored if the stream moved
  ahead while it was in flight.
- Reconciliation requests are not dropped just because a different poll mode is
  active.
- Regression coverage exists in manager tests for both list and detail
  controller behavior.

# Resolution

- `apps/manager/src/features/jobs/live-jobs-realtime.ts` now invalidates
  in-flight manual and resync polls when newer stream state is applied and
  preserves deferred reconciliation intent with an explicit latch instead of
  letting stale poll results overwrite stream state.
- `apps/manager/src/features/jobs/live-jobs-realtime.test.ts` now covers:
  - manual refresh plus newer list upsert
  - reconnect resync poll plus newer detail snapshot
