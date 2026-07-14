---
title: "fix: Move Watch subtitles down when player chrome hides"
type: "fix"
status: completed
date: 2026-07-14
roadmap: docs/roadmap/platform/feat-251-watch-subtitle-auto-hide-position.md
---

# fix: Move Watch Subtitles Down When Player Chrome Hides

## Summary

Keep active Watch subtitles above the timeline and controls while player chrome is visible, then return them to the normal bottom edge of the visible picture when that chrome auto-hides.

## Problem Frame

`SubtitleOverlay` lifts cues above the bottom controls so text does not cover interactive player components. The controls later fade away, but the overlay can remain at the lifted position and cover the middle of the picture instead of reclaiming the empty lower edge.

## Requirements

- R1. Active subtitles remain above the timeline and bottom control rail whenever player chrome is visible.
- R2. Active subtitles move down to the ordinary bottom-edge position whenever player chrome becomes hidden.
- R3. The position change animates smoothly and follows repeated hide and reveal cycles without stale state.
- R4. Existing scroll-aware protection against the Watch body zone, subtitle track selection, fullscreen behavior, and player performance remain unchanged.

## Key Technical Decisions

- KTD1. Use `HeroPlayerControls`' existing `onVisibilityChange` callback as the visibility source of truth. This avoids a second global DOM-query and `MutationObserver` state channel inside `SubtitleOverlay`.
- KTD2. Keep `SubtitleOverlay` responsible for its existing scroll-aware bottom offset and only derive the control-rail lift from the visibility value supplied by its owner.
- KTD3. Cover the transition in the focused `SubtitleOverlay` suite and preserve `HeroPlayer` integration coverage for the prop wiring.

## Assumptions

- "Player components disappear" means the custom timeline and bottom control rail enter their existing hidden chrome state; dim and bright states both count as visible.
- The current 200 ms subtitle transform transition remains the intended motion treatment.

## Scope Boundaries

In scope:

- Subtitle vertical positioning during custom player chrome hide and reveal cycles.
- Focused component and integration regression coverage.
- Browser proof at the Watch route shown in the report.

Out of scope:

- Subtitle typography, background, language selection, VTT parsing, or cue timing.
- Player chrome timing, opacity, layout, or timeline behavior.
- Watch body layout, sticky hero behavior, and unrelated player overlays.

## Implementation Units

### U1. Drive subtitle lift from player chrome visibility

- **Goal:** Make the subtitle position react directly and reliably to the existing chrome visibility lifecycle.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** None
- **Files:**
  - Modify `apps/web/src/components/watch/HeroPlayer.tsx`
  - Modify `apps/web/src/components/watch/SubtitleOverlay.tsx`
  - Modify `apps/web/src/components/watch/__tests__/SubtitleOverlay.test.tsx`
  - Modify `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` only if the integration boundary needs explicit regression coverage
- **Approach:** Retain the latest visible/hidden detail in `HeroPlayer`, update it in the existing control callback, and pass the boolean to `SubtitleOverlay`. Replace the overlay's DOM-observer visibility discovery with this owner-supplied state while preserving its current visible-height lift and scroll-aware bottom offset.
- **Execution note:** Add failing transition coverage before changing the component contract.
- **Patterns to follow:** `HeroPlayer`'s existing `handleControlsVisibilityChange` callback and `HeroPlayerControls`' `ChromeVisibility` mapping; the direct jsdom harness in `apps/web/src/components/watch/__tests__/SubtitleOverlay.test.tsx`.
- **Test scenarios:**
  - With an active Forge subtitle cue and visible chrome, the overlay is lifted above the bottom controls.
  - When the same chrome changes to hidden, the overlay transform returns to the bottom-edge position.
  - Revealing the chrome again restores the lift without remounting or losing the active cue.
  - Scroll-aware `bottomOffset` remains independent from the chrome lift.
- **Verification:** The focused overlay and hero suites demonstrate repeated visible-hidden-visible positioning with no subtitle-selection regression.

### U2. Validate the Watch player interaction visually

- **Goal:** Confirm the repaired transition against the real player layout and guard page-loading behavior.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** U1
- **Files:**
  - Update `docs/roadmap/platform/feat-251-watch-subtitle-auto-hide-position.md`
  - Update `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md` only if the completed behavior adds a durable player-chrome rule
- **Approach:** Exercise active subtitles while the bottom rail is visible, allow chrome to auto-hide, and compare the overlay's lower edge before and after. Confirm the change is state/transform-only and does not add work to initial render, hydration, or media activation.
- **Patterns to follow:** The Watch player browser-smoke contract in `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`.
- **Test scenarios:**
  - Active subtitles do not overlap the visible timeline or control buttons.
  - After the rail auto-hides, active subtitles sit near the picture's bottom edge rather than remaining in the middle.
  - Pointer or keyboard interaction reveals the rail and raises subtitles again.
  - The initial Watch hero remains poster-first with no new request or activation delay.
- **Verification:** Desktop browser screenshots capture both visible-chrome and hidden-chrome states, and targeted Web validation passes.

## Risks & Dependencies

- Fullscreen portals move the control rail between DOM targets. Owner-supplied visibility must remain target-independent.
- The overlay also moves upward when the sticky hero is occluded by the Watch body zone. The fix must not conflate that viewport protection with the chrome lift.
- Native Mux captions remain suppressed; only the Forge-injected subtitle track feeds this overlay.

## Sources & Research

- `apps/web/src/components/watch/SubtitleOverlay.tsx`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/HeroPlayerControls.tsx`
- `apps/web/src/components/watch/__tests__/SubtitleOverlay.test.tsx`
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
- `docs/plans/2026-06-11-001-fix-watch-subtitle-overlay-forge-track-plan.md`
