---
id: "feat-368"
title: "Production semantic recommendation tracer"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 10
depends_on: []
blocks:
  - "feat-369"
  - "feat-372"
  - "feat-373"
  - "feat-374"
  - "feat-375"
  - "feat-376"
  - "feat-377"
  - "feat-378"
  - "feat-381"
  - "feat-382"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "semantic"
  - "telemetry"
---

## Problem

Forge needs one production recommendation path that viewers can use in Watch and operators can reconcile in Admin before additional signals or generators are introduced.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U1 contract.
2. `apps/admin/prisma/schema.prisma`
3. `apps/admin/src/services/recommendations/`
4. `apps/web/src/components/sections/VideoRecommendations.tsx`
5. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `sceneRecommendations|VideoRecommendations`
- `WatchEventRecorder|recommendation`
- `dashboard/recommendations`

## What To Build

- Add recommendation-owned request, served-item, evidence, minimal episode/outcome, strategy-manifest, and audit records with the first migration.
- Wrap the current semantic retriever in a versioned response envelope while preserving the existing compatibility query and semantic fallback.
- Render an automatic below-player recommendation block in Watch and carry signed, server-bound evidence through impression, selection, playback start, finalized outcome, and classifier version.
- Create the Admin Recommendations overview and request-detail trace, including fallback, latency, loss, lag, conflict, retention, and purge health.

## Admin Evidence Gate

- A sampled request reconciles from request and ordered served items through visible impression, selection, successful start, finalized outcome, and classifier version.
- Admin separates zero activity from ingestion loss or lag and shows the pinned semantic strategy and fallback reason.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Use recommendation-owned tables; do not extend the legacy WatchEvent or WatchSearchEvent tables.
- Watch is the viewer-serving surface. Admin is observation, verification, and control only.
- Keep accepted evidence provisionally ineligible for learning until the integrity policy lands.
- Tokens must be short-lived, scoped, absent from URLs/logs, and backed by an explicit key-lifecycle decision before production enablement.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Run focused Admin migration, service, GraphQL, authorization, idempotency, and malformed/oversized-ingestion tests.
- Run focused Watch rendering, visibility, selection, recorder, accessibility, fallback, and instrumentation-degraded tests.
- Exercise the production Watch route in a browser and reconcile the trace in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`; `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
