---
id: "feat-776"
title: "Find the Watch early-paint shift that moves the body below the player"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-22"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

Field CLS records for mobile Watch views often name the recommendation
loading placeholder as the largest-shift target with `previous_rect` near
y 444 to 474, height 192, and an empty `current_rect`: the viewer has not
scrolled, the placeholder is painted just below the player, and something
then moves it below the viewport about 80 ms after first paint. That is not
the slot growing (fixed by feat-775); content above the slot changes.

Reproduced locally on unmodified main (`4fe360bf6`, real Admin content,
throttled mobile probe with an Android user agent): 4 of 12 runs scored CLS
0.34 at about 2.25 s, always in runs with an early LCP (about 1.88 s). Sources
were the placeholder (y 474 → off screen) and `watch-subtitle-transcript`
(y 730 → off screen). A probe without the Android user agent and at DPR 2 did
not reproduce it in 6 runs, so it is timing-sensitive.

## Entry Points — Read These First

1. `apps/web/src/components/watch/WatchSectionRenderer.tsx`: top-zone Suspense
   fallback and the body-zone blocks with `fallback={null}`.
2. `apps/web/src/components/watch/HeroPlayer.tsx` and `SiblingCarousel.tsx`:
   what changes height around 2 s into a throttled load.
3. Audit evidence: `forge-audits/2026-10-20-followup/round-02/` (`perf-main-12.json`,
   `early-shift.mjs`, `cls-probe.mjs`).

## Grep These

`hero-player-wrapper|watch-body-zone|fallback={null}|h-\[66svh\]`

## What To Build

Trace the frame where the body sits directly under the player (record element
tops every animation frame in the failing runs), name the element whose height
changes, and reserve its layout. No change to playback startup order.

## Constraints

Keep player startup independent of the body and the recommendation slot. Do
not hide content to suppress the metric.

## Verification

Repeat the throttled mobile probe (12 or more runs) and show the 0.34 runs are
gone, then confirm in field data after deployment.
