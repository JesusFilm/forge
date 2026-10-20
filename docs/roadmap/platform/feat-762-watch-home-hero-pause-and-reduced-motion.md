---
id: "feat-762"
title: "Give the Watch home hero preview a pause control and honour reduced motion"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
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

The round-03 audit PR left this as a design question. Round 04 (2026-10-20)
checked the actual constraints: no product policy forbids a pause control,
and the hero already owned every piece needed (a deferred-play hold, a turn
clock that parks while held, CSS that already drops slide transitions under
`prefers-reduced-motion`). So it was fixed inside the existing design.

## Resolution (2026-10-20)

- The current-slide circle in the hero timeline (`WatchHomeVideoTimeline`)
  is the pause control. Its progress ring is the auto-advance clock, so it is
  what pausing stops. It was a disabled no-op button before. It now reads
  "Pause" / "Play" from the existing `HeroPlayerControls` catalog keys (no
  new keys, every locale already translated) and shows a pause or play
  glyph. It stays `aria-current="true"`. No new button was added to the
  crowded phone action row.
- `useWatchHomeTvCarousel` gained `isUserPaused` / `toggleUserPaused`. A
  user pause blocks playback requests (the same deferred-play path a Watch
  modal uses), pauses the media, holds the turn clock and the dead-stream
  ceiling, and holds a same-slide replay. Resume plays the held turn or the
  element it paused.
- `prefers-reduced-motion: reduce` starts the hero paused on its poster.
  A later switch TO reduce pauses; a switch away never starts motion. Play
  still plays.
- The phone action row now wraps instead of truncating "Watch Now"
  (production at 320 px showed "Watc…" and "Ver a…").
- The film/episode watch-page hero (`HeroPlayer`) auto-starts the same
  kind of looping muted preview after page load. Under reduced motion it now
  keeps the poster: `canActivatePreview` refuses automatic activation. Watch
  now and an `?autoplay=1` arrival (an explicit request) still play.

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

- A visible, keyboard-reachable Pause/Play toggle whose label flips between
  "Pause" and "Play". Pausing holds both the video and the auto-advance ring.
  (As built: the current-slide circle, see Resolution.)
- Under `prefers-reduced-motion: reduce`, start with the poster and no
  auto-advance. The visitor can still press Play.
- Reuse translated labels (as built: `HeroPlayerControls.play`/`pause`).

## Constraints

- Keep poster-first page load. Do not start media work earlier.
- Keep GA/Datadog events. Add events only through the existing reporting path.
- Do not change the `?t=` Watch Now link behaviour (open PR #2383 owns that).

## Verification

- Unit: pause toggle stops video and ring; reduced-motion renders paused.
- Real browser: Tab reaches the toggle; Space toggles; with
  `prefers-reduced-motion: reduce` the video stays paused after 10 s.
- Before/after page-load timing for `/watch` on a mobile profile.
