---
id: "feat-180"
title: "Watch hero chapter transition feedback"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-176"
  - "feat-179"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "navigation"
  - "video"
---

## Problem

Watch chapter-card clicks now acknowledge navigation in the carousel, but the
hero can still feel disconnected while the next route resolves. When a user
clicks an episode in the carousel, the hero title and cover should visually
move to that selected episode immediately, show that the player cover is
loading, and use a brief black transition before the new cover image appears.

## Entry Points - Read These First

1. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - existing pending-navigation pattern for chapter cards.
2. `apps/web/src/components/watch/SiblingCarousel.tsx` - normal click capture
   and pending card state.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - client state boundary
   shared by the hero and carousel.
4. `apps/web/src/components/watch/WatchSectionRenderer.tsx` - synthetic Watch
   block dispatch.
5. `apps/web/src/components/watch/HeroPlayer.tsx` - poster-first hero, loading
   overlay, title overlay, and media-frame transitions.
6. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`,
   `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`, and
   `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`
   - focused component coverage.

## What To Build

1. Lift normal chapter-click pending preview data from `SiblingCarousel` to the
   watch page client so `HeroPlayer` can render the clicked episode title and
   cover immediately.
2. Preserve browser link semantics for modified clicks and malformed/non-link
   cards.
3. Render a brief black cover transition before the pending cover fades in.
4. Add a pulse treatment to the cover while the pending navigation is loading.
5. Clear the pending hero preview naturally when the route commits to a new
   video/language/source identity.

## Constraints

- Do not change public Watch URL shape or replace chapter cards with
  imperative router navigation.
- Do not switch the actual player media source before the route resolves.
- Do not start additional Mux segment downloads as part of pending hero
  feedback.
- Keep current poster-first idle autoplay, language switching, subtitles, and
  custom chrome behavior unchanged.

## Verification

- Focused tests cover pending hero preview propagation, modified-click
  behavior, black-transition attributes, and cover pulsing while pending.
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium/browser smoke on a local Watch route confirms a chapter click updates
  the hero title/cover immediately, shows the pulse, and transitions through
  black before the destination page settles.

## Plan

Implementation plan:
`docs/plans/2026-06-11-004-feat-watch-hero-chapter-transition-feedback-plan.md`

## Completion Notes

Implemented pending hero transition feedback for chapter-card navigation:

- `SiblingCarousel` now publishes a normal-click-only pending chapter preview
  with target title, href, source/target ids, language slug, and resolved
  poster URL.
- `WatchPageClient` keeps the pending preview scoped to the current source
  video/language so it clears naturally on route commit.
- `HeroPlayer` renders the pending title and cover as a visual overlay, with a
  black transition and pulsing cover while the route is loading, without
  changing the committed media source.
- Focused component tests, typecheck, lint, and Helium browser smoke passed.
