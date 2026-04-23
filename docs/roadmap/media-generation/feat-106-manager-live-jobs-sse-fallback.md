---
id: "feat-106"
title: "Manager Live Jobs via SSE + Polling Fallback"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-04-22"
duration: 7
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "realtime"
---

## Problem

The Manager jobs list and job detail pages currently feel live only because they
poll the jobs APIs on an interval. That works for one open screen, but it is
not true shared realtime: multiple operators or multiple open tabs can wait up
to the next poll window before they see retries, step progress, failures, or
completion. The chosen product direction is shared live updates across open
Manager screens, with server-sent events as the primary transport and the
existing polling path retained as a fallback.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-22-manager-live-jobs-sse-fallback-brainstorm.md` — chosen product shape and resolved transport decision
2. `apps/manager/src/features/jobs/live-jobs-polling.ts` — current polling cadence and stale-response guardrails
3. `apps/manager/src/features/jobs/live-jobs-table.tsx` — jobs list polling client and live-status copy
4. `apps/manager/src/features/jobs/live-job-steps-table.tsx` — single-job detail polling client and terminal-state behavior
5. `apps/manager/src/features/jobs/live-job-detail-screen.tsx` — review-context refresh tied to job updates
6. `apps/manager/src/app/api/jobs/route.ts` — jobs list API surface used by polling fallback
7. `apps/manager/src/app/api/jobs/[id]/route.ts` — single-job API surface used by polling fallback
8. `apps/manager/src/lib/state.ts` — shared job read/write boundary and the natural event-emission seam
9. `apps/manager/src/types/job.ts` — canonical `JobRecord` contract consumed by list and detail UIs

## Grep These

- `live-jobs-polling|shouldApplyPollResult` in `apps/manager/src/features/jobs/`
- `api/jobs\\?view=summary|/api/jobs/` in `apps/manager/src/features/jobs/`
- `createJob|getJob|listJobSummaries|updateJob|updateStepStatus` in `apps/manager/src/lib/`
- `review-context|updatedAt` in `apps/manager/src/features/jobs/`
- `EventSource|text/event-stream|WebSocket` in `apps/manager/src/`

## What To Build

1. Add a Manager realtime jobs transport based on server-sent events that can push additive job-change notifications to open clients.
2. Keep the existing jobs list and single-job APIs as the authoritative reconciliation path when the realtime stream disconnects, misses events, or is unavailable.
3. Update the jobs list so active rows, progress states, and empty-state transitions respond to pushed job changes instead of waiting for the next poll interval.
4. Update the job detail experience so step progress, terminal-state transitions, and any dependent refreshes react to pushed updates for the active job.
5. Emit job-change events from the shared manager state boundary so job creation, retries, overrides, and workflow-driven status changes all drive the same live transport.
6. Make reconnect behavior explicit: after reconnect, clients should resync against the normal APIs rather than assuming the stream delivered every change.
7. Preserve a clear degraded mode so the UI can continue functioning with polling only when SSE is unavailable in local dev or deployment topology.

## Constraints

- Do not remove polling completely in this ticket; fallback and reconciliation are part of the chosen design.
- Do not redesign the Jobs information architecture or step taxonomy in the same PR.
- Do not introduce a broader generic websocket framework unless planning proves SSE is insufficient.
- Do not make local-only optimistic UI the source of truth for job progress; shared backend job state must drive visible updates.
- Keep list and detail contracts aligned through the existing `JobRecord` boundary rather than inventing divergent live payload shapes without a strong reason.
- Account for deployment reality: process-local push may not be sufficient if Manager runs on multiple instances, so the plan must make that boundary explicit.

## Verification

- Two open Manager jobs list screens reflect job creation and progress changes without waiting for the next scheduled poll.
- An open jobs list and an open job detail screen stay in sync as the same job advances through workflow steps.
- Disconnecting or disabling the realtime stream falls back cleanly to polling without breaking jobs visibility.
- Reconnecting after a dropped stream reconciles with the normal jobs APIs and lands on correct current state.
- Terminal jobs stop consuming unnecessary high-frequency update work while still rendering final state correctly.
- Local dev and deployed environments both have a documented truth for how SSE works and when polling fallback takes over.
