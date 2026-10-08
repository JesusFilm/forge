---
id: "feat-628"
title: "Watch Home compositor progress ring"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

Watch Home animates the hero progress ring with `stroke-dashoffset`, which is
not compositor accelerated and contributes to a mobile layout shift cluster.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — progress and reset
   ring markup and pause/buffering behavior.
2. `apps/web/src/app/globals.css` — ring keyframes and reduced-motion styles.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — carousel
   progress behavior tests.

## Grep These

- `watch-home-progress-ring`
- `watch-home-progress-ring-reset`
- `stroke-dashoffset`

## What To Build

Keep the ring's dash geometry fixed and animate `transform: rotate()` only.
Preserve the slide-duration timing, pause behavior, buffering dim, reset cue,
and reduced motion behavior. Keep the loading spinner's rotation animation.

## Constraints

- Do not animate `stroke-dashoffset` or other layout/paint-only properties.
- Do not change slide selection timing or buffering semantics.

## Verification

- Add focused assertions that progress and reset circles have fixed dash geometry.
- Run the Watch Home page tests, Web typecheck, and lint.
- Confirm the progress keyframe animates only `transform` and the reset
  keyframe animates only `opacity`.
