---
title: "fix: Keep the Watch footer above the sticky player"
type: fix
status: completed
date: 2026-07-15
---

# fix: Keep the Watch footer above the sticky player

## Summary

Establish an explicit footer stacking layer so playable single-video pages can
scroll fully into the ministry footer without the sticky hero painting over it.

## Problem Frame

Playable Watch video and contextual episode routes render the shared footer
after `WatchPageClient`, but the footer root remains unpositioned. The earlier
sticky hero is positioned and can therefore paint above the footer when the
normal-flow body sheet ends, hiding the footer's upper strip at the bottom of
the page.

## Requirements

- R1. The shared Watch footer paints above the sticky hero wherever the two
  surfaces overlap during end-of-page scrolling.
- R2. Footer content, sizing, links, background, and server-side route
  composition remain unchanged.
- R3. The sticky hero and translucent Watch body keep their existing scroll-over
  behavior and player loading posture.
- R4. Regression coverage pins the footer root's positioned stacking contract.

## Assumptions

- The supplied 1280x960 screenshot represents the affected tablet landscape
  layout and is the primary visual acceptance viewport.
- The footer should visually cover the sticky player at the overlap boundary;
  adding empty space below the player is not the intended behavior.
- The shared footer is the correct owner of this layer contract because it is
  the surface that must consistently terminate the Watch page above preceding
  sticky media.

## Key Technical Decisions

- **Layer the footer instead of changing page geometry:** Make the footer root a
  positioned stacking layer above the sticky hero so the fix follows CSS paint
  order without changing scroll height or player measurements.
- **Keep the change in the shared footer:** Preserve the server route's existing
  `WatchPageClient` then `WatchHomeFooter` composition and avoid duplicated
  wrappers across standalone-video and contextual-episode branches.
- **Pin the styling contract directly:** Add a focused component test that
  asserts the footer root keeps both positioning and the explicit z-layer.

## Implementation Units

### U1. Add focused footer layer regression coverage

- **Goal:** Characterize the footer root as a positioned surface that paints
  above the sticky hero.
- **Requirements:** R1, R4.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx`
  - `apps/web/src/components/home/WatchHomeFooter.tsx`
- **Approach:** Render the shared footer in isolation and assert its stable test
  hook carries both relative positioning and the selected z-index utility.
- **Execution note:** Add the failing assertion before changing the footer.
- **Patterns to follow:** Use the existing Vitest and React DOM setup from
  `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` and the class
  contract assertions in `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Test scenarios:**
  - Render `WatchHomeFooter`, select `watch-home-footer`, and expect the root to
    be positioned and assigned a layer above the sticky hero.
  - Confirm the existing white background and stable footer test identifier
    remain present so the layering change does not replace the footer surface.
- **Verification:** The focused test fails without the layer utilities and
  passes once U2 establishes the contract.

### U2. Raise the shared footer above sticky media

- **Goal:** Ensure the complete footer remains visible when it reaches the
  sticky player at the end of a playable Watch page.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/components/home/WatchHomeFooter.tsx`
  - `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx`
- **Approach:** Add relative positioning and an explicit stacking level to the
  footer root. Do not alter padding, margins, player sizing, or route wrappers.
- **Patterns to follow:** Preserve the established sibling paint-order model in
  `apps/web/src/components/watch/WatchSectionRenderer.tsx` and the sticky-hero
  constraints documented in
  `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`.
- **Test scenarios:**
  - At 1280x960, scroll a playable two-segment video page to the bottom and
    confirm the footer's top edge and logo/navigation region paint above the
    sticky video with no covered strip.
  - At a representative desktop viewport, repeat the end-of-page scroll and
    confirm the footer remains above the hero while the body still scrolls over
    the player normally.
  - Load a contextual episode route and confirm the shared footer receives the
    same layer behavior without route-specific wrappers.
- **Verification:** The focused component test, Web type check, and lint pass;
  browser screenshots show the full footer above the player at tablet and
  desktop widths without a page-loading or hydration regression.

## Scope Boundaries

- Keep the existing footer design and server route placement.
- Do not restructure the sticky hero, portal anchor, or frosted body sheet.
- Do not add viewport-specific spacers or hard-coded player-height offsets.
- Do not change which route families render the footer.

## Sources & Research

- `apps/web/src/components/home/WatchHomeFooter.tsx` — shared footer root and
  stable test hook.
- `apps/web/src/components/watch/HeroPlayer.tsx` — positioned sticky hero whose
  paint order causes the overlap.
- `apps/web/src/components/watch/WatchSectionRenderer.tsx` — established body
  sheet that already paints over the hero.
- `docs/roadmap/platform/feat-250-watch-single-page-footer.md` — original footer
  parity scope and route boundaries.
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
  — institutional guidance for the sticky hero's shared stacking context.
