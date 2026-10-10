---
id: "feat-688"
title: "Order the Watch surface deadline pairs"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-12"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "recommendations"
  - "reliability"
---

## Problem

feat-687 fixes the content-action pair only. The same browser-aborts-before-the-route-can-answer ordering remains on two other Watch recommendation routes, both driven by unnamed `700` literals in `WatchExposureBoundary.tsx`.

## Entry points

- `apps/web/src/components/recommendations/WatchExposureBoundary.tsx` (exposure flush and surface-delivery fetches, both `700`)
- `apps/web/src/lib/recommendations.ts` (`recordWatchSurfaceExposure` 900 ms upstream, `issueWatchSurfaceDelivery` uses the 3 s evidence upstream)
- `apps/web/src/lib/recommendation-timeouts.ts`

## Findings to confirm before changing anything

- Surface exposure: browser 700 ms, upstream 900 ms.
- Surface delivery: browser 700 ms, upstream 3,000 ms.
- Measure real Admin latency for both writes first; give each pair named constants and an ordering test, using the admission budget in feat-687 as the floor.

## Constraints

- Scope is the other deadline pairs only. No ranking, coverage, consent or content-action change.
- Do not shrink an upstream budget without latency evidence.

## Tracking

- Found while validating FGE-188 (feat-687).
