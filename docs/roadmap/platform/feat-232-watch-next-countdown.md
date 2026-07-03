---
id: "feat-232"
title: "Watch next countdown"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-03"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
---

## Problem

Watch chapter and episode playback ends without an inline next-item affordance. Users need a bottom-right "Watch Next" control during the last five seconds, with timed progress and automatic navigation when playback completes.

## Entry Points — Read These First

1. `apps/web/src/lib/content.ts` — synthetic Watch block builders and canonical parent context.
2. `apps/web/src/components/watch/HeroPlayer.tsx` — Watch hero player chrome, media events, and route navigation.
3. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` — mocked MuxVideo player behavior.
4. `apps/web/src/lib/__tests__/content-watch-merge.test.ts` — synthetic block builder coverage.

## Grep These

- `buildHeroBlock`
- `WatchHeroPlayerBlock`
- `watchEpisodePath`
- `timeupdate`
- `ended`
- `hero-player-watch-next`

## What To Build

1. Resolve the next chapter or episode server-side from the current watch record plus canonical parent.
2. Pass the next item through the synthetic HeroPlayer block.
3. In `HeroPlayer`, display a bottom-right button only during the final five seconds of active playback.
4. Render a progress fill behind the button text that moves from 0% to 100% across the countdown.
5. Navigate to the contextual next episode/chapter route with `autoplay=1` when the button is clicked or playback ends.

## Constraints

- Keep public Watch URL construction in `apps/web/src/lib/routes.ts`.
- Do not hand-edit generated GraphQL env/types outputs.
- Preserve the canonical parent route for chapter/episode progression.
- Do not show the button when there is no next item.

## Verification

- `pnpm --filter @forge/web test -- src/lib/__tests__/content-watch-merge.test.ts src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
