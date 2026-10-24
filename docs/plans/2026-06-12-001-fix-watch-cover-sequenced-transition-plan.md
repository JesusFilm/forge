---
title: "fix: Watch cover sequenced transition"
type: "fix"
status: "completed"
date: "2026-06-12"
roadmap: "docs/roadmap/platform/feat-183-watch-cover-sequenced-transition.md"
origin: "user production validation"
---

# fix: Watch cover sequenced transition

## Summary

Make chapter carousel clicks follow the requested visual order: black out the
current player first, then change title/poster behind black, then reveal the
new cover and optionally pulse while video loads.

## Problem Frame

The merged route-poster bridge works, but it is triggered after the destination
route or optimistic payload is already visible. Because production route
commits are fast, users can see the title and poster change before the current
player visibly dims to black. The route transition must be sequenced, not only
animated.

## Requirements

- R1. Normal chapter clicks first animate the current player media area to
  black while the current title and poster remain active.
- R2. Title and poster changes happen only after the blackout delay.
- R3. The destination route push is delayed until after the blackout and reveal
  windows so a fast route commit cannot skip ahead of the visual sequence and
  a slow destination render cannot blank the first cover swap.
- R4. Modified clicks, middle-clicks, and already-prevented events keep native
  browser/link behavior.
- R5. The destination route poster still reveals out of black and may pulse
  while media is loading.
- R6. Playback source, Mux metadata, downloads, subtitles, share data, and
  public Watch URL contracts remain route-owned.

## Key Technical Decisions

- **KTD1. Parent-owned navigation sequencing:** When `WatchPageClient` owns the
  chapter navigation callback, `SiblingCarousel` prevents the default normal
  click and lets the page client push the route after the blackout interval.
- **KTD2. Separate covering and revealing phases:** `covering` renders only the
  current-player blackout. `revealing` applies the existing pending
  title/poster payload and waits for the black bridge reveal before pushing the
  route.
- **KTD3. Keep destination bridge:** The existing one-shot session-backed
  destination bridge remains necessary because the destination route mounts a
  fresh hero component.

## Implementation Units

### U1. Normal Click Interception

- **Goal:** Prevent fast route commits from outrunning the current-player
  blackout.
- **Files:** `apps/web/src/components/watch/SiblingCarousel.tsx`,
  `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`.
- **Approach:** For normal inactive clicks with a parent navigation callback,
  call `preventDefault()` and emit the existing intent. Leave modified clicks
  and local fallback behavior unchanged.
- **Test Scenarios:** Normal parent-owned click emits intent and prevents
  default. Modified click emits no pending feedback and does not prevent
  default.

### U2. Sequenced Page State

- **Goal:** Delay title/poster updates and route push until after the blackout
  begins.
- **Files:** `apps/web/src/components/watch/WatchPageClient.tsx`,
  `apps/web/src/components/watch/WatchSectionRenderer.tsx`,
  `apps/web/src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`.
- **Approach:** Add `covering` and `revealing` phase state. During `covering`,
  pass only a `coverBlackoutKey` to the hero. After
  `WATCH_CHAPTER_POSTER_BLACKOUT_MS`, set the existing pending chapter payload.
  After `WATCH_CHAPTER_POSTER_REVEAL_MS`, call `router.push(intent.href)`.
- **Test Scenarios:** Immediately after click, pending title/poster are absent
  and route push has not fired. After the blackout timer, pending title/poster
  appear and route push still has not fired. After the reveal timer, the route
  push fires.

### U3. Hero Blackout Overlay

- **Goal:** Render black over the current player before any optimistic swap.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/app/globals.css`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Add a `coverBlackoutKey` prop and a
  `watch-hero-cover-to-black` overlay animation in the media frame. Keep the
  existing poster bridge/reveal classes for the later reveal phase.
- **Test Scenarios:** With `coverBlackoutKey`, the hero still renders the
  current title and current poster, reports no poster transition, and includes
  the blackout overlay.

## Verification Commands

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on a local Watch route: click a chapter card and observe
  current player blackout before title/cover/route swap.
