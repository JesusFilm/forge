---
id: "feat-275"
title: "Watch mobile hero loading affordance"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on:
  - "feat-224"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mobile"
  - "video"
  - "loading-state"
---

## Problem

The Watch hero loader can distract mobile viewers when it remains centered over
visible video frames. Moving the buffering indicator into the existing
play/pause control keeps playback feedback close to the control that owns
playback. The poster-only loading state still needs a visible affordance for
slow connections, but it should be a semi-transparent opacity pulse over the
poster, not motion applied to the image itself.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` - hero media events,
   `playbackBuffering`, `coverLoading`, poster layer, and control wiring.
2. `apps/web/src/components/watch/HeroPlayerControls.tsx` - custom chrome
   play/pause button where committed buffering is displayed.
3. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - mocked
   MuxVideo event lifecycle and poster/loader regression coverage.
4. `docs/roadmap/platform/feat-224-watch-player-loading-indicator.md` -
   completed predecessor for the shared loading indicator.

## Grep These

- `heroPlayerLoading`
- `playbackLoading`
- `hero-chrome-loading`
- `hero-player-cover-loading-overlay`
- `onTimeUpdate`
- `playbackBuffering`
- `coverLoading`

## What To Build

1. Treat `timeupdate` as a playback-ready signal for the hero `MuxVideo` so
   mobile Safari can clear stale buffering even when no later `playing`,
   `canplay`, or `seeked` event arrives.
2. Preserve `waiting`, `stalled`, and `seeking` as buffering signals.
3. Move committed playback loading feedback from the center of the video frame
   into the custom chrome play/pause button slot.
4. Render poster-only loading as a separate semi-transparent pulsing overlay on
   top of the poster image.
5. Keep poster image pixels still; do not animate or transform the image.

## Constraints

- Do not change Mux source selection, posters, subtitles, tracking, route
  contracts, GraphQL, environment variables, or generated types.
- Do not change `WatchPlayerLoadingIndicator` styling for inline players.
- Keep inline video players out of scope.
- Keep the overlay non-interactive with `pointer-events-none`.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at `390x844` on
  `/watch/jesus.html/miraculous-catch-of-fish/english.html`: tap `Watch now`,
  confirm committed buffering shows `hero-chrome-loading` in the play button,
  not `hero-player-loading` centered over the video; slow poster-only loading
  shows `hero-player-cover-loading-overlay`.

## Completion Evidence

- `HeroPlayer` now passes `onTimeUpdate={handlePlaybackReady}` to the hero
  `MuxVideo`.
- Committed buffering state is exposed to `HeroPlayerControls` as
  `playbackLoading`.
- `HeroPlayerControls` renders `hero-chrome-loading` in the play/pause button
  while playback is actively loading.
- Poster loading renders `hero-player-cover-loading-overlay`, leaving the
  poster image class free of pulse animation.
