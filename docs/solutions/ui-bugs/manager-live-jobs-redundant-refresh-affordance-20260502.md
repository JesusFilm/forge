---
title: "Manager live jobs redundant refresh affordance after SSE rollout"
date: "2026-05-02"
category: ui-bugs
module: apps/manager
problem_type: ui_bug
component: tooling
severity: medium
symptoms:
  - "Jobs list still showed a manual Refresh now button even though the page already had live SSE updates and normal browser reload."
  - "Job detail showed the same manual refresh control and Last update timestamp copy during live operation."
  - "Live-status copy exposed cache-style freshness text instead of only describing transport health."
  - "The shared live-jobs controller still carried manual-refresh-only state and API surface."
root_cause: logic_error
resolution_type: code_fix
related_components:
  - "apps/manager/src/features/jobs/live-jobs-table.tsx"
  - "apps/manager/src/features/jobs/live-job-steps-table.tsx"
  - "apps/manager/src/features/jobs/live-jobs-realtime.ts"
  - "apps/manager/src/features/jobs/live-jobs-realtime.test.ts"
tags:
  - manager
  - jobs
  - sse
  - polling-fallback
  - realtime
  - ui-copy
  - code-review
---

# Manager live jobs redundant refresh affordance after SSE rollout

## Problem

The Manager Jobs list and single-job detail screens had already moved to live
SSE updates with polling fallback, but the UI still behaved like a manual cache
surface. Both pages rendered a `Refresh now` button and `Last update ...` copy,
even though the important truth for operators was already the live transport
state: connecting, connected, or degraded to polling.

The extra control was not harmful in isolation, but it made the live-jobs
surface less honest. It suggested a user-facing recovery workflow that the
product no longer needed, and it left manual-refresh-only state hanging around
in the shared realtime controller.

## Symptoms

- `/dashboard/jobs` showed `Refresh now` while the page was already receiving
  live updates.
- `/dashboard/jobs/[id]` showed the same redundant refresh control.
- Both screens appended `Last update ...` timestamps to the live-status copy.
- The shared realtime controller still exposed `refreshNow`,
  `isRefreshInFlight`, and a manual poll mode even though the UI no longer
  needed them.
- Browser proof showed the pages working correctly without touching the button,
  which made the affordance visibly redundant.

## What Didn't Work

**Keeping the original polling-era affordance after SSE shipped**

- **Why it failed:** The UI kept advertising a manual refresh workflow even
  after the product moved to automatic live delivery with polling fallback.

**Only simplifying the visible copy**

- **Why it failed:** Leaving `refreshNow`, `isRefreshInFlight`, and
  `lastUpdatedAt` plumbing in place would keep needless controller and component
  complexity behind the scenes.

**Treating transport timestamps as operator truth**

- **Why it failed:** For this surface, operators care whether live updates are
  connected or degraded, not the client-local time a refresh happened.

## Solution

Remove the redundant manual-refresh affordance from both jobs surfaces and prune
the manual-refresh-only controller state so the UI reflects the actual live
transport model.

**Code changes:**

```tsx
// apps/manager/src/features/jobs/live-jobs-table.tsx
const unsubscribe = controller.subscribe(setRealtimeSnapshot)

const liveStatus = useMemo(() => {
  if (realtimeSnapshot.transportMode === "connecting") {
    return "Connecting live updates..."
  }
  if (realtimeSnapshot.transportMode === "polling") {
    return `Live updates reconnecting. Polling every ${Math.floor(FOREGROUND_POLL_DELAY_MS / 1000)}s`
  }
  return "Live updates connected"
}, [realtimeSnapshot.transportMode])
```

```ts
// apps/manager/src/features/jobs/live-jobs-realtime.ts
export type LiveJobsRealtimeSnapshot<TState> = {
  state: TState
  transportMode: LiveJobsRealtimeTransportMode
  isPollingPaused: boolean
  isReconnectPending: boolean
  needsResync: boolean
  lastFailureReason: LiveJobsRealtimeFailureReason
  lastSyncSource: LiveJobsRealtimeSyncSource
}

export type LiveJobsRealtimeController<TState> = {
  start: () => void
  stop: () => void
  subscribe: (listener: LiveJobsRealtimeListener<TState>) => () => void
  getSnapshot: () => LiveJobsRealtimeSnapshot<TState>
  replaceState: (state: TState) => void
}
```

