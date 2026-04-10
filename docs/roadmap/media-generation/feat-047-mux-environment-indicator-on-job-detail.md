---
id: "feat-047"
title: "Mux Environment Indicator On Job Detail"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-08"
duration: 1
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "mux"
  - "ai-pipeline"
---

## Problem

Operators can open the Mux player directly from the job detail page, but the UI does not say whether the current playback target belongs to the staging Mux environment or the production one. That makes QA review risky because the destination environment is only implicit in job metadata.

## Entry Points — Read These First

1. `apps/manager/src/features/jobs/live-job-detail-header.tsx` — renders the `Watch on Mux` action and the Mux asset metadata row.
2. `apps/manager/src/app/globals.css` — existing dashboard pill/button styling for small inline controls.
3. `apps/manager/src/app/api/enrich/route.ts` — writes `materialization` artifact metadata with `sourceEnvironment` / `targetEnvironment` for stage clone jobs.
4. `apps/manager/src/lib/state.ts` — normalizes artifact metadata into the `JobRecord.artifacts` manifest consumed by the detail page.

## Grep These

- `Watch on Mux` in `apps/manager/src/`
- `targetEnvironment` in `apps/manager/src/`
- `materialization` in `apps/manager/src/`
- `jobs-mux` in `apps/manager/src/app/globals.css`

## What To Build

1. Derive the effective Mux environment for the current job from `JobRecord.artifacts.materialization.data`.
2. Treat `targetEnvironment: "mux-stage"` and legacy `mode: "snapshot_to_stage_clone"` as staging.
3. Default to production when no staging metadata exists.
4. Add a compact icon-only indicator beside the existing `Watch on Mux` link.
5. Use yellow styling for staging and red styling for production.
6. Show a tooltip with exact environment copy on hover/focus: `Staging Mux environment` or `Production Mux environment`.
7. Add focused unit coverage for the environment classification helper.

## Constraints

- Do not add or change Strapi schema fields for this UI-only enhancement.
- Reuse existing dashboard visual language; no new component system or tooltip library.
- Keep the indicator tied to the current playable asset, not the source production asset metadata.

## Verification

- `pnpm --filter @forge/manager test -- src/lib/mux-environment.test.ts`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- Open a stage-clone job detail in `apps/manager` and confirm the icon next to `Watch on Mux` is yellow with `Staging Mux environment`.
- Open a direct-production job detail and confirm the icon next to `Watch on Mux` is red with `Production Mux environment`.
