---
id: "feat-632"
title: "Keep Watch Home Hero Stable During Interaction"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "accessibility"
  - "video"
---

## Problem

The Watch home hero can change slides while a viewer hovers over or tabs to its
primary Watch Now action. The title and destination can change while the viewer
is reading or preparing to activate the CTA.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — hero section,
   Watch Now action, and carousel state wiring.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` — advance clock,
   held-turn accounting, and ended-event handling.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — rendered
   slide advancement and focus behavior.

## Grep These

- `WatchHomeTvCarouselRegion`
- `PrimaryAction`
- `isTurnHeld`
- `advanceClockRef`
- `handleEnded`

## What To Build

- Hold the slide-advance clock while a mouse pointer is inside the hero.
- Hold the slide-advance clock while keyboard-visible focus is inside the hero;
  resume only after focus leaves the region.
- Preserve remaining time when the interaction hold ends.
- Keep media playback available during a hover/focus hold.

## Constraints

- Do not change carousel ordering, preview duration, or route handling.
- Do not pause or mute playback solely because of hover or focus.
- Do not add dependencies or network requests.

## Verification

- Under fake timers, assert hover and focus each stop timed slide advancement and
  leaving the region resumes the remaining time.
- Run focused Watch homepage tests, Web typecheck, scoped ESLint/Prettier, and
  `git diff --check`.

## Implementation Progress

- The hero region holds the advance clock while hovered by a mouse or while
  keyboard-visible focus remains inside it. Touch pointers do not create a
  hover hold, and pointer focus does not create a keyboard hold.
- Pointer and focus holds are tracked independently so leaving with the mouse
  does not clear a keyboard focus hold.
- The hold uses the existing turn-clock pause path, which preserves elapsed
  time and does not pause the media. If video ends during the hold, its slide
  advance is deferred until the interaction ends.
- If a focused CTA is removed by a slide update, a post-commit containment
  check clears the keyboard hold when focus is no longer within the hero.
- The Watch homepage suite passes: 77 tests, including mouse hover, keyboard
  focus, touch entry, remaining-time resume, deferred video-end, and orphaned
  focus recovery checks. Web typecheck and scoped ESLint pass.