**Files updated:**

- `apps/manager/src/features/jobs/live-jobs-table.tsx`
- `apps/manager/src/features/jobs/live-job-steps-table.tsx`
- `apps/manager/src/features/jobs/live-jobs-realtime.ts`
- `apps/manager/src/features/jobs/live-jobs-realtime.test.ts`
- `docs/roadmap/media-generation/feat-106-manager-live-jobs-sse-fallback.md`

## Why This Works

The page already has a browser-level refresh, so an extra in-app refresh control
was unnecessary. After the cleanup, the jobs surfaces expose only the transport
information the user actually needs:

- `Connecting live updates...`
- `Live updates connected`
- `Live updates reconnecting. Polling every 5s`
- detail-only paused fallback: `Polling paused (completed|failed)`

That makes the status copy more honest and simpler to maintain. It also keeps
presentation-only concerns out of the shared realtime controller. List/detail
components no longer need local timestamp bookkeeping or manual-refresh wiring
just to support one obsolete button.

Importantly, the real behavior did not regress:

- SSE still delivers live updates first.
- Polling fallback and reconnect reconciliation still work.
- Detail-page `replaceState(...)` still supports authoritative local updates for
  flows like subtitle override and transcription rerun.

## Prevention

- Treat live-jobs status as transport state, not as a mini cache dashboard.
- Keep list and detail status vocabulary aligned so sibling surfaces do not
  drift.
- Do not add manual refresh affordances unless the product explicitly needs a
  user-driven recovery action that browser reload cannot reasonably cover.
- Keep presentation-only UI decisions out of `live-jobs-realtime.ts`; that
  controller should expose correctness state, not one-off convenience flags.
- Reserve timestamps for domain truth like job attempts, step state, and
  artifacts, not client-local sync trivia.
- When fallback transport exists, degraded mode should preserve meaning rather
  than introducing extra controls.
- Reviewers should treat new `refresh`, `last updated`, or `sync time` strings
  on live surfaces as drift unless the PR also introduces a clear operator
  workflow that depends on them.

## Verification

Code validation:

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager exec eslint src/features/jobs/live-jobs-table.tsx src/features/jobs/live-job-steps-table.tsx src/features/jobs/live-jobs-realtime.ts src/features/jobs/live-jobs-realtime.test.ts
git diff --check
```

Observed results:

- `pnpm --filter @forge/manager test` passed with 88 files and 472 tests.
- `pnpm --filter @forge/manager typecheck` passed.
- Focused eslint on the touched jobs files passed.
- `git diff --check` passed.
- Full `pnpm --filter @forge/manager lint` remained blocked by an unrelated
  pre-existing Prettier issue in
  `apps/manager/src/app/.well-known/workflow/v1/webhook/[token]/route.js`.

Browser proof:

- DOM-level negative checks on both the jobs list and job detail pages returned
  `true` for the absence of `Refresh now` and `Last update`.
- Screenshots:
  - `output/playwright/b830-review-remove-refresh-jobs-list-20260502.png`
  - `output/playwright/b830-review-remove-refresh-job-detail-20260502.png`

## Related Docs

- Roadmap ticket:
  `docs/roadmap/media-generation/feat-106-manager-live-jobs-sse-fallback.md`
- Brainstorm:
  `docs/brainstorms/2026-04-22-manager-live-jobs-sse-fallback-brainstorm.md`
- Main implementation plan:
  `docs/plans/2026-04-22-feat-manager-live-jobs-sse-fallback-plan.md`
- Realtime race follow-up plan:
  `docs/plans/2026-04-22-fix-live-jobs-poll-stream-race-plan.md`
- Realtime race review artifact:
  `todos/001-pending-p1-live-jobs-poll-stream-race.md`
- Adjacent Manager read-model truth boundary:
  `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
- Durable job-state storage context:
  `docs/solutions/cms/strapi-enrichment-job-content-type.md`
