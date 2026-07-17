---
title: "fix: Watch Language Modal Parent Scroll"
type: fix
status: active
date: 2026-07-16
---

# fix: Watch Language Modal Parent Scroll

## Summary

Move Watch language-modal scrolling to a viewport-sized dialog parent at every breakpoint while keeping the visible form centered and width-capped. The native scroll track will align with the page edge instead of appearing beside the 608px modal.

## Problem Frame

The current language picker uses a full-viewport scroll surface only below the `sm` breakpoint. At `sm` and wider, responsive classes shrink the scroll-owning dialog popup back to the centered content width, so a short landscape viewport shows an inset scrollbar between the form and the fixed close button, as in the reported Safari screenshot.

## Assumptions

- The screenshot represents the current `origin/main` language picker after the catalog-link and subtitle-layout updates.
- Implementation begins from current `origin/main`, then re-verifies the cited modal classes and focused tests before editing; the initial detached checkout predates this UI.
- “Match page scroll” means the modal uses a native viewport-edge scrollbar and page-like wheel/touch behavior, not the stone-themed inner-list scrollbar used by comboboxes.
- Share, Download, and other dialogs keep their current scrolling behavior; this change only opts the language picker into the new parent-scroll path.

## Requirements

- R1. A full-viewport dialog parent owns vertical scrolling for the Watch language picker at every responsive breakpoint.
- R2. The language-picker form remains centered, constrained to 608px, and vertically centered when it fits while all controls remain reachable when the viewport is short.
- R3. The modal uses the native page-like scroll treatment so the scrollbar appears at the viewport edge rather than beside the form.
- R4. Horizontal-overflow protection, backdrop coverage, focus trapping, body scroll lock, fixed close control, and fullscreen portal behavior remain intact.
- R5. Language selection, subtitle selection, catalog links, navigation, and combobox scrolling are unchanged.

## Scope Boundaries

- Do not redesign the language or subtitle controls.
- Do not change the shared behavior of dialogs that do not opt into parent scrolling.
- Do not alter Watch routes, language data, subtitle state, generated GraphQL artifacts, or locale catalogs.
- Do not replace the combobox list’s independent scroll area; only the modal shell’s vertical overflow ownership changes.

## Context and Research

- `apps/web/src/components/watch/LanguagePickerModal.tsx` currently places `overflow-y-auto` on `DialogContent`, then applies `sm:max-w-[608px]` and related centering overrides to that same scroll owner.
- `apps/web/src/components/ui/dialog.tsx` renders the Base UI portal, backdrop, and popup directly and is the narrow seam for an optional viewport wrapper without changing default callers.
- `apps/web/src/components/SearchOverlay.tsx` demonstrates the desired local pattern: a full-surface parent owns vertical overflow while centered content stays width-capped inside it.
- `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md` established that the fixed surface should use the available viewport and the visible content should be centered in an inner capped container.

## Key Technical Decisions

- Add an opt-in dialog viewport path rather than changing every dialog. This gives the language picker a true parent scroll owner while preserving the current portal/backdrop/popup structure for existing callers.
- Keep native scrollbar behavior on the viewport parent. Reusing stone-themed inner-scroll classes would preserve the inset, component-like feel the request is correcting.
- Keep width constraints and vertical centering on the popup/content layer. The scroll parent remains full-screen at all breakpoints and never collapses to the 608px content width.

## Implementation Units

### U1. Add Opt-In Dialog Viewport Scrolling

**Goal:** Let a dialog caller render its popup inside a full-viewport scroll parent without changing default dialog behavior.

**Requirements:** R1, R3, R4

**Dependencies:** None

**Files:**

- Modify: `apps/web/src/components/ui/dialog.tsx`
- Create: `apps/web/src/components/ui/__tests__/dialog.test.tsx`
- Test through caller: `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`

**Approach:**

- Extend `DialogContent` with an optional viewport configuration that renders a Base UI dialog viewport between the portal/backdrop and popup.
- Keep the existing direct-popup path as the default for all callers that do not request a viewport.
- Make the opt-in popup a relative, width-capped child without the shared fixed-position transforms. Let the viewport own padding and vertical overflow, and use vertical auto margins so content centers only when space is available and otherwise starts inside the scrollable padding.
- Ensure the viewport remains inside the selected portal container so fullscreen rendering continues to work.

