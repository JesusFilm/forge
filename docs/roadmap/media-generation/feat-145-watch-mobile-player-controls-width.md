---
id: "feat-145"
title: "Watch Mobile Player Controls Width"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-28"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "video"
  - "mobile"
---

## Problem

Mobile watch pages need the custom hero player controls to extend across the available watch-page rails. A narrow centered chrome makes the controls feel visually detached from the player and leaves unused horizontal space on small screens.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayerControls.tsx` - custom watch hero player chrome positioning and rail padding.
2. `apps/web/src/lib/content-width.ts` - shared `WATCH_PAGE_RAIL_PADDING_CLASSES` value.
3. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - custom chrome regression coverage.

## Grep These

- `hero-player-custom-chrome`
- `WATCH_PAGE_RAIL_PADDING_CLASSES`
- `absolute inset-x-0 bottom-0`

## What To Build

1. Ensure the custom chrome bar uses `absolute inset-x-0 bottom-0` so it spans the hero player horizontally.
2. Keep `w-full` on the chrome bar.
3. Keep shared watch rail padding via `WATCH_PAGE_RAIL_PADDING_CLASSES`.
4. Add focused test coverage so the chrome does not regress back to a narrow centered layout.

## Constraints

- Do not fork the mobile watch controls from the desktop controls.
- Do not change playback behavior, fullscreen behavior, language controls, or media data fetching.
- Do not duplicate the rail padding constants in component code.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
