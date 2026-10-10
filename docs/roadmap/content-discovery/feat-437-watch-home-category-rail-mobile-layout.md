---
id: "feat-437"
title: "Watch category rail mobile header layout"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-26"
duration: 1
depends_on:
  - "feat-426"
blocks: []
tags:
  - "watch"
  - "web"
  - "responsive"
  - "mobile"
---

## Problem

The Watch homepage category rail keeps its desktop two-column header grid on
mobile. At 390px, the long collection-inventory CTA consumes almost all of the
trailing column, leaving the title and description about 65px wide. The copy
wraps into a tall word stack and pushes the category cards hundreds of pixels
below their heading.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeCategoryRail.tsx` - category heading,
   description, CTA, and carousel layout.
2. `apps/web/src/components/home/__tests__/WatchHomeCategoryRail.test.tsx` -
   category rail rendering and layout-contract tests.
3. `docs/roadmap/content-discovery/feat-426-watch-home-category-rail.md` - the
   original rail requirements and geometry.

## Grep These

- `watch-home-category-see-all`
- `grid-cols-[minmax(0,1fr)_auto]`
- `watch-home-category-rail-title`
- `WatchHomeCategoryRail`

## What To Build

1. Stack the eyebrow, title, description, and CTA in one column below `md` so
   the CTA cannot compress the copy column.
2. Restore the existing two-column heading-and-CTA arrangement at `md` and
   above.
3. Pin the breakpoint and row-placement contract in the colocated component
   test.

## Constraints

- Do not change category destinations, ordering, translations, carousel card
  geometry, or homepage data fetching.
- Preserve the desktop header layout and localized inventory CTA.
- Keep the change CSS-only so it adds no client-side work or page-load cost.

## Verification

- The category header uses one full-width column below `md` and two columns at
  `md` and above.
- At 390px, title and description remain readable and the cards follow the CTA
  without the previous several-hundred-pixel gap.
- At desktop width, the CTA remains beside the eyebrow/title.
- `pnpm --filter @forge/web test -- WatchHomeCategoryRail`
- `pnpm --filter @forge/web typecheck`
- Local browser smoke at mobile and desktop widths, with no new console errors
  or page-loading resources.
