---
id: "feat-775"
title: "Reserve the Watch recommendation slot's layout while it loads"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
  - "recommendations"
---

## Problem

The semantic recommendation slot after `WatchBody` rendered a fixed 192 px
loading box, then the list. Production deliveries fill the six-item slate, so
the slot grew to 1,974 px at 390 px wide (916 px at 768, 678 px at 1280) and
pushed Bible Quotes and everything below it down. With the slot on screen this
scored CLS 0.35 to 0.51 on phones (local real-content build, fixture delivery)
and 0.36 in one production run.

Field context (Datadog RUM, 7 days to 2026-10-21): 1,900 of 10,479 mobile Watch
views had CLS above 0.1 (above the "good" threshold; 0.1 to 0.25 needs
improvement, above 0.25 is poor). The loading placeholder was the most common
largest-shift target (775 views). Correlation only: it does not show that this
slot caused all of those views, and the field records point at a second,
separate mechanism (see feat-776).

## Entry Points — Read These First

1. `apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx`:
   the `status === "loading"` branch, `RecommendationListSkeleton`, and the
   layout effect that compensates scroll after the placeholders are removed.
2. `apps/web/src/components/sections/VideoRecommendations.tsx`: the real grid
   and card typography the skeleton mirrors.
3. `apps/admin/src/services/recommendations/contracts.ts`: `MAX_DELIVERY_ITEMS`.
4. `apps/web/CLAUDE.md`, "Watch semantic recommendations".
5. `docs/analytics-and-recommendation-policy.md`: empty and partial rows are
   accepted coverage outcomes.

## Grep These

`RecommendationListSkeleton|MAX_RECOMMENDATION_ITEMS|removedSkeleton|loadingLabel`

## What To Build

- While loading, render a decorative (`aria-hidden`) skeleton with the same
  heading, `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` grid, card text lines
  and personalization line as the ready list, sized by the same typography so
  it tracks breakpoints and text zoom. Reserve the contract maximum of six
  cards.
- Keep the section's `aria-busy` loading label; placeholders are never links,
  so they never reach the render or impression observers.
- Empty, unavailable and failed deliveries still collapse to nothing. When the
  viewer has already scrolled past the reserved slot, move the scroll position
  up by the removed height so the content they are reading stays still.

## Constraints

- No change to delivery, ranking, timing, single-flight, capability handling,
  impressions (50% visible for one second, real cards only), analytics or
  language routing.
- Do not keep a permanent blank area for empty results.
- Do not add a consent prerequisite or treat sparse coverage as a defect.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/recommendations`
  (the tab-storage lifecycle case fails on main too).
- Hybrid browser check: real local Web with production Admin content and a
  fixture-fulfilled delivery, at 320, 390, 768 and 1280 px, for full, partial,
  empty and failed deliveries. Full deliveries hold their height exactly.
- Throttled mobile page-load runs show no FCP, LCP or load regression.
