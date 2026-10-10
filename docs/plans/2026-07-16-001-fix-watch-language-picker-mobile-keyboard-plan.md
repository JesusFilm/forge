---
title: "fix: Keep Watch language search usable above the mobile keyboard"
type: "fix"
status: "completed"
date: "2026-07-16"
---

# fix: Keep Watch language search usable above the mobile keyboard

## Summary

Make the Watch language combobox place and size its search results from the visible browser area so iOS keyboard and browser chrome cannot cover the active search experience. Preserve the existing Watch modal design, desktop behavior, filtering, and selection contracts.

## Problem Frame

The shared Watch language combobox measures available space from `window.innerHeight` and only reacts to `window.resize`. Mobile Safari can shrink or shift the Visual Viewport when the software keyboard opens without changing the Layout Viewport by the same amount. The picker therefore believes space remains below the trigger and renders the search field or results behind the keyboard and browser toolbar.

## Requirements

- R1. Opening the language search on a phone must keep the focused search field and usable matching results inside the visible viewport when the software keyboard is open.
- R2. The popover must recompute its placement and list height when the Visual Viewport resizes or shifts while open.
- R3. Browsers without the Visual Viewport API must retain the existing `window.innerHeight` resize behavior.
- R4. The fix must preserve current filtering, ranking, keyboard navigation, virtualization, selection, fullscreen portal behavior, and desktop presentation.
- R5. The regression must be covered by focused component tests and mobile browser proof that includes an open keyboard or an equivalent reduced visual viewport.

## Assumptions

- The best-scoped correction is to make the shared combobox viewport-aware rather than redesigning the full language modal as a mobile sheet.
- The existing above-or-below popover pattern remains appropriate once it uses the actual visible viewport bounds.
- Visual Viewport `resize` and `scroll` events are the relevant mobile signals; `window.resize` remains the compatibility fallback.

## Key Technical Decisions

- **Measure the visible viewport:** Prefer `window.visualViewport` height and offset when available because on-screen keyboards can shrink the visual viewport without equivalently shrinking the layout viewport. Use `window.innerHeight` when the API is absent.
- **Keep adaptive placement local to the combobox:** Reuse the current trigger-relative above/below calculation and bounded listbox rather than adding a second mobile-only picker UI.
- **Respond to both size and origin changes:** Recalculate while open on Visual Viewport resize and scroll so keyboard transitions, browser chrome, and zoom-induced viewport shifts cannot leave stale geometry.
- **Preserve the existing visual system:** Keep the current stone palette, typography, borders, radii, focus treatment, and transition behavior; this is an interaction-quality fix, not a modal restyle.

## Scope Boundaries

### Included

- Shared Watch audio and subtitle language combobox geometry.
- Focused regression coverage for keyboard-reduced visible viewport behavior.
- Mobile visual proof against the Watch language picker.

### Deferred to Follow-Up Work

- A broader mobile bottom-sheet redesign of the language and subtitle modal.
- Changes to language ranking, fuzzy matching, option data, or navigation behavior.
- Changes to unrelated Watch dialogs or global dialog primitives.

## Implementation Units

### U1. Add the roadmap contract

- **Goal:** Record the mobile keyboard failure, implementation boundary, and verification expectations in the platform roadmap.
- **Requirements:** R1, R4, R5.
- **Dependencies:** None.
- **Files:** `docs/roadmap/platform/feat-264-watch-language-picker-mobile-keyboard.md`.
- **Approach:** Add an in-progress Watch/web platform ticket using the next sequential feature ID, then mark it complete after validation.
- **Patterns to follow:** `docs/roadmap/platform/feat-169-watch-language-picker-search-ranking.md`.
- **Test expectation:** None -- this unit records the implementation contract and completion state.
- **Verification:** The ticket names the exact entry points, exclusions, and mobile proof expected for this fix.

### U2. Make combobox geometry follow the Visual Viewport

- **Goal:** Place and constrain the open search popover within the keyboard-adjusted visible area.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/LanguageCombobox.tsx`, `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`.
- **Approach:** Derive visible top and bottom bounds from `window.visualViewport` when available, retain the current Layout Viewport fallback, and subscribe to the relevant viewport events only while the popover is open. Feed those bounds through the existing placement and listbox-height calculation.
- **Patterns to follow:** The existing `useLayoutEffect` popover measurement, above/below placement classes, bounded `overflow-y-auto` listbox, and focused geometry tests in `LanguageCombobox.test.tsx`.
- **Test scenarios:**
  - With a tall layout viewport but a keyboard-reduced Visual Viewport below the trigger, the popover chooses the visible side with more space and its list height fits that visible area.
  - When the Visual Viewport resizes while the combobox is open, placement and maximum list height are recalculated.
  - When the Visual Viewport scrolls or changes offset while open, placement is recalculated against the shifted visible bounds.
  - Without `window.visualViewport`, the existing `window.innerHeight` placement and `window.resize` response remain intact.
  - Existing keyboard navigation, selection, and virtualization tests remain green.
- **Verification:** The focused combobox test suite proves initial and event-driven geometry in both Visual Viewport and fallback modes.

### U3. Prove the mobile interaction and close the ticket

- **Goal:** Verify that the real Watch picker remains searchable in a phone-sized browser with the visible area reduced by the keyboard.
- **Requirements:** R1, R4, R5.
- **Dependencies:** U2.
- **Files:** `docs/roadmap/platform/feat-264-watch-language-picker-mobile-keyboard.md`.
- **Approach:** Open the Watch language modal from the player, focus search, enter a language query, and inspect the search field, first matching result, scrolling, and absence of horizontal overflow at a mobile viewport. Capture a screenshot and confirm desktop behavior remains unchanged.
- **Patterns to follow:** Existing Watch browser verification opens the modal from `hero-chrome-language` before asserting picker geometry.
- **Test expectation:** None -- runtime browser proof validates the CSS and browser viewport integration that jsdom cannot reproduce visually.
- **Verification:** The focused result and at least one actionable match are unobscured in mobile proof, desktop smoke still passes, and the roadmap ticket is marked complete.

## Risks & Dependencies

- Mobile Safari may change Visual Viewport offset during keyboard and toolbar animation, so the calculation must tolerate repeated resize and scroll events without accumulating listeners.
- Browser automation may not expose a native iOS keyboard. If so, use a real iOS Simulator/Mobile Safari surface or explicitly emulate the reduced Visual Viewport and verify geometry plus a phone-sized screenshot.
- The combobox is shared by audio and subtitle selection, so focused tests must protect both caller-neutral geometry and existing interaction behavior.

## Sources & Research

- `apps/web/src/components/watch/LanguageCombobox.tsx` contains the current `window.innerHeight` placement calculation and window-only resize listener.
- `apps/web/src/components/watch/LanguagePickerModal.tsx` establishes the compact Watch modal presentation and fullscreen portal boundary.
- `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx` contains existing above/below and constrained-height geometry coverage.
- MDN Visual Viewport documentation explains that on-screen keyboards can shrink the visual viewport without affecting the layout viewport and that the API emits resize events.
- WebKit documents Visual Viewport support on iOS as accounting for the on-screen keyboard.
