---
title: "feat: Add System Status settings page to CMS admin"
type: feat
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-cms-admin-system-status-requirements.md
---

# feat: Add System Status settings page to CMS admin

## Overview

Add a "System Status" page under the Strapi admin Settings section that shows gateway sync status with live progress, data snapshot status with download links, and trigger buttons for both operations. This requires backend enhancements to expose in-progress sync state, admin-authenticated routes for data-snapshot, and a new admin UI page.

## Problem Frame

Gateway sync status and data snapshots are only accessible via raw API calls. Admins have no visibility into sync freshness or backup availability from within the Strapi admin — they must hit endpoints manually. (see origin: docs/brainstorms/2026-03-24-cms-admin-system-status-requirements.md)

## Requirements Trace

- R1. Settings page under Strapi admin Settings section
- R2. Gateway sync status: last run, state (idle/running/error), current phase, error summary
- R3. Live sync progress with record counts (e.g., "Videos: 142/500 (28%)")
- R4. Per-phase result summary after completion: created, updated, soft-deleted, errors
- R5. Data snapshot status: timestamp, file size, pre-signed download link
- R6. "Sync Now" trigger button with visual feedback
- R7. "Create Snapshot" trigger button with visual feedback
- R8. Disable trigger buttons while operation is in progress
- R9. Auto-poll every few seconds while an operation runs; stop when idle
- R10. Restrict to admin users (super-admin role)

## Scope Boundaries

