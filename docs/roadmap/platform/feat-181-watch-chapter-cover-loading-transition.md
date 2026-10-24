---
id: "feat-181"
title: "Watch chapter cover loading transition"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-180"
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

Chapter carousel clicks now optimistically update the single-video page title
and hero poster before the destination route settles. The poster swap is still
instant, which makes the loading state feel abrupt. The player cover should
acknowledge the pending video load with a short black bridge, then fade the
target cover in with a subtle pulse while the route-owned video data is still
loading.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-004-fix-watch-chapter-cover-loading-transition-plan.md`
   - implementation plan for this follow-up.
2. `docs/roadmap/platform/feat-180-watch-chapter-optimistic-hero-prerender.md`
   - completed predecessor that lifts carousel clicks into the hero/body shell.
3. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - normal-click and pending-navigation guard pattern.
4. `apps/web/src/components/watch/WatchSectionRenderer.tsx` - maps pending
   chapter metadata into first-viewport watch surfaces.
5. `apps/web/src/components/watch/HeroPlayer.tsx` - hero cover, loading, and
   poster-first playback shell.
6. `apps/web/src/app/globals.css` - shared animation keyframes.

## What To Build

1. Mark pending chapter visual overrides as a loading transition owned by the
   route-pending state.
2. In the hero cover, render a black bridge on chapter-click poster swaps
   before fading in the target cover image.
3. Apply a subtle pulsing cover animation while the pending chapter route or
   activated player is still loading.
4. Preserve the existing instant title/body-title update and do not change the
   actual playback source until the destination route commits.
5. Respect reduced-motion preferences by disabling the decorative transition.

## Verification

- Focused component tests prove pending chapter projection marks the optimistic
  hero visual as loading and gives it a stable transition key.
- Focused hero tests prove pending optimistic posters render black-bridge and
  pulse hooks, while normal route posters keep the existing behavior.
- `@forge/web` targeted tests, typecheck, lint, and browser smoke pass for a
  single-video page chapter click.

## Completion Notes

- Pending chapter clicks now mark the hero visual as loading with a stable
  transition key derived from the target video document id.
- `HeroPlayer` bridges pending chapter cover swaps through black, fades the
  clicked cover in, and pulses the visible cover while either the pending
  chapter route or activated player is loading.
- Browser smoke captured the immediate pending state on
  `/watch/great-commission-and-ascension.html/english.html`: the URL remained
  on the previous chapter while the title/body title switched to
  `Invitation to Know Jesus Personally`, the cover reported
  `data-cover-transition="black-bridge"`, the poster used
  `watch-hero-cover-reveal-pulse`, and the clicked card exposed
  `aria-busy="true"`.

## Plan

Implementation plan:
`docs/plans/2026-06-11-004-fix-watch-chapter-cover-loading-transition-plan.md`
