---
title: "Watch Experience Media Card White Outline - Plan"
type: fix
date: 2026-07-20
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Experience Media Card White Outline - Plan

## Goal Capsule

- **Objective:** Replace the numbered Watch Experience media-card hover and keyboard-focus indicator with a continuous solid-white frame around the full card perimeter.
- **Authority:** The supplied screenshot and requested solid-white/no-gradient treatment take precedence, followed by `docs/roadmap/platform/feat-275-watch-experience-media-card-white-outline.md` and the scoped Web package conventions.
- **Execution profile:** One localized component-and-test change; preserve the existing card overlay node, interactions, and layer order.
- **Stop conditions:** Stop and surface a blocker if satisfying the visual target requires changing shared Watch home/search/chapter treatments, card navigation, Mux preview behavior, or Experience data contracts.
- **Tail ownership:** Land through the normal PR-to-main workflow; no production deployment is part of this plan.

## Product Contract

### Summary

The numbered Experience media cards will show one solid-white interaction frame on pointer hover and keyboard focus, with no red or gradient in that frame and no behavior changes elsewhere.

### Problem Frame

The `MediaCollection` card overlay currently reuses the Watch home red gradient outline and adds a red glow. On the numbered Christmas Experience grid, that treatment reads as a red, incomplete frame instead of the approved continuous white perimeter.

### Requirements

- R1. Pointer hover on an Experience media card reveals a solid-white frame around all four edges.
- R2. Keyboard focus reveals the same white frame as pointer hover.
- R3. The interaction frame contains no red color, red glow, gradient, or orientation-specific gradient utility.
- R4. The frame remains above the bevel, copy, scrim, preview, and progress layers so no edge is visually interrupted.
- R5. Horizontal and vertical `MediaCollection` card variants use the same white-frame treatment without changing their dimensions or corner shape.
- R6. Card navigation, accessible naming, Mux preview activation, hover backdrop updates, progress display, and authored content remain unchanged.

### Scope Boundaries

- In scope: the file-private `VideoCard` interaction overlay in `apps/web/src/components/sections/MediaCollection.tsx` and its focused regression coverage.
- Out of scope: `apps/web/src/components/home/WatchHomeCard.tsx`, `apps/web/src/components/home/WatchHomeTvCarousel.tsx`, search cards, and `apps/web/src/components/watch/SiblingCarousel.tsx`.
- Out of scope: changing or deleting the shared `.watch-home-gradient-outline*` rules in `apps/web/src/app/globals.css`; those rules remain in use by other surfaces.
- Out of scope: routing, Experience data, card content, media loading, animation timing, backdrop behavior, and new shared styling abstractions.

## Planning Contract

### Key Technical Decisions

- KTD1. Keep the existing `media-collection-card-hover-outline` overlay node and replace only its visual classes. This preserves hover/focus triggers, opacity timing, and pointer behavior while moving the frame to `z-[80]`, above both the `z-40` bevel and `z-[70]` progress layer.
- KTD2. Use a local inset white border matching the established chapter-card pattern in `apps/web/src/components/watch/SiblingCarousel.tsx`. Do not modify the global gradient utility because Watch home components intentionally retain it and assert it in their tests.
- KTD3. Prove both landscape/grid and portrait/rail render paths in the component test. A single orientation assertion could allow the removed orientation-specific gradient classes to return on the untested path.

### Sequencing

Strengthen the existing `MediaCollection` style-contract test first, then apply the localized class change and run the focused and package-level gates. Browser verification follows automated checks and covers the complete rendered perimeter, focus parity, existing preview/backdrop behavior, and lightweight page-load evidence.

## Implementation Units

### U1. Replace and lock the Experience media-card interaction frame