- No websocket/SSE — polling only (see origin)
- No sync history or logs viewer — current/last-run only
- No notifications or alerts — pull-based
- Count queries for non-video phases are best-effort — if the gateway GraphQL API lacks a count query for a phase, show "X processed" without a total/percentage

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/gateway-sync/services/gateway-sync.ts` — `getSyncStatus()` returns `{ inProgress, lastRun, lastResult }`. Module-level singleton state. `lastResult` populated only after completion, not during execution.
- `apps/cms/src/api/gateway-sync/controllers/gateway-sync.ts` — `POST /api/gateway-sync/trigger` (202, fire-and-forget), `GET /api/gateway-sync/status`. Both use `admin::isAuthenticatedAdmin` policy.
- `apps/cms/src/api/gateway-sync/services/sync-videos.ts` — Already has `VIDEOS_COUNT_QUERY` that fetches `videosCount(where: { published: true })` from the gateway. Tracks `totalProcessed` vs `gatewayTotal` with percentage logging.
- `apps/cms/src/api/data-snapshot/services/data-snapshot.ts` — `getSnapshotStatus()` returns `{ inProgress, lastRun, lastResult: { key, duration, sizeBytes, error } }`.
- `apps/cms/src/api/data-snapshot/controllers/data-snapshot.ts` — `POST /api/data-snapshot/trigger`, `GET /api/data-snapshot/download`, `GET /api/data-snapshot/status`. Uses `secret-auth` middleware (x-snapshot-secret header), NOT admin JWT.
- `apps/cms/src/admin/app.tsx` — Bare skeleton, no plugins registered. Admin tsconfig already includes `../plugins/**/admin/src/**/*`.
- `apps/cms/config/plugins.ts` — Plugin configuration (upload, graphql, i18n, email).

### Institutional Learnings

- Strapi v5 bootstrap patterns: use `strapi.get('serviceName')` container, idempotent find-or-create (from `docs/solutions/cms/strapi-v5-bootstrap-webhook-seeding.md`)
- No existing institutional knowledge for Strapi admin plugin development — this is new territory

### External References

- Strapi v5 admin panel API: `addSettingsLink` in `bootstrap()` callback of `app.tsx`
- `@strapi/strapi/admin` exports: `useFetchClient`, `Page`, `Layouts`, `useNotification`
- `@strapi/design-system` v2.1.2: `Box`, `Flex`, `Typography`, `Button`, `Badge`, `Status`, `Alert`, `Loader`, `ProgressBar`, `Card`, `Table`
- `useFetchClient` auto-includes admin JWT, auto-aborts on unmount
- `Component` in `addSettingsLink` must be sync function returning Promise: `() => import('./path')`
- `to` property must be relative to `/settings/` — no leading slash

## Key Technical Decisions

- **`app.tsx` over local plugin**: The server-side changes are modifications to existing APIs (gateway-sync, data-snapshot), not new plugin-scoped APIs. A full `src/plugins/` structure adds unnecessary overhead for a single settings page. Register the page via `app.tsx` bootstrap, place page components in `src/admin/pages/`.
- **Admin-authenticated routes alongside secret-auth**: Data-snapshot routes currently use `x-snapshot-secret` middleware. Add parallel admin-authenticated routes so `useFetchClient` works. Keep existing secret-auth routes for scripts and cron.
- **Live progress via enhanced module-level state**: Add `currentPhase` and per-phase progress counters to the gateway-sync module-level state. No database persistence needed — status is ephemeral and acceptable to lose on restart.
- **Count queries are best-effort**: Videos already has a count query. Add count queries for other phases where the gateway API supports them. If a phase lacks a count query, show processed count without a total.

## Open Questions

### Resolved During Planning

- **How to register a settings page**: Use `addSettingsLink('global', { ... })` in `app.tsx` `bootstrap()`. The `to` path is relative to `/settings/`.
- **How to authenticate admin API calls from the UI**: `useFetchClient` from `@strapi/strapi/admin` auto-includes admin JWT.
- **How to handle data-snapshot auth gap**: Add parallel admin-authenticated routes with `admin::isAuthenticatedAdmin` policy. Both route sets call the same underlying service functions.
- **Auto-poll approach**: Use `setInterval` with cleanup on unmount. Poll every 3 seconds while `inProgress` is true for either operation. Stop polling when both are idle.

### Deferred to Implementation

- **Exact count queries available for non-video phases**: Need to inspect the gateway GraphQL schema at runtime or check `sync-languages.ts`, `sync-countries.ts`, `sync-keywords.ts`, `sync-video-variants.ts` for existing pagination/count patterns. If the gateway lacks a count query for a phase, degrade gracefully to showing processed count only.
- **Progress callback granularity**: The phase runners currently return a final `SyncStats` object. Adding mid-execution progress reporting requires either a callback parameter or mutating shared state. The exact mechanism depends on each phase runner's structure.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
┌─────────────────────────────────────────────────────┐
│  Strapi Admin (React)                               │
│                                                     │
│  Settings > System Status                           │
│  ┌──────────────────────┐ ┌──────────────────────┐  │
│  │ Gateway Sync         │ │ Data Snapshot         │  │
│  │                      │ │                       │  │
│  │ State: Running       │ │ Last: 2026-03-24      │  │
│  │ Phase: videos (3/5)  │ │ Size: 42 MB           │  │
│  │ Videos: 142/500 28%  │ │ [Download]            │  │
│  │ Languages: ✓ 50      │ │                       │  │
│  │ Countries: ✓ 30      │ │ [Create Snapshot]     │  │
│  │                      │ │                       │  │
│  │ [Sync Now] (disabled)│ │                       │  │
│  └──────────────────────┘ └──────────────────────┘  │
│                                                     │
│  Polls GET /api/gateway-sync/status (3s)            │
│  Polls GET /api/data-snapshot/admin/status (3s)     │
└─────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
  gateway-sync API           data-snapshot API
  (admin JWT auth)           (admin JWT auth — new)
         │                          │
         ▼                          ▼
  getSyncStatus() ────────►  getSnapshotStatus()
  enhanced with:             unchanged
  - currentPhase
  - completedPhases[]
  - phaseProgress { processed, total? }
```

## Implementation Units

