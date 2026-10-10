---
id: "feat-183"
title: "Watch cover sequenced transition"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
duration: 1
depends_on:
  - "feat-182"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "navigation"
  - "loading-state"
  - "optimistic-ui"
---

## Problem

`feat-182` ensured the route-owned poster reveals through black, but the
production interaction can still feel out of order: on fast route commits, the
title and poster can change before the current player has visibly dimmed to
black. The desired chapter-click sequence is explicit: click, current player
animates to black, title changes, cover swaps behind black, black reveals the
new cover, the cover may pulse while video loads, then video appears.

## Entry Points - Read These First

1. `docs/plans/2026-06-12-001-fix-watch-cover-sequenced-transition-plan.md`
   - implementation plan for this follow-up.
2. `docs/roadmap/platform/feat-182-watch-route-poster-black-transition.md`
   - predecessor that added the destination route poster bridge.
3. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - chapter click feedback pattern.
4. `apps/web/src/components/watch/SiblingCarousel.tsx` - normal-click
   interception for sequenced route navigation.
5. `apps/web/src/components/watch/WatchPageClient.tsx` - transition phase
   state and delayed route push.
6. `apps/web/src/components/watch/HeroPlayer.tsx` - hero blackout and reveal
   animation surfaces.

## What To Build

1. Intercept only ordinary left-click chapter navigation so modified browser
   clicks preserve native link behavior.
2. Start a hero media blackout immediately on click while the current
   title/poster remain visible.
3. After the blackout reaches opacity, apply the pending title/poster and let
   the new cover reveal.
4. Push the route only after the reveal window so a slow destination render
   cannot blank the first visible cover swap.
5. Preserve the existing destination route poster bridge and optional loading
   pulse.

## Verification

- Focused carousel tests prove normal parent-owned clicks prevent default and
  modified clicks remain native.
- Focused page-client tests prove pending title/poster state and `router.push`
  are delayed until after the blackout window.
- Focused hero tests prove the blackout overlay can cover the current poster
  before optimistic title/poster data is applied.

## Completion Notes

- Normal chapter clicks now enter a `covering` phase before route push.
- `HeroPlayer` renders a `watch-hero-cover-to-black` overlay during that first
  phase while retaining the current title and poster.
- After `WATCH_CHAPTER_POSTER_BLACKOUT_MS`, the page applies the pending
  title/poster and lets the existing black bridge reveal the new cover.
- After `WATCH_CHAPTER_POSTER_REVEAL_MS`, the page pushes the route so the
  actual route-owned video can take over.

## Plan

Implementation plan:
`docs/plans/2026-06-12-001-fix-watch-cover-sequenced-transition-plan.md`
