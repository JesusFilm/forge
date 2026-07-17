---
title: "fix: Prevent Watch mobile page rubber-band panning"
type: "fix"
status: "active"
date: "2026-07-16"
---

# fix: Prevent Watch mobile page rubber-band panning

## Summary and Problem Frame

The Watch chapter page exposes the full off-screen Embla track on mobile, so the document body becomes much wider than the viewport. Mobile browsers can elastically pan that hidden overflow while the fixed header remains anchored, making the page feel horizontally draggable even though its scroll position does not change.

## Requirements

- R1. The Watch chapter page must not expose the sibling-carousel track as page-level horizontal overflow at mobile widths.
- R2. Horizontal drag and navigation inside the sibling carousel must continue to work through Embla.
- R3. The existing edge-aligned carousel geometry, card sizing, desktop behavior, and fixed header must remain unchanged.
- R4. Focused tests and a phone-width browser probe must prevent the mobile overflow regression from returning.

## Key Technical Decisions

- **Restore the shared viewport default:** Remove the Watch-only mobile `overflow-x-visible` override so `CarouselContent` uses its established `overflow-x-clip overflow-y-visible` contract.
- **Fix the overflow producer:** Do not add global gesture suppression or root overscroll rules while a single descendant is exposing the transformed track.
- **Preserve bleed geometry:** Keep the negative margin, leading padding, item bases, and trailing spacer unchanged; clipping the Embla viewport does not prevent Embla from transforming the rail.
- **Keep adjacent carousels out of scope:** Do not change the Watch home TV carousel unless the targeted browser probe independently reproduces this defect there.

## Dependencies

- Implementation must begin from current `origin/main`, where commit `9dda686f` introduced the reported override. The originating checkout is detached at an older baseline that does not contain the defect.

## Implementation Units

### U1. Track and lock the mobile viewport contract

- **Goal:** Record the bug in the Platform roadmap and add a focused regression assertion before changing the component.
- **Requirements:** R1, R3, R4
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/platform/feat-263-watch-mobile-horizontal-rubber-band.md`
  - `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`
- **Approach:** Create the next Platform roadmap ticket with `in-progress` status. Update the existing sibling-carousel layout assertion to require horizontal clipping at mobile widths and reject the visible-overflow override.
- **Patterns to follow:** `apps/web/src/components/ui/__tests__/carousel.test.tsx` already defines the shared clipping contract.
- **Test scenarios:** Render a chapter carousel and assert its viewport contains `overflow-x-clip`, retains `overflow-y-visible`, and does not contain `overflow-x-visible`.
- **Verification:** The focused test fails against the reported behavior and passes after U2.

### U2. Contain the sibling-carousel track

- **Goal:** Prevent the off-screen chapter rail from contributing to page-level horizontal overflow without changing carousel interaction.
- **Requirements:** R1, R2, R3
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/watch/SiblingCarousel.tsx`
- **Approach:** Remove the call-site viewport override and rely on the shared `CarouselContent` default. Leave the shared primitive and all carousel geometry untouched.
- **Patterns to follow:** `apps/web/src/components/ui/carousel.tsx` and `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md`.
- **Test scenarios:** The existing chapter rendering, navigation, active-state, and edge-case suite continues to pass while the new containment assertion passes.
- **Verification:** Focused Vitest, web typecheck, lint/format checks, and `git diff --check` pass.

### U3. Prove the mobile page geometry and document the fix

- **Goal:** Verify the real mobile layout no longer pans as a page while the carousel remains usable.
- **Requirements:** R1, R2, R4
- **Dependencies:** U2
- **Files:**
  - `docs/solutions/ui-bugs/watch-mobile-sibling-carousel-horizontal-rubber-band.md`
  - `docs/roadmap/platform/feat-263-watch-mobile-horizontal-rubber-band.md`
- **Approach:** Use iOS Simulator Mobile Safari at a 375 or 390 px viewport on `/watch/jesus.html/english.html`. Measure document/body width, perform a touch gesture outside the carousel, and swipe inside it. Capture visual proof, record the reusable cause/fix, and mark the roadmap ticket complete.
- **Patterns to follow:** `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md` and the Watch browser-proof conventions in `docs/solutions/ui-bugs/`.
- **Test scenarios:** In Mobile Safari, the document width equals the viewport width; a horizontal touch gesture outside the carousel leaves page/header geometry fixed; a swipe inside the carousel still advances the rail.
- **Verification:** Browser measurements and a screenshot support the fixed geometry, with no page-level horizontal movement observed.

## Scope Boundaries

- Do not change the Watch home carousel, the shared carousel API, root overflow/overscroll CSS, card dimensions, or responsive breakpoints.
- Do not suppress all horizontal touch gestures; carousel interaction must remain available.

## Sources and Research

- `apps/web/src/components/watch/SiblingCarousel.tsx` contains the mobile-visible overflow override introduced by commit `9dda686f`.
- `apps/web/src/components/ui/carousel.tsx` clips horizontal overflow by default.
- `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md` defines the bleed/alignment geometry that must remain intact.