- **Goal:** Render a continuous solid-white hover/focus frame on every `MediaCollection` card orientation without changing card behavior or shared card styles.
- **Requirements:** R1, R2, R3, R4, R5, R6; KTD1, KTD2, KTD3.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/components/sections/MediaCollection.tsx`
  - `apps/web/src/components/sections/MediaCollection.test.tsx`
  - `docs/roadmap/platform/feat-275-watch-experience-media-card-white-outline.md`
- **Approach:** Retain the dedicated absolute overlay and its hover/focus opacity triggers, but replace the shared gradient, orientation-radius, and red-shadow classes with local full-inset rounded white-border classes. Add regression assertions that the overlay stays above the bevel, contains the solid-white frame classes, preserves hover and focus triggers, and excludes every red/gradient class. Exercise a horizontal numbered grid card matching the screenshot and a vertical rail/card variant.
- **Patterns to follow:** Mirror the uninterrupted white overlay in `apps/web/src/components/watch/SiblingCarousel.tsx`; use the existing `data-testid="media-collection-card-hover-outline"` hook and render helpers in `apps/web/src/components/sections/MediaCollection.test.tsx`.
- **Execution note:** Start with the focused style-contract assertions, then make the class-only component correction.
- **Test scenarios:**
  1. Render a numbered horizontal grid card, inspect its hover-outline overlay, and expect full-inset rounded white-border and `z-[80]` classes together with both pointer-hover and focus-visible opacity triggers.
  2. For the same overlay, expect no `watch-home-gradient-outline`, portrait/landscape gradient variant, brand-red token, or red RGBA shadow so the indicator cannot retain a red or graduated edge.
  3. Render a vertical rail/card variant and expect the same solid-white frame contract, proving orientation no longer selects a gradient-specific treatment.
  4. Retain the existing hover-preview test and accessible card wrapper expectations so changing the interaction frame does not eagerly load, remount, rename, or disable the card.
- **Verification:** The focused test passes; the browser shows a continuous white perimeter on hover and keyboard focus with the bevel/content below it; existing preview, backdrop, and navigation behavior remains intact; the roadmap ticket is marked complete only after all gates pass.

## Verification Contract

| Gate                           | Command or evidence                                                                                          | Done signal                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused regression             | `pnpm --filter @forge/web test -- src/components/sections/MediaCollection.test.tsx`                          | Horizontal and vertical frame assertions and existing card behavior tests pass.                                                                                                 |
| Type safety                    | `pnpm --filter @forge/web typecheck`                                                                         | Web TypeScript check passes without generated-file drift.                                                                                                                       |
| Lint                           | `pnpm --filter @forge/web lint`                                                                              | Web lint and UI-locale drift checks pass.                                                                                                                                       |
| Formatting                     | Run the repository Prettier check for the touched component, test, roadmap ticket, and plan.                 | No formatting changes remain.                                                                                                                                                   |
| Visual and accessibility smoke | On the numbered Christmas Experience grid, hover a card and Tab-focus a card.                                | Both states show the same solid-white frame on all four edges; no red/gradient remains; content, preview, backdrop, and navigation still work.                                  |
| Page-load performance          | Capture a before/after reload trace or equivalent resource/Web Vitals evidence on the same Experience route. | No new initial-load request, client initialization, or long task is introduced; LCP and transferred assets remain within normal run-to-run variance for this class-only change. |
| Scope regression               | Inspect Watch home, search, and chapter card treatments or their focused assertions.                         | Those surfaces retain their existing intentional styles and are absent from the implementation diff.                                                                            |

## Definition of Done

- R1-R6 are satisfied and U1's test scenarios pass.
- The `MediaCollection` interaction overlay is solid white, continuous, and free of red and gradient styling in both orientations.
- Pointer hover and keyboard focus remain behaviorally equivalent.
- No shared gradient CSS or unrelated card component is modified.
- Focused tests, Web typecheck, lint, formatting, browser smoke, and page-load performance evidence are complete.
- `docs/roadmap/platform/feat-275-watch-experience-media-card-white-outline.md` is updated to `status: "complete"` with verification results reflected if the repository convention calls for completion notes.
- Abandoned or superseded implementation attempts are removed from the final diff.
