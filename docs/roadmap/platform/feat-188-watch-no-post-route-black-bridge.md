---
id: "feat-188"
title: "Watch no post-route black bridge"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-13"
duration: 1
depends_on:
  - "feat-183"
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

Chapter navigation now performs the intended click-side sequence: current
video/cover fades to black, the clicked chapter cover appears behind black,
and the cover reveals. Production validation showed a second unwanted black
bridge after the destination route commits, so the newly loaded page appears to
dim from black again.

## Entry Points - Read These First

1. `docs/plans/2026-06-13-003-fix-watch-no-post-route-black-bridge-plan.md`
   - implementation plan for this follow-up.
2. `docs/roadmap/platform/feat-183-watch-cover-sequenced-transition.md`
   - predecessor that added the current click-side sequencing.
3. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - durable navigation feedback pattern.
4. `apps/web/src/components/watch/WatchPageClient.tsx` - delayed route push
   and pending chapter state.
5. `apps/web/src/components/watch/HeroPlayer.tsx` - poster bridge and blackout
   layers.
6. `apps/web/src/components/watch/WatchSectionRenderer.tsx` - pending visual
   projection into hero/body surfaces.

## What To Build

1. Remove the session-storage destination poster bridge intent.
2. Stop passing a forced poster bridge key into `HeroPlayer` on the destination
   route.
3. Keep the click-side `covering` and `revealing` phases intact.
4. Keep pending optimistic poster swaps bridged through black while the route
   is still pending.
5. Update tests and design-pattern documentation so the post-route bridge is
   no longer treated as the desired behavior.

## Verification

- Focused page-client tests prove route push still waits for the blackout and
  reveal windows without writing a destination bridge.
- Focused hero tests prove pending optimistic posters still bridge through
  black, but committed route poster replacements do not render another black
  bridge.
- Focused renderer tests prove the removed bridge prop is no longer threaded.
- Browser smoke confirms a Watch chapter click no longer dims the landed page
  from black again.

## Plan

Implementation plan:
`docs/plans/2026-06-13-003-fix-watch-no-post-route-black-bridge-plan.md`
