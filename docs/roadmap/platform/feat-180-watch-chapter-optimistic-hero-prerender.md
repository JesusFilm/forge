---
id: "feat-180"
title: "Watch chapter optimistic hero prerender"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-179"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "navigation"
  - "optimistic-ui"
---

## Problem

Deployed proof for `feat-179` confirms the chapter carousel immediately marks
the clicked card current, but the hero title/poster and body title remain on
the previous video until the new route payload renders. Users need the whole
first-viewport Watch identity to acknowledge the clicked chapter immediately.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-003-fix-watch-chapter-optimistic-hero-prerender-plan.md`
   - implementation plan for this follow-up.
2. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - existing carousel-only optimistic-navigation pattern.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - page-level client
   owner for watch blocks and modal state.
4. `apps/web/src/components/watch/WatchSectionRenderer.tsx` - dispatches
   synthetic watch blocks to hero, carousel, body, and lower sections.
5. `apps/web/src/components/watch/SiblingCarousel.tsx` - normal-click
   detection and clicked-card metadata source.
6. `apps/web/src/components/watch/HeroPlayer.tsx` - hero poster/title shell.
7. `apps/web/src/components/watch/WatchBody.tsx` - repeated body title.

## What To Build

1. Lift normal chapter-click intent from `SiblingCarousel` to `WatchPageClient`.
2. Build a validated page-level pending chapter state from metadata already in
   the carousel: target href, document id, title, slug, label, and poster image.
3. Render optimistic hero title/poster, body title, and carousel current state
   from that pending state while the route still shows the previous URL.
4. Preserve `next/link`, public audio-language URL builders, and modified-click
   browser behavior.
5. Let route commit invalidate pending state without effect-based cleanup.

## Verification

- Focused component tests prove normal chapter click immediately updates hero
  title/poster, body title, carousel current card, clip count, and pending
  affordance.
- Modified clicks and active-card clicks do not trigger optimistic UI.
- `@forge/web` typecheck and lint pass.
- Helium/`agent-browser` smoke captures before-click, immediate-after-click,
  and settled screenshots on a deployed or local Watch route.

## Plan

Implementation plan:
`docs/plans/2026-06-11-003-fix-watch-chapter-optimistic-hero-prerender-plan.md`
