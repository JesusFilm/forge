---
id: "feat-762"
title: "Give the Watch home hero preview a pause control and honour reduced motion"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-21"
duration: 3
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
  - "accessibility"
---

## Problem

The `/watch` home hero plays a muted video preview automatically and advances
to the next slide by itself. Observed on production 2026-10-20 (round-03
accessibility audit, headless Chromium 1280x800):

- After 6 s the hero `<video>` was playing (`paused: false`, `currentTime` ≈ 4 s)
  with `prefers-reduced-motion: no-preference` **and** with `reduce`.
- The hero exposes "Watch Now", "Unmute preview" and slide buttons. No button
  pauses or stops the preview or the auto-advance
  (`[...document.querySelectorAll("button")]` matching `/pause|stop/i` → none).

WCAG 2.2 SC 2.2.2 Pause, Stop, Hide (Level A) asks for a way to pause, stop or
hide moving content that starts automatically, lasts more than five seconds
and sits beside other content. A reduced-motion preference is a strong signal
that the visitor does not want autoplaying motion.

This is a product/design decision (the preview is the hero's main draw), so it
was not changed in the audit PR.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — preview playback,
   auto-advance ring (`paused`/`isTurnHeld`), `usePauseForWatchModal`,
   `useWatchHomeHeroScrollPause`.
2. `apps/web/src/components/home/WatchHomeHero.tsx`, `useWatchHomeHero.ts`.
3. `apps/web/src/components/watch/HeroPlayer.tsx` — existing
   `prefers-reduced-motion` handling to reuse.
4. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.

## Grep These

- `Unmute preview`
- `isTurnHeld`
- `prefers-reduced-motion`
- `motion-reduce:`

## What To Build

- A visible, keyboard-reachable Pause/Play toggle (`aria-pressed` or a
  label that flips between "Pause preview" and "Play preview") next to the
  existing Unmute button. Pausing holds both the video and the auto-advance ring.
- Under `prefers-reduced-motion: reduce`, start with the poster and no
  auto-advance. The visitor can still press Play.
- Translate the new labels in the existing `WatchHome` namespace.

## Constraints

- Keep poster-first page load. Do not start media work earlier.
- Keep GA/Datadog events. Add events only through the existing reporting path.
- Do not change the `?t=` Watch Now link behaviour (open PR #2383 owns that).

## Verification

- Unit: pause toggle stops video and ring; reduced-motion renders paused.
- Real browser: Tab reaches the toggle; Space toggles; with
  `prefers-reduced-motion: reduce` the video stays paused after 10 s.
- Before/after page-load timing for `/watch` on a mobile profile.
