---
id: "feat-224"
title: "Watch player loading indicator"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-30"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "video"
---

## Problem

The Watch hero player uses a plain generic spinner while media is buffering,
and the general inline video player has no visible load state at all. On first
autoplay load, chapter transitions, slow manifests, or buffering playback, the
player can look inert instead of acknowledging that video is loading.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` - hero media activation,
   `videoReady`, and `hero-player-loading`.
2. `apps/web/src/components/sections/Video.tsx` - general inline Mux-backed
   player, media event listeners, and center controls.
3. `apps/web/src/components/watch/WatchPlayerLoadingIndicator.tsx` - shared
   Watch-aligned loading indicator.
4. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - hero
   loading lifecycle coverage.
5. `apps/web/src/components/sections/__tests__/Video.test.tsx` - general
   player loading lifecycle coverage.

## Grep These

- `WatchPlayerLoadingIndicator`
- `hero-player-loading`
- `video-player-loading`
- `watch-player-loading-indicator`
- `waiting`
- `stalled`
- `canplay`
- `playing`

## What To Build

1. Replace the hero's generic SVG spinner with a Watch-styled centered loading
   indicator that matches the dark player chrome.
2. Add the same indicator to the general inline video player, centered inside
   the video frame.
3. Show the general player loader on initial source load and media buffering
   events (`loadstart`, `waiting`, `stalled`, `seeking`).
4. Hide the loader once playback can render (`loadeddata`, `canplay`,
   `playing`, ready `seeked`) or when a media error hands off to the browser's
   own error surface.
5. Keep the loader non-interactive so play, mute, fullscreen, and timeline
   controls remain responsible for input.

## Constraints

- Do not change Mux tracking, source selection, poster selection, subtitles, or
  public Watch URL contracts.
- Do not replace the small generic `SpinnerIcon` used by non-player UI such as
  search buttons.
- Respect reduced-motion settings for loader animation.
- Avoid effect-driven synchronous state resets that violate React Compiler
  rules.

## Verification

- `pnpm --filter @forge/web test -- src/components/sections/__tests__/Video.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at `390x844` on
  `/watch/jesus.html/miraculous-catch-of-fish/english.html`: tap `Watch now`
  and confirm `watch-player-loading-indicator` appears centered inside
  `hero-player-loading`.

## Completion Evidence

- Added `WatchPlayerLoadingIndicator` with a dark translucent surface, white
  spinner ring, and red center pulse.
- Hero buffering now renders the shared loader.
- General inline video loading and buffering states now render the same loader
  in the middle of the video frame.
