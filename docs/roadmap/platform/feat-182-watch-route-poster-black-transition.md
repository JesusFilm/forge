---
id: "feat-182"
title: "Watch route poster black transition"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-181"
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

The chapter carousel now makes the clicked episode's title and poster appear
while the destination route is pending. On production, the transition still
looks wrong when the route commits: the route-owned hero poster can replace the
clicked poster directly, bypassing the black bridge users expect between the
old image and the new cover.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-005-fix-watch-route-poster-black-transition-plan.md`
   - implementation plan for this follow-up.
2. `docs/roadmap/platform/feat-181-watch-chapter-cover-loading-transition.md`
   - completed predecessor that added the optimistic pending black bridge.
3. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - normal-click and pending-navigation guard pattern.
4. `apps/web/src/components/watch/HeroPlayer.tsx` - hero cover and poster
   transition shell.
5. `apps/web/src/app/globals.css` - shared animation keyframes.

## What To Build

1. Track actual visible hero poster identity inside `HeroPlayer`.
2. Fire the black bridge and cover reveal when the visible poster URL changes,
   including the optimistic-to-route commit handoff.
3. Keep the subtle pulse limited to true loading states: pending route
   navigation and activated player pre-`canplay`.
4. Preserve initial page load behavior, reduced-motion behavior, and the
   route-owned playback source.

## Verification

- Focused hero tests prove a pending optimistic poster still bridges through
  black and pulses.
- Focused hero tests prove a committed route poster replacement also bridges
  through black instead of swapping directly.
- `@forge/web` targeted tests, typecheck, lint, and browser smoke pass for a
  single-video page chapter click.

## Completion Notes

- Added a one-shot session-backed chapter poster bridge intent so destination
  route mounts can animate the route-owned hero poster through black even after
  optimistic pending state invalidates.
- Kept loading pulse semantics narrow: pending route posters and activated
  pre-`canplay` player covers pulse; committed route posters only reveal out
  of black.
- Browser smoke confirmed a local click from
  `/watch/resurrected-jesus-appears.html/english.html` to
  `/watch/great-commission-and-ascension.html/english.html` left the settled
  route poster layer on `data-cover-transition="black-bridge"`.

## Plan

Implementation plan:
`docs/plans/2026-06-11-005-fix-watch-route-poster-black-transition-plan.md`
