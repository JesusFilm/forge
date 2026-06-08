---
title: "Feat: Watch hero cinematic frame"
type: "feat"
status: "completed"
date: "2026-06-08"
origin: "docs/brainstorms/2026-06-08-watch-hero-player-cinematic-frame-requirements.md"
roadmap: "feat-169"
---

# Feat: Watch hero cinematic frame

## Summary

Implement a post-Play with Sound cinematic frame for the web watch hero. The muted preview stays visually immersive, while committed playback centers a fully visible, aspect-preserved video inside a responsive black stage.

## Problem Frame

The current hero player already changes media fit when `chromeRevealed` becomes true, but the parent layout does not intentionally become a framed viewing state. The new behavior should make committed playback feel like a centered stage without altering playback logic or adjacent watch-page features.

## Requirements

- R1. On committed playback, the black player parent animates into the framed playback layout.
- R2. The committed playback video preserves aspect ratio and remains fully visible.
- R3. The committed playback video is centered horizontally and vertically inside the black parent.
- R4. The black parent provides responsive frame padding when space allows.
- R5. Tight viewport fitting prioritizes full video visibility over frame padding.
- R6. Muted preview behavior remains intact.
- R7. Controls, subtitles, language switching, and fullscreen behavior continue to work.

## Key Technical Decisions

- **State-gated layout classes:** Use the existing `chromeRevealed` state as the boundary between preview and framed playback. This avoids new playback state and aligns with the current cover-to-contain object-fit switch.
- **Parent frame via flex centering and responsive padding:** Size and center the media through the existing wrapper rather than changing Mux source behavior. The black parent owns the cinematic frame; the media remains the aspect-preserved child.
- **Regression tests over geometry math:** JSDOM cannot prove rendered video dimensions, so tests should assert the state-specific layout contract while browser smoke verifies the visual result.

## Implementation Units

### U1. Capture the frame layout contract

- **Goal:** Update hero player regression coverage so the committed playback state expects a centered black stage with responsive frame padding.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** None
- **Files:**
  - Modify: `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- **Approach:** Replace the existing assertion that Play with Sound does not resize the hero with assertions that preview and committed playback use different layout classes. The committed state should assert centering, animation, contain-fit class removal of preview-only scaling, and responsive padding constraints.
- **Patterns to follow:** Existing `revealChrome()` and `data-testid="hero-player-wrapper"` tests in `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Test scenarios:**
  - Given initial muted preview, wrapper keeps preview stage sizing and preview overflow behavior.
  - Given Play with Sound resolves, wrapper exposes committed frame classes for centering, responsive padding, and layout animation.
  - Given committed playback, the Mux backend no longer receives the preview-only scale class.
- **Verification:** The focused HeroPlayer test fails before the production layout update and passes after it.

### U2. Implement the cinematic frame state

- **Goal:** Update the hero player layout so committed playback centers the fully visible video inside a black framed parent with responsive padding.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7
- **Dependencies:** U1
- **Files:**
  - Modify: `apps/web/src/components/watch/HeroPlayer.tsx`
  - Modify: `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- **Approach:** Keep the preview state on the current cover/crop path. For `chromeRevealed`, add wrapper layout classes that make the black parent a centered stage with responsive padding, remove preview-only vertical scaling from the media element, and keep the existing contain object-fit behavior for both Mux backends. Use transition classes on the wrapper and media so the state change animates.
- **Patterns to follow:** `HeroPlayer.tsx` `chromeRevealed` gates, object-fit constants, existing custom chrome portal, and the MuxVideo solution note in `docs/solutions/performance-issues/watch-hero-muxplayer-to-muxvideo-swap-20260526.md`.
- **Test scenarios:**
  - Covered by U1 regression tests.
  - Existing HeroPlayer control, spinner, HLS fallback, and language switcher tests continue to pass.
- **Verification:** Focused HeroPlayer tests pass and manual/browser smoke confirms the framed visual state.

## Scope Boundaries

- No modal, white-page, or close-button layout from the visual reference.
- No playback source, Mux backend, Mux Data, subtitle source, language switching, fullscreen, download, or share behavior changes.
- No custom chrome redesign beyond preserving usable positioning over the framed player.

## Risks & Dependencies

- The sticky hero uses measured height for scroll pinning. Changing wrapper sizing must keep `heroHeight` measurement valid so scroll pause/resume behavior does not regress.
- The custom chrome is portaled to the overlay anchor. The framed parent must not detach or cover that anchor in committed playback.

## Sources / Research

- `docs/brainstorms/2026-06-08-watch-hero-player-cinematic-frame-requirements.md`
- `docs/roadmap/media-generation/feat-169-watch-hero-cinematic-frame.md`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/HeroPlayerControls.tsx`
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