**Patterns to follow:**

- Existing `overlayClassName` and `portalContainer` opt-in props in `apps/web/src/components/ui/dialog.tsx`.
- Full-surface overflow ownership in `apps/web/src/components/SearchOverlay.tsx`.

**Test scenarios:**

- Opt-in path: rendering the language picker creates a dialog viewport that is fixed to the viewport and owns vertical overflow.
- Opt-in structure: the language-picker popup is a distinct child of the viewport and no language-modal scroll class is placed on the shared backdrop.
- Default path: a non-opted `DialogContent` renders its popup without a viewport wrapper.
- Fullscreen integration: the existing portal-container assertion continues to prove the viewport and popup render inside the fullscreen element.

**Verification:**

- The dialog DOM has a viewport parent around the language-picker popup, and existing dialog callers remain on the unchanged default path.

### U2. Keep the Language Picker Form Inside the Page-Aligned Scroller

**Goal:** Move the language picker’s scroll ownership to the viewport parent while preserving the current centered layout and all interaction behavior.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** U1

**Files:**

- Modify: `apps/web/src/components/watch/LanguagePickerModal.tsx`
- Modify: `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- Create: `docs/roadmap/platform/feat-264-watch-language-modal-page-scroll.md`

**Approach:**

- Opt the language picker into the full-viewport dialog parent and remove breakpoint rules that make the 608px popup own vertical overflow.
- Preserve the existing horizontal overflow guard, viewport-relative minimum height, short-viewport padding, and inner 608px content cap on the appropriate parent/child layers.
- Record the focused Watch layout fix in the platform roadmap and mark it complete when validation finishes.

**Patterns to follow:**

- Mobile overflow containment from `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md`.
- Existing shell assertions in `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`.

**Test scenarios:**

- Reported Safari landscape (`1280 × 543` CSS px, subtitles enabled): the viewport parent owns scrolling, the native indicator appears at the viewport edge during active scroll, all footer actions are reachable, the close control remains fixed and operable, and the background page stays locked.
- Narrow portrait (`390 × 844` CSS px): the parent still owns scrolling, the modal has no horizontal overflow, and the existing compact layout remains usable.
- Short breakpoint-plus landscape (`768 × 480` CSS px): no responsive class collapses the scroll owner to 608px, and overflow-safe auto margins keep the first and last controls reachable.
- Tall desktop (`1280 × 900` CSS px): the form stays centered and capped at 608px without introducing a second vertical scroller.
- Nested scroll arbitration: while an open language or subtitle list has remaining scroll range, wheel/touch input inside it advances that list without moving the modal viewport; input outside the list scrolls the modal parent, and closing the list restores normal parent scrolling.
- Keyboard accessibility: Tab and Shift+Tab keep focus inside the dialog, scroll offscreen focused controls into view without moving the background page, keep the close control operable, and return focus to the opener on close.
- Regression: horizontal overflow protection and the inner combobox list’s independent scrolling remain present.
- Fullscreen regression: opening the language picker from a fullscreen player still mounts the complete dialog inside the fullscreen element.

**Verification:**

- In Safari or iOS WebKit at the reported landscape dimensions, the native scroll indicator is at the viewport edge, scrolling reaches every action, the close control remains fixed, and the page behind the modal remains locked.
- At a narrow portrait viewport, the modal has no horizontal overflow and retains the existing mobile layout.
- Focused tests, web type checking, linting, and browser smoke pass without changing language or subtitle behavior.

## Risks and Dependencies

- A viewport wrapper can change popup positioning if fixed-position defaults are not neutralized. Keep positioning responsibility explicit between the full-screen viewport and centered popup, then verify both short and tall viewports.
- Fullscreen portals are sensitive to elements mounted outside `document.fullscreenElement`. The viewport must use the same portal container as the backdrop and popup.
- Base UI continues to own focus trapping and background scroll lock; browser proof must confirm the page behind the modal does not become the active scroller.
