---
id: "feat-522"
title: "Show the full Watch home hero title"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-17"
completed_date: "2026-09-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
  - "responsive-design"
---

## Problem

The Watch homepage hero clamps its active title to two lines from the `sm`
breakpoint upward. Long titles therefore end with an ellipsis even when the
hero has enough vertical space to render the remaining words.

## Entry Points

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — the home-specific
   title slot adds responsive line-clamp classes to the shared hero title.
2. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — hero
   overlay structure and shared-style coverage.

## Grep These

- `line-clamp-3 sm:line-clamp-2`
- `watch-home-tv-active-title`
- `WatchHomeTvOverlayContent`

## What To Build

1. Remove the homepage hero's line-count limit so every title renders in full.
2. Preserve the shared Watch hero typography, responsive width, balanced
   wrapping, copy animation, actions, and carousel timeline.
3. Add a focused regression assertion that the active hero title has no
   line-clamp class.

## Constraints

- Do not change the title text returned by Admin.
- Do not change the shared watch-page hero title behavior.
- Do not alter hero media loading, playback, or carousel timing.

## Verification

- Focused Watch homepage suite: 70 tests passed.
- Web typecheck and targeted ESLint: passed.
- Touched-file Prettier and `git diff --check`: passed.

## Completion Notes

- Removed the homepage-only `line-clamp-3 sm:line-clamp-2` classes so hero
  titles render every word at all breakpoints.
- Kept the shared responsive width, typography, balanced wrapping, animation,
  action layout, and carousel behavior unchanged.
- Added a regression assertion that rejects line-clamp classes on the active
  hero title.
