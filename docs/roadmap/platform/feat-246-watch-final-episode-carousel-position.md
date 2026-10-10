---
id: "feat-246"
title: "Watch final episode carousel position"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
  - "carousel"
---

## Problem

When a Watch collection's active episode is its final child, the chapter
carousel can scroll to a synthetic blank terminal snap. The active card lands
at the leading edge with an empty tail, forcing viewers to scroll backwards to
see preceding episodes.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` - Embla setup,
   active-index scroll behavior, and the terminal spacer.
2. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` -
   focused component coverage and the jsdom geometry limitation.
3. `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`
   - terminal gutter and Embla accessibility contract.
4. `docs/plans/2026-07-10-001-fix-watch-final-episode-carousel-plan.md` -
   implementation requirements and verification matrix.

## Grep These

- `sibling-carousel-end-spacer`
- `startIndex`
- `containScroll: "trimSnaps"`
- `WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY`
- `watchEpisodePath`

## What To Build

1. Replace the viewport-complement terminal spacer with the standard small,
   non-focusable Embla terminal-gutter slide.
2. Keep existing `startIndex`, active-index `scrollTo`, pending navigation,
   session-storage preservation, contextual episode hrefs, and normal link
   behavior unchanged.
3. Add focused regression assertions for the final-active child and terminal
   gutter accessibility shape.
4. Verify the final episode route at desktop and mobile widths, including
   direct load and penultimate-to-final navigation.

## Constraints

- Do not change card widths, public Watch routes, GraphQL, hero transitions,
  or chapter navigation ownership.
- Retain Embla `containScroll: "trimSnaps"`, pointer/keyboard/arrow support,
  and `next/link` semantics.
- The terminal gutter must be `aria-hidden` and non-focusable.

## Verification

1. `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SiblingCarousel.test.tsx`
2. `pnpm --filter @forge/web typecheck`
3. `pnpm --filter @forge/web lint`
4. Browser proof at `1440x900` and `390x844` for
   `/watch/jesus.html/invitation-to-know-jesus-personally/english.html`:
   final active card at the trailing gutter, a preceding card visible, and no
   viewport-sized blank tail.

## Verification Notes

- Focused `SiblingCarousel` coverage, Web typecheck, Web lint, staged-file
  lint, and repository-wide Prettier checks passed.
- Browser proof was attempted with the sibling checkout's local Web environment.
  Its Admin route manifest dependency at `localhost:3003` was unavailable, so
  the Watch route returned `500` before the carousel mounted. This is a local
  environment limitation; the PR retains the required browser-proof scenario
  for an environment with the Admin service available.
