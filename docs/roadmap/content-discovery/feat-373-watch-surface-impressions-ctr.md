---
id: "feat-373"
title: "Watch surface impressions and CTR"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 5
depends_on:
  - "feat-368"
blocks:
  - "feat-374"
  - "feat-375"
  - "feat-388"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "impressions"
  - "ctr"
---

## Problem

Clicks cannot be interpreted without eligible impressions across every Watch block that can lead to a video.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U6 contract.
2. `apps/web/src/components/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `IntersectionObserver|trackVisibility`
- `MediaCollection|carousel|VideoCard`
- `surface|placement|impression`

## What To Build

- Create a finite registry of click-bearing Watch surfaces, blocks, presentations, placements, items, and policy versions.
- Reuse one exposure primitive across static lists, carousels, search, home, editorial blocks, and below-player recommendations.
- Record one eligible impression per exposure window plus rendered, selected, repeated, and capability-dependent visibility state.
- Migrate registered surfaces incrementally while Admin exposes missing instrumentation.

## Admin Evidence Gate

- Show served, rendered, eligible-impression, and selection counts with CTR by surface, block, presentation, and position.
- Show registry completeness, duplicate rate, visibility capability, and instrumentation gaps so partial migration cannot look complete.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Use portable intersection ratio, page visibility, and dwell. Treat occlusion as unknown when visibility tracking is unsupported.
- Selection before an eligible impression remains an observable anomaly; do not synthesize an impression.
- This ticket measures exposure and CTR but does not authorize CTR as the optimization objective.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test below-fold, carousel movement, hidden tabs, repeated intersections, responsive changes, selection-before-impression, and navigation replay.
- Test capability detection for occlusion-aware visibility and unknown fallback.
- Run component-family tests and reconcile every registered surface in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