- [ ] **Unit 1: Enhance gateway-sync status to expose live progress**

  **Goal:** Make `getSyncStatus()` return current phase, completed phases, and per-phase record counts during execution — not just after completion.

  **Requirements:** R2, R3, R4

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/api/gateway-sync/services/gateway-sync.ts`
  - Modify: `apps/cms/src/api/gateway-sync/services/sync-videos.ts`
  - Modify: `apps/cms/src/api/gateway-sync/services/sync-languages.ts`
  - Modify: `apps/cms/src/api/gateway-sync/services/sync-countries.ts`
  - Modify: `apps/cms/src/api/gateway-sync/services/sync-keywords.ts`
  - Modify: `apps/cms/src/api/gateway-sync/services/sync-video-variants.ts`
  - Test: `apps/cms/src/api/gateway-sync/services/__tests__/gateway-sync.test.ts`

  **Approach:**
  - Add module-level state: `currentPhase: SyncPhase | null`, `completedPhases: PhaseResult[]`, `phaseProgress: { processed: number; total: number | null } | null`
  - Update `getSyncStatus()` to include these fields alongside existing `inProgress`, `lastRun`, `lastResult`
  - In the `runSync` loop, set `currentPhase` before each phase runner and push to `completedPhases` after
  - Add a progress reporting mechanism: either a shared mutable object that phase runners update, or a callback passed to each runner. Each runner calls it periodically (e.g., after each batch/page) with `{ processed, total }`
  - For videos: the total count query already exists — wire it into the progress reporter
  - For other phases: check if they paginate through gateway results. If so, the runner knows how many records it has processed. Add count queries where the gateway API supports them (best-effort). If no count query exists, report `{ processed: N, total: null }`
  - Reset progress state at sync start and on completion

  **Patterns to follow:**
  - Existing `syncInProgress` / `lastRun` / `lastResult` module-level state pattern in `gateway-sync.ts`
  - `VIDEOS_COUNT_QUERY` pattern in `sync-videos.ts` for fetching totals

  **Test scenarios:**
  - `getSyncStatus()` returns `currentPhase` and progress during simulated execution
  - `completedPhases` accumulates results as phases finish
  - Progress resets when a new sync starts
  - Status returns clean state when no sync has ever run

  **Verification:**
  - `GET /api/gateway-sync/status` returns `currentPhase`, `completedPhases`, and `phaseProgress` while sync is running
  - After sync completes, `currentPhase` is null and `lastResult.phases` contains all phase stats

- [ ] **Unit 2: Add admin-authenticated routes for data-snapshot**

  **Goal:** Allow the admin panel's `useFetchClient` (which sends admin JWT) to call data-snapshot endpoints.

  **Requirements:** R5, R7

  **Dependencies:** None (parallel with Unit 1)

  **Files:**
  - Modify: `apps/cms/src/api/data-snapshot/routes/data-snapshot.ts`
  - Test: `apps/cms/src/api/data-snapshot/routes/__tests__/data-snapshot.test.ts`

  **Approach:**
  - Add a second set of routes with `admin::isAuthenticatedAdmin` policy under a distinguishable path prefix (e.g., `/api/data-snapshot/admin/status`, `/api/data-snapshot/admin/trigger`, `/api/data-snapshot/admin/download`)
  - These routes call the same controller handlers as existing routes
  - Keep existing `secret-auth` routes unchanged for scripts, cron, and CI usage
  - The route file already defines routes as an array — add the admin routes to the same array with the admin policy

  **Patterns to follow:**
  - Gateway-sync route definitions with `admin::isAuthenticatedAdmin` policy in `apps/cms/src/api/gateway-sync/routes/gateway-sync.ts`

  **Test scenarios:**
  - Admin JWT requests succeed against `/admin/status`, `/admin/trigger`, `/admin/download`
  - Unauthenticated requests to admin routes are rejected
  - Existing secret-auth routes continue to work unchanged

  **Verification:**
  - `useFetchClient.get('/api/data-snapshot/admin/status')` returns snapshot status
  - `useFetchClient.post('/api/data-snapshot/admin/trigger')` triggers a snapshot
  - `useFetchClient.get('/api/data-snapshot/admin/download')` returns a pre-signed URL

- [ ] **Unit 3: Register System Status settings page**

  **Goal:** Add the settings page registration and build the page component with full sync and snapshot UI.

  **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10

  **Dependencies:** Unit 1 (enhanced sync status), Unit 2 (admin snapshot routes)

  **Files:**
  - Modify: `apps/cms/src/admin/app.tsx`
  - Create: `apps/cms/src/admin/pages/SystemStatus.tsx`
  - Test: `apps/cms/src/admin/pages/__tests__/SystemStatus.test.tsx`

  **Approach:**

  _Registration (app.tsx):_
  - Add `bootstrap(app)` callback
  - Call `app.addSettingsLink('global', { ... })` with `id: 'system-status'`, `to: 'system-status'`, `intlLabel` with defaultMessage "System Status", and lazy `Component: () => import('./pages/SystemStatus')`

  _Page component (SystemStatus.tsx):_
  - Import `useFetchClient`, `Page`, `Layouts`, `useNotification` from `@strapi/strapi/admin`
  - Import design system components from `@strapi/design-system`: `Box`, `Flex`, `Typography`, `Button`, `Badge`, `Alert`, `Loader`, `Status`
  - Use `Layouts.Header` with title "System Status" and `Page.Main` wrapper
  - Two cards/sections side by side:
    1. **Gateway Sync** — shows state badge (idle/running/error), current phase if running, per-phase progress with counts, last run timestamp, "Sync Now" button
    2. **Data Snapshot** — shows last snapshot timestamp, file size, download link, "Create Snapshot" button
  - Polling: `useEffect` with `setInterval` (3 seconds) when either `inProgress` flag is true. Cleanup on unmount via `useFetchClient`'s auto-abort.
  - Trigger handlers: POST to trigger endpoints, show notification on success/error via `useNotification`
  - Button disable: based on respective `inProgress` state
  - Display completed phase results as a simple table or list: phase name, created, updated, soft-deleted, errors

  **Patterns to follow:**
  - `useFetchClient` pattern from Strapi v5 admin docs — auto JWT, auto-abort
  - `addSettingsLink` with sync function Component: `() => import('./pages/SystemStatus')`
  - `@strapi/design-system` component patterns (Box, Flex, Typography for layout)

  **Test scenarios:**
  - Page renders sync status with idle state
  - Page renders sync status with running state and current phase
  - "Sync Now" button triggers POST and disables while running
  - "Create Snapshot" button triggers POST and disables while running
  - Download link renders when snapshot exists
  - Polling starts when `inProgress` is true, stops when false
  - Error state displays alert with error message

  **Verification:**
  - Navigate to Settings > System Status in admin
  - Page shows current sync status and snapshot status
  - Clicking "Sync Now" triggers sync, page auto-polls and shows live progress
  - Clicking "Create Snapshot" triggers snapshot, page shows completion
  - Download link opens pre-signed S3 URL

## System-Wide Impact

- **Interaction graph:** The admin page consumes existing gateway-sync and data-snapshot services via HTTP. No new middleware, observers, or lifecycle hooks are introduced.
- **Error propagation:** API errors surface as notification toasts in the admin UI. No new error types or failure modes — the trigger endpoints already handle concurrent-run rejection.
- **State lifecycle risks:** Module-level sync state is ephemeral (lost on restart). This is acceptable per scope boundaries — no persistent state is introduced.
- **API surface parity:** New admin-authenticated data-snapshot routes mirror existing secret-auth routes. Both call the same service functions.
- **Integration coverage:** Manual testing in the admin UI is the primary verification. Unit tests cover component rendering and polling logic.

## Risks & Dependencies

- **Gateway count queries may not exist for all phases**: The gateway GraphQL API may not expose count queries for languages, countries, keywords, or video-variants. Mitigated by the "best-effort" scope boundary — degrade to showing processed count without a total.
- **Progress granularity varies by phase**: Small phases (languages, countries, keywords) may complete in seconds, making live progress less useful for those. The UI should handle phases that complete between polls gracefully.
- **Module-level state is process-specific**: If Railway runs multiple Strapi instances, each has independent sync state. This is an existing limitation of the sync architecture, not introduced by this work.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-24-cms-admin-system-status-requirements.md](docs/brainstorms/2026-03-24-cms-admin-system-status-requirements.md)
- Related code: `apps/cms/src/api/gateway-sync/`, `apps/cms/src/api/data-snapshot/`, `apps/cms/src/admin/`
- Strapi v5 admin panel API: https://docs.strapi.io/cms/plugins-development/admin-panel-api
- Strapi v5 admin navigation: https://docs.strapi.io/cms/plugins-development/admin-navigation-settings
