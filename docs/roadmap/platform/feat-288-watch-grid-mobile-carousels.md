---
id: "feat-288"
title: "Watch Experience grids become mobile carousels"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "experience"
  - "ui"
  - "responsive"
  - "carousel"
---

## Problem

Experience `MediaCollection` blocks authored as grids stack every card into a
long vertical list on mobile. Multi-item collections should remain compact and
browsable there, while retaining their authored desktop grid layouts.

## Entry Points - Read These First

1. `apps/web/src/components/sections/MediaCollection.tsx` - shared Experience
   media collection renderer and existing Embla carousel branch.
2. `apps/web/src/components/sections/MediaCollection.test.tsx` - renderer
   structure and responsive class contracts.
3. `apps/web/src/lib/content-width.ts` - shared Watch rail alignment tokens.
4. `docs/solutions/ui-bugs/watch-authored-media-collection-responsive-card-density.md`
   - established carousel behavior and rail-spacing contract.
5. `docs/plans/2026-07-22-001-watch-grid-mobile-carousels-plan.md` - scope,
   decisions, and verification scenarios.

## What To Build

1. Render multi-item non-carousel `MediaCollection` variants as a horizontal,
   swipeable, scroll-snapping carousel below the `md` breakpoint.
2. Preserve the existing grid renderer at `md` and wider, including current
   columns, card orientation, copy, links, hover behavior, and ordering.
3. Preserve authored `carousel` variants at every viewport without adding a
   duplicate responsive branch.
4. Size mobile slides by card orientation so the next card remains visible as
   a browsing cue, and retain terminal rail padding.
5. Add focused structural tests and compact/wide browser proof.
6. Keep mobile carousel thumbnails compact enough to expose substantially more
   adjacent content, including matching reductions to minimum heights, image
   hints, card spacing, and overlay typography.
7. Reduce the shared mobile vertical padding between Watch media sections while
   preserving the established desktop rhythm at `md+`.

## Constraints

- Make no Admin schema or authored-content changes.
- Outside compact mobile grid-backed rails, do not change card visuals,
  routing, media loading, item order, or desktop grid density.
- Keep single-item non-carousel blocks on their existing responsive layout
  instead of shrinking them into a carousel slide.
- Add no dependency, duplicated card tree, runtime listener, or data request.

## Verification

- Focused `MediaCollection.test.tsx` coverage for mobile carousel, desktop
  grid, authored carousel, slide orientation, single-item behavior, and end
  spacing.
- Web typecheck, lint, formatting, and `git diff --check`.
- Browser smoke `/watch` below and above `md`: prove horizontal movement on
  mobile, unchanged grid geometry on desktop, no document overflow, and no
  console errors.

## Completion Evidence

- Multi-item non-carousel Experience collections now use one card tree that is
  a native scroll-snap rail below `md` and resets to the existing
  variant-specific grid at `md+`. Horizontal and portrait cards use separate
  mobile widths; single-item and authored carousel paths remain unchanged.
- Focused `MediaCollection` coverage passed 39 tests. Full Web typecheck and
  ESLint passed, and the changed files passed Prettier plus `git diff --check`.
- At a 390px browser viewport, horizontal thumbnails measured approximately
  188x106px with two cards visible and portrait thumbnails approximately
  114x171px with three cards visible. All seven grid-backed collections scrolled
  horizontally without document overflow, and the console had no errors.
- At 1024px, the same blocks reset to their existing desktop grids, `visible`
  horizontal overflow, and 160px horizontal or 256px portrait minimum heights.
- Shared authored and generated Watch media sections now use 40px top and
  bottom padding below `md`, down from 64px, while `md+` retains 64px. Browser
  proof covered all eight local media sections at 390px and the desktop reset at
  1024px with no document overflow or console errors.
- Post-review browser proof confirmed all seven mobile rails expose `x
mandatory` scroll snap on the overflow viewport, while their inner grids use
  `none`. At 1024px, snap resets to `none`, overflow to `visible`, row flow is
  restored, and horizontal/portrait gaps return to 20px/16px.
- A local-development load sample recorded DOM content loaded in 343ms, 9.1ms
  of layout work, 11.4ms of style recalculation, and 407ms total task time. The
  implementation retains one card tree and adds no effects, listeners,
  requests, dependencies, or duplicate mobile/desktop render branches.
- Rails with non-link informational cards expose a labeled keyboard-focusable
  overflow viewport and visible focus ring so native arrow-key scrolling can
  reveal offscreen content; linked-only rails retain their existing tab order.
- The implementation adds no dependency, request, effect, listener, duplicate
  card render, or new media source. The reusable responsive pattern is recorded
  in `docs/solutions/ui-bugs/watch-experience-grid-mobile-carousel.md`.
