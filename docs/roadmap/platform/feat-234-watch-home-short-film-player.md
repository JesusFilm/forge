---
id: feat-234
title: Watch home short film inline player
owner: urim
priority: P2
status: complete
start_date: 2026-07-06
duration: 1
depends_on:
  - feat-220
blocks: []
tags:
  - web
  - mux
  - ui
---

## Problem

Watch home carousel Mux inserts could tease short-film content, but the inline
surface did not offer a clean way to watch the full film from the home hero.
The mobile hero also needed to work behind the floating search chrome without
compressing or obscuring the title and controls.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - hero media,
   overlay, CTA, rail, and short-film player takeover behavior.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` - carousel
   sequencing, auto-advance, and transition state.
3. `apps/web/src/lib/watch-home-carousel-sequence.ts` - Mux insert slide model
   and CTA-backed short-film secondary action mapping.
4. `apps/web/src/components/watch/HeroPlayerControls.tsx` - shared custom
   player controls reused by the home short-film takeover.

## Grep These

- `Watch Short Film`
- `secondaryAction`
- `shortFilmPhase`
- `playerTransitioning`
- `WATCH_PLAYER_CHROME_VISIBILITY_EVENT`
- `watch-home-player-enter`
- `watch-home-tv-visual-layer`

## What To Build

- Add a secondary `Watch Short Film` CTA only for CTA-backed Mux inserts.
  Use `WatchHomeTvCarouselMuxSlide.secondaryAction` with
  `{ label: string; type: "watch-short-film" }`.
- Transition the home hero inline into the shared custom player controls.
  Reuse `HeroPlayerControls` with `MuxPlayerRef` rather than native browser
  controls or a modal.
- Pause carousel auto-advance and avoid stale text flashes during player
  takeover and rail selection. The relevant state is
  `shortFilmPhase: "transitioning" | "playing"` plus
  `autoAdvancePausedForSlideId`.
- Align mobile and desktop hero CTA/control sizing, icons, and layout.
  Use explicit `WatchHomeMuxInsertAction.icon` values for stable CTA icons.
- Keep the mobile hero behind the floating search chrome while preserving
  readable title space.

## Constraints

- Do not add the secondary short-film CTA to passive Mux inserts whose
  `action` is `null`.
- Do not hand-edit generated GraphQL or locale artifacts.
- Do not replace the shared watch-page player chrome; the home takeover should
  compose `HeroPlayerControls`.
- Do not let full-player mode render carousel poster/title overlays behind the
  player.
- Do not let carousel `ended` or timed auto-advance move away from the active
  short-film slide during takeover.

## Verification

1. `pnpm --dir apps/web run generate:ui-locales && pnpm --dir apps/web exec vitest run src/components/home/__tests__/WatchHomePage.test.tsx src/lib/watch-home-carousel-sequence.test.ts src/components/home/__tests__/useWatchHomeTvCarousel.test.ts`
2. `pnpm --filter @forge/web typecheck`
3. `pnpm --filter @forge/web lint`
4. Browser probes confirmed mobile hero height, CTA/control alignment, and
   full-player takeover with no residual hero title or poster layer.
