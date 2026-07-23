---
title: "feat: Present Watch Experience grids as mobile carousels"
type: "feat"
status: "completed"
date: "2026-07-22"
---

# feat: Present Watch Experience grids as mobile carousels

## Summary

Make multi-item Experience `MediaCollection` grid variants horizontally
swipeable below `md`, with a visible next-card cue, while preserving the
current authored carousel path and desktop grid layouts.

## Requirements

- R1. Multi-item non-carousel variants render a labeled native scroll-snap
  carousel below `md` and the existing grid at `md+`.
- R2. Horizontal cards use a wide partial-width slide; vertical collection
  cards use a narrower portrait slide so adjacent content is discoverable.
- R3. Single-item non-carousel blocks retain their existing responsive layout.
- R4. Authored `carousel` variants remain unchanged at every viewport.
- R5. Card orientation, order, content, navigation, progress, hover preview,
  backdrop response, and desktop grid columns remain unchanged.
- R6. The mobile rail aligns to the Watch gutter, supports swipe/drag, and has
  a real final spacer without creating document-level horizontal overflow.
- R7. Mobile carousel cards use compact orientation-aware widths and remove the
  legacy thumbnail minimum-height floor so more adjacent items fit onscreen;
  desktop and authored-carousel dimensions remain unchanged.
- R8. Shared Watch media sections use tighter mobile vertical padding and reset
  to the established desktop spacing at `md+`.

## Scope Boundaries

- In scope: `MediaCollection` responsive composition, focused tests, local
  compact/wide proof, roadmap completion, and reusable solution guidance.
- Out of scope: Admin authoring/schema changes, generated `WatchHomeSection`
  grids, card redesign, carousel controls, autoplay, pagination dots, and
  desktop density changes.

## Implementation Units

### U1. Add the responsive renderer split

- **Requirements:** R1-R6
- **Files:**
  - Modify `apps/web/src/components/sections/MediaCollection.tsx`
- **Approach:** Turn the existing card grid into a native horizontal
  scroll-snap rail below `md`, then reset the same DOM tree to its current grid
  flow and columns at `md+`. Keep the authored Embla carousel branch
  structurally unchanged. Select mobile column width from the existing
  vertical versus horizontal orientation decision; do not duplicate cards.
- **Test scenarios:** Grid and collection variants expose mobile carousel
  semantics plus an `md+` grid; horizontal and portrait slide widths differ;
  one-item grids skip the responsive carousel; authored carousel renders only
  its existing all-viewport rail.

### U2. Validate interaction and layout preservation

- **Requirements:** R1-R6
- **Files:**
  - Modify `apps/web/src/components/sections/MediaCollection.test.tsx`
  - Modify `docs/roadmap/platform/feat-288-watch-grid-mobile-carousels.md`
  - Add `docs/solutions/ui-bugs/watch-experience-grid-mobile-carousel.md`
- **Approach:** Lock the responsive structure in focused tests, then verify a
  real grid-backed Experience section below and above `md`. Prove horizontal
  movement, partial next-card visibility, desktop grid columns, terminal
  spacing, document width, and console health.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Prettier and `git diff --check`.
- Local browser proof on `/watch` at compact and desktop widths.

## Completion Evidence

- Multi-item grid, collection, hero, and player variants share one responsive
  card tree: native horizontal scroll snap below `md`, variant-correct grids at
  `md+`. Single-item and authored carousel behavior remain separate.
- Focused `MediaCollection` coverage passed 39 tests, including horizontal,
  portrait, special desktop-column, single-item, and authored-carousel
  contracts. Full Web TypeScript and ESLint checks passed.
- Browser proof at 390px showed approximately two 188x106px horizontal cards or
  three 114x171px portrait cards in view, working horizontal rails, no document
  overflow, and no console errors. At 1024px the same sections reset to their
  existing desktop grid flow and minimum heights.
- The shared section spacing token resolves to 40px vertical padding at 390px
  for both authored and generated media sections, then restores the existing
  64px padding at 1024px. The compact browser proof had no document overflow or
  console errors.
- Review fixes put snap behavior on the actual overflow viewport and restore the
  original 20px horizontal and 16px portrait desktop gaps. Browser computed
  styles confirmed mobile `x mandatory` snapping and the complete desktop reset.
- A local-development performance sample measured 343ms to DOM content loaded,
  9.1ms of layout work, 11.4ms of style recalculation, and 407ms total task
  duration. The responsive implementation uses one card tree and introduces no
  new effect, listener, request, dependency, or duplicated render path.
- The renderer adds no dependency, request, effect, listener, duplicated card
  tree, or new media source. Durable guidance is recorded in
  `docs/solutions/ui-bugs/watch-experience-grid-mobile-carousel.md`.
