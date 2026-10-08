---
id: "feat-635"
title: "Use Pinned Mux Frame Recipes for Watch Home Posters and Thumbnails"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "media"
  - "performance"
---

## Problem

Watch home builds Mux frame URLs locally. Those variants omit the pinned frame
`time=2` and sometimes the `fit_mode=smartcrop` and dimensions, bypassing warm
Mux derivatives and the matching LQIP metadata.

## Entry Points - Read These First

1. `apps/web/src/lib/url.ts` - pinned 448x252 frame and 1280x720 hero recipes.
2. `apps/web/src/lib/watch-home.ts` - fallback thumbnail for cards.
3. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - hero poster and
   timeline thumbnail sources.
4. `apps/web/src/lib/__tests__/watch-home.test.ts` and
   `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` - recipe
   regression coverage.

## What To Build

- Remove local Mux thumbnail URL builders from the Watch home model and
  carousel.
- Use the existing pinned card-frame and full-width hero poster resolvers.
- Assert the exact shared recipe in tests.

## Verification

- Run the focused Watch home tests.
- Run Web typecheck and scoped lint/format checks.
- Run `git diff --check`.

## Resolution

- Card and timeline thumbnails now use `resolveMuxFrameThumbnailUrl`; full
  width hero posters use `resolveMuxHeroPosterUrlAtMaxWidth`.
- Removed duplicate local builders and updated exact recipe regression tests.
- Focused Watch home tests, Web typecheck, scoped lint, formatting, and
  `git diff --check` pass.
