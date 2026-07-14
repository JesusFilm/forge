---
id: "feat-253"
title: "Watch experience section backdrop animation"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "experience"
  - "ui"
  - "accessibility"
---

## Problem

Watch series episode grids use a slow CSS pan-and-zoom animation for their
blurred artwork backdrop. Builder-authored experience media-collection sections
already crossfade between card artwork, but each resulting backdrop remains
static and feels inconsistent with the equivalent series grid treatment.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SeriesEpisodesGrid.tsx` - source pan-and-zoom
   backdrop structure and shared animation consumer.
2. `apps/web/src/components/sections/MediaCollection.tsx` - experience section
   default, entering, and exiting artwork layers.
3. `apps/web/src/app/globals.css` - Watch backdrop keyframes and shared
   animation utility.
4. `apps/web/src/components/sections/MediaCollection.test.tsx` - focused
   section rendering and interaction coverage.

## Grep These

- `watch-backdrop-pan-zoom`
- `animate-watch-backdrop-pan-zoom`
- `media-collection-default-backdrop`
- `media-collection-hover-backdrop`
- `watch-home-section-backdrop-enter`

## What To Build

1. Generalize the existing series backdrop animation into one shared Watch
   utility without changing its 28-second motion path.
2. Apply the shared animation to default and card-selected media-collection
   artwork through nested layers so existing crossfades remain independent.
3. Keep the backdrop movement active regardless of `prefers-reduced-motion`
   while keeping artwork swaps and section readability intact.
4. Add focused regression coverage and real-browser visual proof.

## Constraints

- Do not change Experience or MediaCollection data contracts, image selection,
  public Watch URLs, card layout, tinting, or Mux hover previews.
- Do not add a JavaScript animation loop, dependency, request, or image source.
- Keep pointer and keyboard focus behavior equivalent.
- Keep transformed backdrop layers clipped behind section content.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm exec prettier --check apps/web/src/app/globals.css apps/web/src/components/sections/MediaCollection.tsx apps/web/src/components/sections/MediaCollection.test.tsx apps/web/src/components/watch/SeriesEpisodesGrid.tsx apps/web/src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx`
- Browser smoke a representative Experience media-collection section at narrow
  and desktop widths in normal and reduced-motion modes, confirming the same
  motion remains active, with screenshots and clean console/network inspection.

## Completion Notes

- Generalized the series-only keyframe/utility into the shared
  `watch-backdrop-pan-zoom` / `animate-watch-backdrop-pan-zoom` contract while
  preserving its 28-second transform sequence on both series backdrop stacks.
- Experience `MediaCollection` backdrops now keep a stationary full-canvas
  artwork layer beneath a lower-opacity animated layer. Crossfade state remains
  on the outer wrapper, and the ambient layer remains active regardless of the
  browser's reduced-motion preference.
- Added default, hover/focus, overlapping enter/exit, leave-and-settle, no-image,
  and shared-series-consumer regression coverage. Focused suites pass with 27
  tests; Web typecheck and lint pass.
- Browser proof on `http://127.0.0.1:3000/watch` rendered eight experience media
  sections at 1440x900 and 390x844. Normal mode computed
  `watch-backdrop-pan-zoom 28s infinite`; the original reduced-motion behavior
  kept artwork swaps static while each stationary layer covered its section at
  both widths.
- Follow-up product direction explicitly superseded the original reduced-motion
  requirement. With `prefers-reduced-motion: reduce` forced in the browser, all
  eight experience layers still computed `watch-backdrop-pan-zoom 28s infinite`
  and their transforms changed over a 1.2-second sample.
- Rapid card changes retained entering and exiting layers together with a
  continuously painted base. Each stationary/moving pair reused the same inline
  source, producing zero data-URI network requests and no added animation
  library. A warm local navigation completed `loadEventEnd` in 557 ms.
- The original local LUMO route retained the shared 28-second animation on both
  series stacks. Browser page errors were empty; the only console warning was a
  pre-existing Watch hero `next/image` sticky-parent warning outside this scope.
- Visual proof:
  - `output/playwright/watch-experience-backdrop-desktop-initial.png`
  - `output/playwright/watch-experience-backdrop-desktop-hover.png`
  - `output/playwright/watch-experience-backdrop-narrow.png`
  - `output/playwright/watch-experience-backdrop-reduced-motion.png`
