---
title: "fix: Make Watch video hero usable in mobile landscape"
type: fix
status: active
date: 2026-07-16
---

# fix: Make Watch video hero usable in mobile landscape

## Summary

Add a compact, height-aware landscape layout for the unified Watch header and
individual-video hero overlay so all primary content remains visible and
usable in Mobile Safari without changing portrait or playback behavior.

---

## Problem Frame

Mobile Safari can expose a wide but shallow page viewport after its browser
chrome consumes much of the screen. The current width-only breakpoints apply
desktop header spacing and title sizes to that viewport. The pre-reveal title,
Watch and Share actions, and metadata then exceed the hero height, placing the
title behind the fixed header and outside the usable viewport.

The failure became visible after the video hero gained Share and metadata on
2026-07-14. Existing tests verify those elements individually but do not cover
compact-height landscape geometry.

---

## Requirements

### Compact landscape layout

- R1. A short landscape viewport renders the unified floating header and the
  complete pre-reveal hero overlay without intersection or clipping.
- R2. The full title, Watch action, Share action, and available metadata remain
  visible, readable, and operable in the reported Safari layout and at
  844x390 without truncating the title.
- R3. Compact mode uses `(max-width: 1023px) and (max-height: 500px) and
(orientation: landscape)` in CSS, covering phone landscape while excluding
  ordinary tablet and desktop landscapes.
- R4. Landscape safe-area insets protect the header and hero controls on the
  top, left, right, and bottom edges in either device orientation.
- R5. Every interactive hero control retains at least a 44x44 CSS-pixel touch
  target with enough separation for independent taps.

### Regression boundaries

- R6. Mobile portrait keeps its existing square muted-preview behavior.
- R7. Normal desktop and tablet layouts, custom hero overlays, and revealed
  player chrome retain their current sizing and interaction behavior.
- R8. The hero continues to use `100svh`, and preview/body overlap remains
  measurement-driven.

---

## Assumptions

- The supplied screenshot is an individual Watch video page in pre-reveal
  state, as identified by its Watch, Share, and hero metadata controls.
- The shared `(max-width: 1023px) and (max-height: 500px) and (orientation:
landscape)` condition should compact both fixed header
  spacing and the default hero overlay; changing only one surface would leave
  their independent layouts able to collide.
- A shared Tailwind `compact-landscape` custom variant owns the exact media
  condition; runtime viewport measurement is needed only for browser
  verification, not component state.

---

## Key Technical Decisions

- **Use a bounded short-landscape media condition:** the 1023px width ceiling
  excludes iPad/desktop layouts, while the 500px height ceiling includes the
  844x390 target and the reported constrained Safari viewport.
- **Compact both participating surfaces:** the fixed header and bottom-anchored
  hero overlay are laid out independently, so each receives the same compact
  viewport contract.
- **Keep the change CSS-owned:** existing portrait handling already uses
  Tailwind media variants, while the shared custom variant avoids hydration,
  rotation state, and breakpoint drift between header and hero.
- **Preserve content rather than hide it:** compact typography and spacing
  keep the full title, primary actions, and metadata available; the fix does
  not add a title line clamp or remove functionality.

---

## Implementation Units

### U1. Compact the unified header in short landscape viewports

- **Goal:** Reduce the fixed header's vertical footprint while retaining the
  shared Watch rails and safe-area positioning.
