---
id: "feat-630"
title: "Pause Control for the Watch Home Hero"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "accessibility"
  - "video"
---

## Problem

The Watch home hero advances and plays media for longer than five seconds but
has no pause control. WCAG 2.2.2 requires a way to pause, stop, or hide such
automatically moving content.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — overlay actions,
   player props, and timer wiring.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` — progress and
   slide-advance timer state.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — rendered
   carousel behavior and controls.

## Grep These

- `WatchHomeTvOverlay`
- `isBuffering`
- `handleEnded`
- `watch-home-tv-carousel`
- `Unmute preview`

## What To Build

- Add a keyboard-accessible play/pause toggle beside the mute control.
- Pause both the active preview media and the timed slide advancement.
- Resume both when activated again; expose a localized accessible name and
  change the action label between Play and Pause. Do not combine the changing
  action label with `aria-pressed`.
- Persist the viewer's pause preference for the current tab session.
- Preserve buffering behavior, explicit slide selection, reduced-motion
  behavior, and video mute state.

## Constraints

- Keep changes within the Watch home Web carousel and its tests.
- Do not add network requests, packages, or persistent cross-session storage.
- Do not change carousel composition, preview duration, or route behavior.

## Verification

- Test that pause halts media and prevents timed advancement, and resume restores
  both behaviors.
- Run the focused Watch homepage tests, Web typecheck, scoped lint/format, and
  `git diff --check`.
- The mute and pause controls remain native buttons with visible focus rings;
  the pause action label uses the existing localized `HeroPlayerControls`
  messages.
- The session preference uses `useSyncExternalStore` with a server snapshot of
  `false`, then pauses media in a layout effect if session storage says paused.
  This avoids a hydration mismatch and prevents the poster-hold callback from
  starting media after restoration.
- The dead-stream timeout also checks the user pause preference, including
  after choosing another slide while paused.
- `pnpm --filter @forge/web test -- src/components/home/__tests__/WatchHomePage.test.tsx`
  — 74 tests passed.
- `pnpm --filter @forge/web typecheck` — passed.
- Scoped ESLint and touched-file Prettier — passed.
- `git diff --check` — passed.
- Claude Team review found no remaining P1/P2 findings. Manual screen-reader QA
  remains for review.

## Implementation Progress

- FGE-142 implementation is ready for PR review. The feature remains
  `in-progress` until the PR review is complete.
