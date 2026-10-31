---
id: "feat-780"
title: "Count the Watch home hero's first poster as LCP on slow phones"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

The Watch home hero mounts its first slide with the `watch-home-media-enter`
animation, which starts at `opacity: 0`. On a slow phone the preloaded poster
is often decoded before the hero reveals, so its first paint lands on that
invisible frame. Chrome does not count an `opacity: 0` paint and does not
re-report the image when it fades in. Largest Contentful Paint then falls to
the next slide's poster when the carousel advances, after the page `load`.

Lab evidence (2026-10-21, local `next start`, live production Admin content
read anonymously, Chromium, 390x844 Android UA, 4x CPU, 150 ms RTT, 1.6 Mbps,
cache off, 6 to 12 interleaved runs per side):

| `/watch`                                                 | LCP median             |
| -------------------------------------------------------- | ---------------------- |
| `main` `2bcf98e19`                                       | 5,684 ms               |
| `main` with the enter animation disabled by injected CSS | about 2,140 ms (= FCP) |

With less competing script and font bytes (the open audit integration), the
poster is ready earlier and the late LCP got worse (median 7,774 ms, LCP after
`load` in 9 of 12 runs). Unthrottled runs were not affected.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — `WatchHomeTvMedia`,
   the entering `WatchHomeTvVisualLayer`, and `useHasLeftInitialSlide`.
2. `apps/web/src/app/globals.css` — `@keyframes watch-home-media-enter`.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — "paints the
   first slide's poster without the enter fade".

## Grep These

- `watch-home-media-enter`
- `useHasLeftInitialSlide`

## What To Build

The first slide the carousel mounts with renders its poster without the enter
animation. Every later slide change, including a return to the first slide,
keeps the crossfade. No change to preloading, poster choice, playback or the
intro player gate.

## Constraints

- Do not drop the crossfade between slides.
- Do not add a consent, analytics or recommendation change.
- `WatchUnavailableLanguageClient` uses the same class on its hero. It is not a
  home LCP surface and is left alone here.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home`
- The new test fails with the unconditional `watch-home-media-enter` class.
- Throttled interleaved A/B of `/watch` against `main` on real content: LCP is
  the first slide's poster and close to FCP; CLS and FCP unchanged.
- Field: Datadog RUM `/watch` LCP on Android after deploy (not measured yet).
