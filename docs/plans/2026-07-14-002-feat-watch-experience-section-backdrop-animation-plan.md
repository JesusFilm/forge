---
title: "feat: Animate Watch experience section backdrops"
type: "feat"
status: complete
date: 2026-07-14
roadmap: docs/roadmap/platform/feat-253-watch-experience-section-backdrop-animation.md
---

# feat: Animate Watch Experience Section Backdrops

## Summary

Apply the series episode grid's slow CSS pan-and-zoom motion to Watch experience media-collection section backdrops while preserving their current card-driven crossfades, tinting, and loading behavior.

## Problem Frame

Series episode grids use a 28-second Ken Burns-style background animation that keeps a blurred thumbnail backdrop visually alive. Experience `MediaCollection` sections already swap their backdrop to the hovered or focused card artwork, but those images remain static after each crossfade, creating inconsistent motion treatment between two similar Watch grids.

## Requirements

### Backdrop motion

- R1. Every rendered `MediaCollection` backdrop image, including the initial section image and card-hover replacements, uses the same pan-and-zoom timing and transform path as the series episode grid.
- R2. The existing default, entering, and exiting backdrop layers keep their current opacity crossfade behavior without either CSS animation overwriting the other.
- R3. The shared animation stops when `prefers-reduced-motion: reduce` is active while preserving a fully painted backdrop.

### Compatibility and performance

- R4. Pointer and keyboard focus continue to select the same card artwork, and leaving the section continues to settle the latest artwork without flashing the base color.
- R5. Existing section tint, overlay, brightness, saturation, card layout, URLs, and Mux hover previews remain unchanged.
- R6. The change adds no animation library, client request, image source, or JavaScript animation loop and does not regress initial experience-page loading.

## Key Technical Decisions

- KTD1. Generalize the existing series-specific CSS utility and keyframe name into a shared Watch backdrop motion utility, then update the series grid and experience renderer to consume that single definition.
- KTD2. Keep crossfade animation on the outer `MediaCollection` layer and pan-and-zoom animation on a nested visual layer. Both effects set the CSS `animation` property, so putting them on one element would cause one to replace the other.
- KTD3. Keep one resolved experience artwork source and the existing tint/overlay composition, painting that source once as the stationary full-canvas backdrop and once as the lower-opacity animated atmosphere. This avoids the series grid's full three-layer stack while ensuring the wide transform never exposes the section base color.
- KTD4. Keep image URLs on a non-animated child so background swaps do not reset the shared motion timeline through a `background-image` mutation on the animated element.

## Assumptions

- "Experience sections" means `MediaCollectionBlock` video-grid sections rendered by `ExperienceSectionRenderer`, including the builder-authored Watch home experience.
- Generic `SectionBlock` backgrounds and non-media block types are outside this change because they do not have card-driven artwork backdrops.
- The existing 28-second series timing and transform path are the source of truth for visual parity.

## Scope Boundaries

In scope:

- Shared CSS backdrop motion naming and reduced-motion handling.
- Default and hover/focus artwork layers in Web `MediaCollection` sections.
- Regression coverage for both existing series use and new experience-section use.
- Real-browser visual and page-loading verification on a representative experience route.

Out of scope:

- Experience data contracts, Admin block schemas, GraphQL fragments, or image selection.
- Card hover preview playback, card entry motion, and section crossfade timing.
- Mobile and TV experience renderers.
- Static backgrounds on unrelated experience block types.

## Implementation Units

### U1. Generalize the shared Watch backdrop motion utility

- **Goal:** Give the existing series pan-and-zoom effect a reusable Watch-level contract without changing its normal-motion appearance.
- **Requirements:** R1, R3, R6
- **Dependencies:** None
- **Files:**
  - Modify `apps/web/src/app/globals.css`
  - Modify `apps/web/src/components/watch/SeriesEpisodesGrid.tsx`
  - Modify `apps/web/src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx`
