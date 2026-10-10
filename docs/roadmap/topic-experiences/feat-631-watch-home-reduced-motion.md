---
id: "feat-631"
title: "Respect Reduced Motion on Watch Home"
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

The Watch home hero starts moving video and rotates slides without checking
`prefers-reduced-motion`, despite the preference being intended to limit motion.

## Entry Points — Read These First

1. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` — playback start,
   slide selection, and timer lifecycle.
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — media layer,
   progress ring, and carousel controls.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — rendered
   carousel behavior under mocked media events.

## Grep These

- `startPlayback`
- `IMAGE_SLIDE_ADVANCE_MS`
- `WatchHomePlaybackProgressRing`
- `prefers-reduced-motion`
- `matchMedia`

## What To Build

- Read `prefers-reduced-motion: reduce` and respond if it changes while the
  page is open.
- Hold on the poster instead of starting preview video while reduced motion is
  active.
- Stop timed slide rotation while the preference is active; keep deliberate
  user selection available.
- Pause the decorative progress animation and avoid motion-heavy crossfades.
- Keep the explicit Play action available to the viewer.

## Constraints

- Keep changes within the Watch home Web carousel.
- Do not change playback duration, queue order, route handling, or mute state.
- Do not add network requests or dependencies.

## Verification

- Under emulated reduced motion, assert media playback is not started and the
  active slide remains until deliberate user selection.
- Assert changing the media preference to reduced motion pauses an already
  playing hero and stops the progress/advance timer.
- Run the focused Watch homepage tests, Web typecheck, scoped lint/format, and
  `git diff --check`.

## Implementation Progress

- The carousel reads `prefers-reduced-motion: reduce` with
  `useSyncExternalStore`, using a false server snapshot so hydration markup
  remains stable. Preference changes update a layout effect that pauses an
  active preview and resumes it when the preference is removed.
- The shared pause gate holds the advance and dead-stream clocks and freezes
  the progress ring. Explicit timeline selection remains available; selected
  video slides stay on their posters while reduced motion is active.
- Playback resumed by scroll or modal pause owners is immediately paused again
  while reduced motion is active. The `ended` event cannot rotate the carousel.
- `pnpm --filter @forge/web test -- src/components/home/__tests__/WatchHomePage.test.tsx`
  — 74 tests passed, including initial and live reduced-motion cases.
- `pnpm --filter @forge/web typecheck` and scoped ESLint passed.
- Manual screen-reader QA remains for review.
