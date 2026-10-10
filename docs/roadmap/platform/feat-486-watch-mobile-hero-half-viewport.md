---
id: "feat-486"
title: "Keep the mobile Watch hero at least half-screen"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-10"
completed_date: "2026-09-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
  - "responsive-design"
---

## Problem

The muted Watch homepage hero can shrink to 34% of the viewport on a phone so
the category rail fits above the fold. That makes the primary feature feel too
small on tall mobile screens. It should occupy at least half of the currently
visible viewport, even when the content below can no longer fit in the first
screen.

## Entry Points — Read These First

1. `apps/web/src/lib/watch-home-hero-fit.ts` — shared fallback class and measured
   hero-height floor.
2. `apps/web/src/components/home/useWatchHomeHero.ts` — responsive measured fit
   used after hydration.
3. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — muted and unmuted
   hero height classes.
4. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` and
   `apps/web/src/lib/watch-home-hero-fit.test.ts` — responsive sizing coverage.

## Grep These

- `WATCH_HOME_HERO_MIN_HEIGHT_RATIO`
- `WATCH_MUTED_INTRO_HEIGHT_CLASS`
- `34svh`
- `fitWatchHomeHeroHeight`

## What To Build

1. Raise the muted mobile hero floor from 34% to 50% of the visible viewport.
2. Apply the same floor before hydration and in the measured post-hydration
   fit.
3. Keep the existing 34% desktop floor and the unmuted hero dimensions.
4. Preserve the shared static-series/home fallback sizing contract.
5. Add focused regression coverage for the mobile and desktop floors.

## Constraints

- Do not change carousel content, playback, media loading, routing, analytics,
  or controls.
- Do not add requests, dependencies, observers, or hydration work.
- Keep desktop sizing unchanged.

## Verification

- Focused hero-fit, Watch homepage, and static series suites: 51 tests passed.
- `pnpm --filter @forge/web typecheck`: passed.
- Targeted Web ESLint: passed.
- Touched-file Prettier and `git diff --check`: passed.
- Headless Chromium geometry checks measured the hero at 350px for a 320×700
  viewport, 422px for 390×844, and 466px for 430×932: exactly 50% in every
  mobile case, with zero horizontal overflow.
- The 1280×800 desktop check retained the existing responsive result. The
  browser probe recorded zero added resource requests.

## Completion Notes

- Added a dedicated 50% mobile minimum to the measured fitting helper while
  retaining the existing 34% desktop minimum.
- Changed the pre-hydration mobile fallback to `50dvh`, so it follows the
  currently visible viewport as mobile browser chrome expands and collapses.
- Kept the shared Watch home/static-series height class aligned and left the
  unmuted dimensions unchanged.
- Added unit and integrated component coverage for the mobile floor.