- **Approach:** Rename the series-specific keyframe and utility for shared Watch use, preserve its 28-second transform sequence, and add a reduced-motion override that leaves the backdrop in a stable painted state. Update both series animated layers to the shared class.
- **Patterns to follow:** The existing `series-backdrop-pan-zoom` keyframes and the adjacent Watch reduced-motion overrides in `apps/web/src/app/globals.css`.
- **Test scenarios:**
  - Both series backdrop motion wrappers render the shared utility class.
  - The shared CSS keeps the existing 28-second easing, infinite loop, and transform sequence.
  - Reduced-motion CSS disables the shared animation without hiding its image child.
- **Verification:** The series component suite passes and source inspection confirms the old series-specific utility has no remaining consumer.

### U2. Animate experience media-collection backdrops

- **Goal:** Apply the shared motion to initial and card-selected experience section artwork without disturbing the current crossfade state machine.
- **Requirements:** R1, R2, R4, R5, R6
- **Dependencies:** U1
- **Files:**
  - Modify `apps/web/src/components/sections/MediaCollection.tsx`
  - Modify `apps/web/src/components/sections/MediaCollection.test.tsx`
- **Approach:** Render each default or hover backdrop as an outer visibility/crossfade layer containing a shared motion wrapper and a non-animated background-image child. Preserve the current test IDs on the outer layers and add a stable selector for the animated child where needed for regression coverage.
- **Execution note:** Add backdrop-structure assertions before refactoring the rendered layers.
- **Patterns to follow:** `SeriesEpisodesGrid`'s separation of animation wrapper and background-image child; `MediaCollection`'s current entering/exiting layer state and 1.25-second settling cleanup.
- **Test scenarios:**
  - A media collection with artwork renders its default backdrop with the shared motion class and expected background image.
  - Hovering or focusing a second card creates an entering crossfade layer whose nested image uses the same motion utility.
  - Moving between cards retains an exiting layer while the replacement enters, with crossfade and pan-and-zoom classes on different elements.
  - Leaving the section settles the latest artwork and removes transient hover layers after the existing cleanup window.
  - A collection with no resolvable artwork still renders safely without an empty animated background layer.
- **Verification:** Focused `MediaCollection` tests prove default, hover, focus, transition, and no-image states while existing URL and preview assertions remain green.

### U3. Prove visual parity and loading safety

- **Goal:** Confirm the animation is visible, unobtrusive, and free of initial-load regression on a real experience page.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** U2
- **Files:**
  - Create and complete `docs/roadmap/platform/feat-253-watch-experience-section-backdrop-animation.md`
  - Update `docs/roadmap/README.md`
- **Approach:** Smoke a representative experience page at desktop and narrow viewport widths, capture the initial and hovered/focused backdrop states, verify reduced motion, and compare network/loading behavior with the unchanged image set. Record focused validation and proof in the roadmap completion notes.
- **Patterns to follow:** `docs/roadmap/platform/feat-233-watch-home-card-hover-backdrop-polish.md` and the browser-facing completion contract in `apps/web/AGENTS.md`.
- **Test scenarios:**
  - The initial section backdrop moves with the same slow pan-and-zoom character as the series grid.
  - Pointer hover and keyboard focus crossfade to the selected card while motion continues behind the grid.
  - Rapid card-to-card movement does not flash the section base color or cancel the crossfade.
  - Reduced-motion emulation shows static backdrops with hover/focus artwork changes intact.
  - The page requests no additional artwork or script dependency and retains normal responsive card layout.
- **Verification:** Screenshots capture normal and reduced-motion states, browser console/network inspection is clean, and targeted Web tests, typecheck, lint, and format checks pass.

## Risks & Dependencies

- Both crossfade and pan-and-zoom are CSS animations; an incorrect DOM boundary will silently cancel one effect because `animation` is not additive by default.
- Animated transforms create stacking contexts. The motion wrapper must stay inside the existing clipped section layer so it cannot change card z-order or trap interactive content.
- Large blurred transformed images can increase compositor work. The implementation must retain CSS transforms only, stop under reduced motion, and be checked at narrow and desktop widths.

## Sources & Research

- `apps/web/src/components/watch/SeriesEpisodesGrid.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/sections/MediaCollection.tsx`
- `apps/web/src/components/sections/MediaCollection.test.tsx`
- `docs/roadmap/platform/feat-233-watch-home-card-hover-backdrop-polish.md`
