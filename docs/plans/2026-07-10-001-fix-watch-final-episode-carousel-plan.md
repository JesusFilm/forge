---
title: "fix: Fill the final Watch chapter carousel page"
type: fix
status: completed
date: 2026-07-10
---

# fix: Fill the final Watch chapter carousel page

## Summary

Make a Watch chapter carousel whose active episode is the collection's final item open at the real terminal page: preceding episodes remain visible and the active card sits at the right end of the rail.

## Problem Frame

`SiblingCarousel` appends a viewport-complement-sized end spacer while starting and scrolling Embla to the active child index. For the final child, that creates a synthetic terminal snap with the active card at the leading edge and mostly empty track after it. It is a broken presentation because viewers must manually scroll back to see the preceding episodes.

## Requirements

### Terminal positioning

- R1. When the active chapter is the final child in a collection, the carousel's initial terminal page shows preceding chapter cards and places the active card at the right edge, apart from the normal rail gutter.
- R2. The carousel must not expose a near-viewport-width blank tail after the final chapter.

### Existing navigation contract

- R3. Non-final active chapters, optimistic pending selection, and the preserved source-snap transition path continue to use the existing Embla active-index behavior.
- R4. Chapter links retain their contextual `watchEpisodePath(...)` URL, public audio-language slug, normal `next/link` behavior, and modified-click semantics.
- R5. The carousel retains pointer, keyboard, arrow-button, and assistive-technology behavior, including a decorative, non-focusable end gutter that is hidden from the accessibility tree.

## Key Technical Decisions

- KTD1. Replace the viewport-complement spacer with the shared small terminal-gutter slide: a `CarouselItem` with `basis-auto pl-0`, `aria-hidden`, and `tabIndex={-1}` containing `CAROUSEL_END_SPACER`. `containScroll: "trimSnaps"` can then clamp both the initial `startIndex` and later active-item `scrollTo()` calls to the filled final page rather than a spacer-only snap.
- KTD2. Keep the route/pending/session-storage state model unchanged. The defect is track geometry, not active-index ownership or navigation timing; restoring a CSS translation workaround would reintroduce brittle positioning.

## Assumptions

- The existing large terminal spacer is legacy alignment behavior rather than a requirement to show an active final card as the first or only visible card. The user request and the shared Embla gutter guidance both favor the filled terminal page.

## Scope Boundaries

- Do not change Watch data fetching, public route shapes, GraphQL contracts, hero transitions, or chapter navigation ownership.
- Do not redesign card widths or the carousel primitive; this is limited to terminal track geometry and its focused coverage.

## Acceptance Examples

- AE1. Given a five-chapter collection on a desktop viewport and chapter five is active, the rail opens at its final filled page with at least one preceding chapter visible and chapter five at the trailing gutter.
- AE2. Given a longer collection with a non-final active chapter, its active card continues to be selected and scrolled to by the current navigation path.
- AE3. Given a normal chapter click that preserves the source scroll snap, the destination still consumes that state once and settles through the existing deferred auto-scroll path.

## Implementation Units

### U1. Replace the synthetic terminal snap

- **Goal:** Make the rail's end space a small decorative gutter so Embla's existing trim behavior reaches the filled last page.
- **Requirements:** R1, R2, R3, R4, R5.
- **Dependencies:** None.
- **Files:** `apps/web/src/components/watch/SiblingCarousel.tsx`; `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`.
- **Approach:** Replace the raw basis-sized filler with the established `CarouselItem` terminal-gutter slide (`basis-auto pl-0`, `aria-hidden`, `tabIndex={-1}`, and `CAROUSEL_END_SPACER`) while retaining `align`, `containScroll`, `startIndex`, and the post-initialization scroll path. Update focused assertions to describe this normal terminal gutter rather than the synthetic snap; keep the test's explicit limit that jsdom cannot prove visual layout.
- **Patterns to follow:** `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`; existing `SiblingCarousel` session-storage and pending-navigation behavior.
- **Test scenarios:**
  - Covers AE1. A final active child renders as the active route card without a viewport-complement end-spacer element and with the small terminal-gutter slide.
  - Covers AE2. A non-final active child keeps its active label, contextual `watchEpisodePath(...)` href, public audio-language slug, normal `next/link` behavior, and rendered card count.
  - Covers AE3. A preserved source index is consumed once and the active target stays route-derived after the deferred scroll path.
  - The terminal gutter is decorative, `aria-hidden`, and non-focusable.
- **Verification:** The focused component test passes, and desktop browser proof shows the final active card at the end of a filled rail.

### U2. Record the work and prove responsive terminal geometry

- **Goal:** Track the new Watch behavior and validate the visual contract that unit tests cannot measure.
- **Requirements:** R1, R2, R4, R5.
- **Dependencies:** U1.
- **Files:** `docs/roadmap/platform/feat-246-watch-final-episode-carousel-position.md`.
- **Approach:** Create the required in-progress roadmap ticket before implementation and mark it complete when the code and verification are finished. Run the targeted test, Web typecheck, lint, and real-browser checks at `1440×900` and `390×844` on `/watch/jesus.html/invitation-to-know-jesus-personally/english.html`. Capture direct-load and normal-click evidence for penultimate-to-final and final-to-earlier navigation. At each viewport, prove the final active card ends at the normal gutter, at least one preceding card remains visible, and no viewport-sized blank tail remains. This uses an existing client component and imports only its already-used `CarouselItem`; record the browser resource inventory and confirm the change adds no network request or client module.
- **Patterns to follow:** `AGENTS.md` roadmap lifecycle; `apps/web/CLAUDE.md` Watch route and frontend performance guidance.
- **Test expectation:** none -- this unit records status and performs integration-level verification rather than adding a second feature-bearing code path.
- **Verification:** The roadmap ticket is complete, validation passes, browser evidence at both viewports shows the active final episode at the trailing gutter with a prior chapter visible, and the resource inventory records no new request or client module from this track-geometry-only change.

## Risks and Dependencies

- Embla geometry cannot be meaningfully asserted in jsdom because layout widths collapse. The browser smoke is the decisive regression proof for terminal placement.
- The source-snap preservation flow is intentionally separate from the initial route load; it must remain intact even though the final page no longer has a synthetic tail snap.

## Sources and Research

- `apps/web/src/components/watch/SiblingCarousel.tsx` -- current active-index setup, Embla configuration, and oversized terminal spacer.
- `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` -- focused behavior coverage and its jsdom layout limitation.
- `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md` -- shared Embla terminal-gutter and accessibility contract.
- `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md` -- preserve contextual chapter navigation and derived pending state.
