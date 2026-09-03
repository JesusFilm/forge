---
id: "feat-452"
title: "Watch home autoplay continues after played-history exhaustion"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-03"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "web"
  - "video"
  - "carousel"
---

## Problem

The Watch homepage intro can stop after one video for returning viewers. The
random hero correctly selects the final unplayed catalog video, but the queue
builder applies the same persistent played history to every follow-on candidate.
It therefore returns a one-item queue. When playback ends, advancing wraps to
that same item, so the keyed media element does not change and playback stops.

## Entry Points — Read These First

1. `apps/web/src/lib/watch-home-carousel-sequence.ts` — persistent played state,
   pool exhaustion state, random hero selection, and progressive queue building.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` — mount-time hero
   selection, queue bootstrap, active slide, and ended/progress advancement.
3. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — keyed Mux player and
   `onEnded` wiring.
4. `apps/web/src/lib/watch-home-carousel-sequence.test.ts` and
   `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — pure queue
   and rendered playback regression coverage.

## Grep These

- `buildWatchHomeVideoQueue`
- `pickRandomWatchHomeHeroVideo`
- `readWatchHomeTvPlayedIds`
- `onEnded={handleEnded}`
- `key={activeSlide.id}`

## What To Build

- Preserve the preference for never-played videos while any are available.
- When played history leaves a multi-video catalog with only the active hero,
  roll the queue into a new cycle and append distinct eligible videos.
- Keep portrait exclusions and the single-eligible-video case safe.
- Prove both queue rollover and ended-event advancement with regressions.

## Constraints

- Keep the change inside the Watch homepage web carousel.
- Do not add network requests, dependencies, or render-time randomness.
- Do not weaken the hard exclusion for measured portrait sources.
- Preserve deterministic server/hydration behavior and the existing per-visit
  random draw after mount.

## Verification

- `buildWatchHomeVideoQueue` now runs its existing unplayed-first pass followed
  by one bounded selection-only rollover when distinct eligible videos remain.
  The rollover keeps persistent and per-pool history intact, preserves hard
  portrait exclusions, and never duplicates videos inside the queue.
- The rendered homepage regression seeds the final unplayed hero, dispatches
  the media `ended` event, observes a different keyed video, dispatches
  `canplay`, and confirms the replacement requests playback after the existing
  poster hold.
- `pnpm --filter @forge/web test -- src/lib/watch-home-carousel-sequence.test.ts src/components/home/__tests__/useWatchHomeTvCarousel.test.ts src/components/home/__tests__/WatchHomePage.test.tsx`
  — 63 tests passed.
- `pnpm --filter @forge/web typecheck` — passed.
- `pnpm --filter @forge/web lint` — passed, including the UI locale check.
- Touched-file Prettier check and `git diff --check` — passed.
- `ADMIN_GRAPHQL_URL=https://admin.jesusfilm.org/api/graphql pnpm --filter @forge/web build`
  — passed. The build compiled, type-checked, and generated all static pages.
- Loading-performance review: production code adds no import, dependency,
  request, image, timer, effect, or serialized payload. The only runtime work is
  a bounded in-memory scan over carousel pool data already in the client.
- Browser automation was unavailable in this checkout. The rendered jsdom test
  covers the exact ended-to-new-player-to-play chain; LFG's browser-test gate
  retains the environment limitation without claiming visual proof.

## Not In Scope

- Watch detail-page episode autoplay.
- Mobile or TV carousel implementations.
- Carousel visuals, controls, or content sourcing.
