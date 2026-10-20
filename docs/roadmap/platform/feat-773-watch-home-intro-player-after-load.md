---
id: "feat-773"
title: "Start the Watch home intro player after page load"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "performance"
---

## Problem

The Watch home intro (`WatchHomeTvCarousel`) mounted its `<mux-video>`
player as soon as the page hydrated, and the player was also in the server
HTML. hls.js then fetched the master and rendition playlists and set up
media buffering while the page's scripts, font and images were still
loading. The watch-page `HeroPlayer` already waits for the window `load`
event before it mounts its preview
(`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`);
the home intro did not.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx`: `useWindowLoaded`,
   `WatchHomeTvMedia` (`previewSrc`), and `useWatchHomeMutedSubtitles`
   (`mediaMounted`).
2. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx`: "holds
   the intro player until the page has loaded, keeping the poster".
3. `apps/web/src/components/watch/HeroPlayer.tsx`: the existing load gate
   for the watch-page preview.
4. `apps/web/src/lib/hls-start-level.ts`: the bandwidth-test start. The
   home intro was measured with it and does not use it (see Constraints).

## Grep These

- `useWindowLoaded`
- `mediaMounted`
- `WATCH_HOME_INTRO_HLS_CONFIG`
- `withBandwidthTestStart`

## What To Build

Delivered:

- `useWindowLoaded()` returns `false` on the server and on the first client
  render. It turns `true` once `document.readyState === "complete"` or on
  the window `load` event. `previewSrc` is `null` until then, so the player
  is not in the server HTML and mounts after `load`. The poster layer under
  it renders as before.
- The muted-subtitle hook re-runs when the player mounts. Without this, the
  subtitle track never reached a player that mounted after its effect had
  run. An existing test caught that.
- The buffer, the 480p cap and the pause and reduced-motion behaviour are
  unchanged.

Measured on 2026-10-20 with a real-component fixture (three public Mux
streams, `next build` + `next start`, Playwright Chromium). Four variants
ran in interleaved order, four cold runs each, with a warm reload after
every cold run:

| Profile                           | Metric      | Before          | After           |
| --------------------------------- | ----------- | --------------- | --------------- |
| 390x844, 4x CPU, 150 ms, 1.6 Mbps | `load`      | 5,409-5,417 ms  | 5,169-5,178 ms  |
| same                              | LCP         | 4,748-4,764 ms  | 4,488-4,500 ms  |
| same                              | first frame | 9,977-10,333 ms | 8,629-10,080 ms |
| 390x844, 4x CPU, 300 ms, 1.0 Mbps | `load`      | 8,652-8,667 ms  | 8,279-8,283 ms  |
| 1280x800, 1x CPU, 20 ms, 20 Mbps  | first frame | 2,608-2,740 ms  | 2,548-2,938 ms  |

On both throttled profiles the first segment already started only after
`load`, so holding the player back costs it nothing. Stalls were 0 in every
cold run.

## Constraints

- Do not add the bandwidth-test start (`withBandwidthTestStart`) to the
  intro without a product decision. The intro ladder has only two rungs,
  480p at 1.66 Mbps and 270p at 0.86 Mbps. In the same runs the test let
  the intro start at 1.0 Mbps (270p, 11.6-13.3 s; the fixed 480p start
  never played within 15 s). But it cost about 2 s of first frame at
  1.6 Mbps (12.0-12.3 s against 10.0-10.3 s) and about 0.2 s on broadband.
- Do not shorten the 24-second read-ahead or lower the 480p cap to win a
  byte count. Both are documented design choices.
- Keep the poster-first layer. The intro must never blank while it waits.
- Known limit: a slow resource that delays `load` also delays the intro.
  This is the same trade-off `HeroPlayer` already makes. A viewer's Pause
  or Play pressed before `load` is respected once the player mounts.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home`
- The new test fails if the gate is removed and if `mediaMounted` is
  dropped from the subtitle effect's dependencies.
- In a production build, the home HTML has no `<mux-video>`. The first
  `stream.mux.com` request starts after `loadEventEnd`.
