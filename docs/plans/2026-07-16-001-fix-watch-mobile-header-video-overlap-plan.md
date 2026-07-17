---
title: "fix: Prevent Watch Mobile Header Video Overlap"
type: "fix"
status: "active"
date: "2026-07-16"
---

# fix: Prevent Watch Mobile Header Video Overlap

## Summary

Keep the existing mobile portrait header clearance in place after Watch playback starts so the floating logo, search, and language controls never cover the video. Include the device safe-area inset and preserve the current desktop, landscape/fullscreen, custom-overlay, and player-control behavior.

## Problem Frame

The default Watch hero reserves a 96px black header band during the mobile portrait muted preview, but removes that band when `chromeRevealed` becomes true. The sound-on video then moves underneath the fixed floating header, matching the overlap shown in the supplied iPhone Safari screenshot.

## Requirements

- R1. Default Watch pages reserve a black header clearance of 96px plus `env(safe-area-inset-top, 0px)` above the media frame throughout mobile portrait preview and sound-on playback.
- R2. Transitioning into playback keeps the media frame's top edge below the same header boundary; only the existing bottom-edge contraction from the square preview to 16:9 playback remains.
- R3. The muted preview keeps its current mobile portrait square media frame, while committed playback remains a 16:9 media frame below the reserved header space.
- R4. Desktop, tablet, mobile landscape/fullscreen, and custom-overlay hero consumers keep their current layout.
- R5. Player controls, subtitles, language switching, media sizing modes, sticky-body overlap, and data fetching remain unchanged except where their geometry must follow the taller mobile portrait wrapper.
- R6. Focused component tests and browser geometry at an iPhone-sized portrait viewport prove that the active video begins below the floating header.

## Assumptions

- The screenshot shows the default web Watch hero after playback controls have appeared, not a custom-overlay or native-mobile player surface.
- The existing 96px black band is the intended base clearance. It should reuse the floating header's established safe-area calculation rather than introducing JavaScript measurement or a new spacing value.
- Mobile portrait remains defined by the existing `max-width: 767px` and portrait-orientation media query.

## Key Technical Decisions

- **Separate header clearance from preview shape:** Header clearance is a default Watch-page concern that persists across playback states; square cover treatment remains preview-only.
- **Keep responsive geometry CSS-owned:** Extend the existing Tailwind arbitrary media variants so the change does not add viewport JavaScript, hydration state, or resize listeners.
- **Size committed mobile portrait media explicitly:** Use an aspect-ratio-owned media frame below the band so the wrapper can be content-height on mobile portrait without making the `h-full` media overflow its padding.
- **Preserve the established component boundary:** Keep the fix inside `HeroPlayer`; mirror the fixed floating header's existing `6rem + safe-area inset` geometry without introducing a new shared design system.

## Frontend Design Direction

- **Visual thesis:** Extend the existing Watch visual system with a quiet black header-safe band so floating chrome reads cleanly and the video remains unobstructed.
- **Content plan:** Floating header, persistent reserved band, media frame and player controls, then the existing Watch body.
- **Interaction plan:** Keep the media frame's top edge stable through preview-to-playback transition while retaining the intentional square-to-16:9 lower-edge contraction; do not add ornamental motion or change the current chrome transitions.

## Scope Boundaries

In scope:

- Default Watch-page `HeroPlayer` mobile portrait layout.
- Regression coverage for preview, click-to-playback, and autoplay entry geometry.
- Roadmap tracking and mobile Safari-sized browser proof.

Out of scope:

- Floating header redesign, control repositioning, new spacing tokens, native mobile app changes, desktop/tablet hero changes, fullscreen chrome changes, and custom overlay consumers such as series heroes.

## Implementation Units

### U1. Track and pin the mobile header-clearance contract

- **Goal:** Create the required roadmap record and make the intended preview-to-playback geometry explicit in the focused HeroPlayer regression suite.
- **Requirements:** R1, R2, R3, R4, R6
- **Dependencies:** None
- **Files:** `docs/roadmap/platform/feat-184-watch-mobile-playback-header-clearance.md`, `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- **Approach:** Add a platform roadmap ticket with the screenshot-derived problem, exact entry points, constraints, and verification. Update the existing state-transition test so it expects the band and mobile portrait content-height wrapper to persist after playback reveal while square preview classes give way to a 16:9 committed media frame. Cover autoplay/deep-link entry so the active-player path cannot bypass clearance.
- **Execution note:** Start by changing the focused regression expectations before modifying `HeroPlayer`.
- **Patterns to follow:** `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`; existing `data-testid` layout hooks and class-contract assertions in `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Test scenarios:**
  - Default muted preview renders the 96px-plus-safe-area mobile portrait band, content-height wrapper override, and square media-frame variant.
  - Clicking Watch now preserves the band and content-height wrapper, removes square-only preview sizing, applies a mobile portrait 16:9 frame, and keeps controls mounted.
  - Autoplay/player-first entry renders the same persistent header band and active 16:9 mobile portrait frame.
  - A custom-overlay hero does not render the band or receive the default Watch mobile portrait sizing variants.
- **Verification:** The focused test expresses each state boundary and fails against the current implementation before U2.

### U2. Preserve mobile portrait clearance through active playback

- **Goal:** Keep the default Watch video below the floating header in every playback state without changing other hero surfaces.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** U1
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`, `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`, `docs/roadmap/platform/feat-184-watch-mobile-playback-header-clearance.md`
- **Approach:** Split the current preview-only layout predicate into a persistent default-Watch mobile header-clearance concern and a preview-only square-frame concern. Render the black band at the floating header's established 96px-plus-safe-area height for the persistent concern, retain the mobile portrait content-height wrapper in active playback, and give the committed media frame a mobile portrait 16:9 aspect ratio. Leave desktop base classes and the existing portrait query boundary intact. Mark the roadmap ticket complete only after focused tests, app validation, and visual proof succeed.
- **Patterns to follow:** Existing constants and media variants in `apps/web/src/components/watch/HeroPlayer.tsx`; `docs/plans/2026-06-10-003-feat-watch-mobile-portrait-hero-preview-plan.md`; `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`.
- **Test scenarios:**
  - Preview-to-playback transition retains the 96px-plus-safe-area band and the media frame top stays below it.
  - Active mobile portrait playback is 16:9 below the band and continues using contain mode.
  - Desktop and mobile landscape do not display the band because the existing portrait media query remains the only display gate.
  - Sticky hero height measurement observes the combined band-plus-media wrapper and preview-body overlap still clears on playback reveal.
- **Verification:** Focused HeroPlayer tests pass; `@forge/web` format/type/lint checks for the touched surface pass; an iPhone-sized browser screenshot and geometry check show the active media frame starts at or below the bottom of the floating header with no horizontal overflow or console errors.

## Sources and Research

- User-supplied iPhone Safari screenshot showing floating header controls over active video.
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/FloatingSearchBar.tsx`
- `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`
- `docs/plans/2026-06-10-003-feat-watch-mobile-portrait-hero-preview-plan.md`
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`