- **Requirements:** R1, R3, R4, R7.
- **Dependencies:** None.
- **Files:** `apps/web/src/lib/content-width.ts`,
  `apps/web/src/components/FloatingSearchProvider.tsx`,
  `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Approach:** Extend the shared header class contract with the exact compact
  media condition, reduced top spacing, and a shorter backdrop. Combine the
  header's horizontal rails with `safe-area-inset-left` and
  `safe-area-inset-right`; keep normal and pinned modes aligned and preserve
  existing behavior outside the bounded condition.
- **Patterns to follow:** Existing responsive constants in
  `apps/web/src/lib/content-width.ts` and portrait arbitrary media variants in
  `apps/web/src/components/watch/HeroPlayer.tsx`.
- **Test scenarios:** The header class contract includes the exact
  short-landscape top and backdrop overrides in normal and pinned states;
  default desktop classes remain; safe-area-aware horizontal rails are
  present; the language and search controls keep their existing accessible
  surfaces. Browser smoke covers an individual video, Watch home, and language
  inventory route so the shared header change is not validated only on the
  failing page.
- **Verification:** Focused provider tests prove the shared class contract, and
  browser geometry shows the header remains inside the landscape safe area.

### U2. Fit the full pre-reveal hero overlay below the compact header

- **Goal:** Keep the title, action row, and metadata inside the visible hero
  and below the unified header in short landscape viewports.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Add the exact short-landscape overrides to the default
  overlay's title scale, vertical gaps, safe-area-aware horizontal and bottom
  padding, action sizing, and metadata spacing. Preserve the full title and
  minimum 44x44 touch targets. Scope the overrides to the default pre-reveal
  overlay so custom overlays and revealed playback chrome are unchanged.
- **Patterns to follow:** Existing `HERO_FRAME_HEIGHT_CLASS`, portrait-only
  media variants, `WATCH_NOW_LINK_CLASS`, and hero layout test hooks.
- **Test scenarios:** A long localized title receives compact-landscape sizing
  and remains fully visible; Watch, Share, language, and subtitle controls
  preserve 44x44 targets; metadata stays present with compact spacing;
  safe-area-aware left, right, and bottom offsets are present; the condition
  activates at 844x390 and not at 1024x501; portrait-only classes remain;
  custom overlay consumers do not receive default-overlay compaction; revealing
  chrome removes the pre-reveal overlay without changing the player frame.
- **Verification:** Focused hero tests pass. Mobile Safari proof uses a stable
  long-title Russian fixture or live route, first with browser chrome expanded,
  then after toolbar collapse/expansion, in both landscape orientations, and
  after rotating back to portrait. Bounding rectangles stay inside
  `visualViewport` and the safe-area rectangle; Watch, Share, language, and
  subtitle controls accept taps; Watch-now playback remains unchanged. Capture
  page-load resource timing before and after the CSS-only change to confirm it
  adds no request, script, media-init, or long-task work to the critical path.

---

## Acceptance Examples

- AE1. Given a deterministic long-title Russian video fixture or stable live
  route in Mobile Safari landscape with browser chrome expanded, when the page
  first renders, then the title begins below the fixed header and the metadata
  ends above the hero's safe-area-adjusted bottom edge.
- AE2. Given an 844x390 viewport with a long localized title, when the viewer
  taps Watch, Share, language, or subtitle controls, then every 44x44 minimum
  target is visible and receives the intended action without scrolling to
  recover clipped content.
- AE3. Given the same route rotated back to portrait, when the preview renders,
  then the existing square portrait frame and header behavior are unchanged.
- AE4. Given compact landscape mode, when Watch reveals player chrome, then the
  pre-reveal overlay disappears and the existing playback frame and controls
  remain usable.
- AE5. Given either landscape orientation on a notched device, when browser
  chrome expands or collapses, then header and hero controls remain inside the
  visual viewport and all top, inline, and bottom safe-area bounds.
- AE6. Given a 1024x501 tablet or desktop landscape viewport, when the same
  route renders, then compact-landscape overrides do not activate.

---

## Risks & Dependencies

- The Tailwind 4 build must emit the shared `compact-landscape` custom variant;
  component assertions cover alias usage, while a production compile and
  viewport boundary smoke cover variant emission and breakpoint behavior.
- Safari browser chrome changes the visual viewport dynamically; real Mobile
  Safari proof is required because desktop emulation alone cannot establish
  safe-area and toolbar behavior.
- The bounded condition deliberately excludes 1024px-and-wider tablet and
  desktop layouts; boundary smoke at 1023x500 and 1024x501 protects that split.

---

## Scope Boundaries

- Out of scope: player controls, subtitles, language-picker behavior, Share
  modal behavior, data fetching, homepage hero layout, and broad header design
  changes.
- Deferred to follow-up work: any general responsive-layout abstraction beyond
  the shared constants needed for this header/hero collision.

---

## Sources & Research

- `apps/web/src/components/watch/HeroPlayer.tsx` contains the viewport-capped
  frame and the bottom-anchored title/action/metadata stack.
- `apps/web/src/lib/content-width.ts` and
  `apps/web/src/components/FloatingSearchProvider.tsx` define the independent
  fixed header geometry above that stack.
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
  documents why the hero uses `100svh` and measured sticky overlap.
- `docs/plans/2026-07-14-001-fix-watch-video-hero-share-action-plan.md`
  introduced the Share action into the individual-video overlay.
- `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`
  defines the portrait-only preview boundary that this fix must preserve.
