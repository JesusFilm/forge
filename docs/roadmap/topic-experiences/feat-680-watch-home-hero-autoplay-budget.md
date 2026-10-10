---
id: "feat-680"
title: "Bound Watch home hero autoplay media"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags: [web, watch, performance]
---

## Problem

The Watch home hero advances through autoplay videos indefinitely, making media
requests and mobile data use proportional to page dwell time (FGE-144, W-007).

Slides play to their natural end. That is the settled decision of
`docs/plans/2026-09-13-1641-feat-watch-home-play-to-end-bandwidth-guard-plan.md`
(#2287, R2), so a slide is never cut short to meet this budget. The data cost of
a viewer who stays for a long slide is an accepted trade-off of that decision.

## Entry Points

1. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` -
   `WATCH_HOME_TV_AUTOPLAY_SLIDE_BUDGET`, `stopAutoplay`, `selectIndex`
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - `WatchHomeTvMedia`,
   `WatchHomeVideoTimeline`, `useWatchHomeMutedSubtitles`
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` -
   `autoplay session budget`

## What To Build

Stop autoplay when the turn of the third automatically shown slide ends, however
the turn ends (`ended`, backstop, dead-stream ceiling, portrait skip). On stop,
unmount the video, keep its poster and the timeline, freeze the progress ring,
and clear pending waits and the loading state.

Any explicit timeline selection starts a new session and resets the budget. Once
autoplay has stopped, the current circle is selectable too, and selecting it
plays the slide again on a freshly mounted video.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/components/home
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

Each new guard is falsified once in the tests (same-slide resume, selectable
current circle, frozen ring, cleared loading state, subtitle track on remount,
budget reset on selection).
