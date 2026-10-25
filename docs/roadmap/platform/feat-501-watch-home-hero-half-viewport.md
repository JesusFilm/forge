---
id: "feat-501"
title: "Keep the Watch home hero at least half-screen"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-14"
completed_date: "2026-09-14"
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

The muted Watch homepage hero still has a 34% viewport-height floor on desktop.
In short or wide browser windows, fitting the category rail above the fold can
therefore collapse the primary intro well below half the visible viewport. The
intro must remain at least half-screen at every breakpoint.

## Entry Points

1. `apps/web/src/lib/watch-home-hero-fit.ts` — shared fallback class and measured
   hero-height floor.
2. `apps/web/src/components/home/useWatchHomeHero.ts` — responsive measured fit.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` and
   `apps/web/src/lib/watch-home-hero-fit.test.ts` — sizing coverage.

## What To Build

1. Raise the desktop muted-intro floor from 34% to 50% of the visible viewport.
2. Apply the same floor before and after hydration.
3. Preserve category-rail fitting, the aspect-ratio target above the minimum,
   muted/unmuted transition, playback, and mobile behavior.
4. Add focused regression coverage for the desktop half-screen guarantee.

## Verification

- Focused hero-fit, Watch homepage, and production experience-wrapper suites:
  74 tests passed.
- Web typecheck and targeted ESLint: passed.
- Touched-file Prettier and `git diff --check`: passed.

## Completion Notes

- Raised the desktop measured-fit floor from 34% to 50% of the visible
  viewport.
- Raised the desktop pre-hydration/fallback Tailwind floor from `34svh` to
  `50svh`, preventing a hydration-time collapse below half-screen.
- Kept the existing aspect-ratio target above the minimum, mobile floor,
  category-rail fitting, and unmuted dimensions unchanged.
