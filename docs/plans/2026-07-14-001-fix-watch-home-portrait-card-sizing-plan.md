---
title: "fix: Restore the Watch authored media carousel"
type: "fix"
status: "completed"
date: "2026-07-14"
---

# fix: Restore the Watch authored media carousel

## Summary

Render Experience `MediaCollection.variant: "carousel"` as the drag-free,
single-row carousel used before June 20 instead of a wrapping responsive grid.
Keep the current cinematic card visuals, hover backdrop, progress, links, and
non-carousel variants.

## Problem Frame

The backend Experience still authors the Video Bible collection as
`variant: "carousel"`, but the current web renderer treats that value as a
wrapping grid. Git history immediately before June 20 shows the intended
contract: an Embla carousel aligned to the content rail, fixed-width portrait
slides, drag-free scrolling, trimmed snap containment, and a trailing gutter
spacer.

## Requirements

- R1. Backend `variant: "carousel"` renders one horizontally scrollable row.
- R2. Carousel slides retain the historical `max-w-[200px]` width and portrait
  card orientation.
- R3. The carousel is drag-free, start-aligned, trims snap containment, and
  disables dragging when there is no overflow.
- R4. Current card content, image treatment, hover preview/backdrop, progress,
  links, focus behavior, and CTA remain unchanged.
- R5. `collection`, `grid`, `hero`, and `player` variants keep their current
  grid behavior.
- R6. The rail aligns with the current Watch content gutters and keeps a real
  trailing spacer so the last card clears the right edge.
- R7. Focused automated coverage and browser proof verify the carousel markup,
  overflow interaction, compact layout, and wide layout.
- R8. Reuse the existing carousel dependency and add no new initial data or
  media requests.

## Historical Reference

- `git show 5aa833998e602da9b8aee67d24e2400a1912769f:apps/web/src/components/sections/MediaCollection.tsx`
- The pre–June 20 implementation used `Carousel`, `CarouselContent`, and
  `CarouselItem` with `dragFree`, `align: "start"`,
  `containScroll: "trimSnaps"`, `max-w-[200px]`, and a trailing spacer.

## Scope Boundaries

- In scope: the authored `carousel` branch, focused tests, responsive browser
  proof, roadmap status, and durable solution documentation.
- Out of scope: Experience schema/data changes, non-carousel collection
  variants, card redesign, content ordering, hero layout, and navigation URLs.

## Implementation Units

### U1. Restore the authored carousel renderer

- **Requirements:** R1-R6, R8
- **Files:**
  - Modify `apps/web/src/components/sections/MediaCollection.tsx`
- **Approach:** Reuse the shared Embla wrappers. Render carousel items only for
  `variant === "carousel"`; keep the existing grid branch for every other
  variant. Use current Watch rail padding and an explicit matching end spacer.
- **Verification:** Rendered markup exposes the carousel region and slides,
  cards remain fixed-width and vertical, and non-carousel classes are unchanged.

### U2. Lock the contract and prove the interaction

- **Requirements:** R7, R8
- **Files:**
  - Modify `apps/web/src/components/sections/MediaCollection.test.tsx`
  - Modify `docs/roadmap/platform/feat-252-watch-home-portrait-card-sizing.md`
- **Approach:** Replace the grid-column assertion with carousel structure and
  sizing assertions. Run focused test, typecheck, lint, compact/wide browser
  smoke, and demonstrate horizontal movement on the real `/watch` route.
- **Performance proof:** The change reuses an already-installed client
  component and does not add data fetching, media sources, timers, or observers
  beyond Embla's existing carousel behavior.

## Verification

- `pnpm --filter @forge/web test -- MediaCollection.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at compact and wide viewports on `/watch`.
- Verify horizontal drag/scroll changes the visible cards and the last card can
  clear the right content gutter.

## Completion Evidence

- `pnpm --filter @forge/web test -- MediaCollection.test.tsx` — 12 tests passed.
- `pnpm --filter @forge/web typecheck` — passed.
- `pnpm --filter @forge/web lint` — passed.
- Compact browser proof at `http://127.0.0.1:3020/watch` — six 200px cards in
  one row; horizontal input moved the first slide from `x=44` to approximately
  `x=-253`, and the final card cleared the 64px compact end gutter.
- Wide browser proof at 1600px — six 200px cards remained in one row with a
  96px trailing gutter and no console errors.
- Performance proof — the implementation reuses the existing Embla carousel
  and current card component; it adds no dependency, data request, media source,
  timer, or observer.
