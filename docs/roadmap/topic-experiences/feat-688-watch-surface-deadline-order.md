---
id: "feat-688"
title: "Order the Watch surface deadline pairs"
owner: "vlad"
priority: "P2"
status: "in-progress"
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
- 2026-10-27: feat-792's event-recording repair replaces both 700 ms browser
  literals with named, ordered deadlines and includes an ordering test.
  Successful Admin exposure writes had sampled p95 1.63 seconds in the
  01:40–02:00 UTC window. Successful issuance had sampled p50 0.662 seconds,
  p95 2.287 seconds and max 3.670 seconds across 186 retained spans from
  26 Oct 06:00–18:40 UTC. These are APM samples, not population rates.
  Keep this ticket in progress until the production deadline pairs are
  verified after rollout.
