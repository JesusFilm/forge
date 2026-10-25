---
title: "fix: Restore search modal focus and alignment"
type: fix
status: complete
date: 2026-07-09
origin: docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md
---

# fix: Restore search modal focus and alignment

## Summary

Restore the global Watch search modal so opening it automatically focuses the modal search input and the opened input aligns with the closed floating search field. The fix stays within the existing canonical modal surface and avoids changing search data behavior, language filters, or result rendering.

## Problem Frame

The closed floating search field used to transition into the modal without a visible input shift, and keyboard users could type immediately because focus landed in the modal input. A later contribution regressed both: the opened modal no longer reliably focuses the search input, and the input position/shape drifts from the closed search field.

---

## Requirements

- FR1. Opening the global search modal must focus the modal search input automatically so typing can begin immediately.
- FR2. The modal input must preserve focus after the modal's initial render work, including language-control rendering.
- FR3. The modal input's top-bar geometry must match the closed floating search field at the shared breakpoints so opening the modal does not visibly move the field.
- FR4. The fix must stay inside the existing global search modal and must not add a new search page, route, or alternate search surface.
- FR5. Existing search behavior, language controls, result rendering, close behavior, and query preservation must continue to work.

---

## Key Technical Decisions

- **Focus after the opened DOM is stable:** Focus should be scheduled from the modal input itself after `open` becomes true, with enough timing resilience that later mount work does not steal the initial focus.
- **Share geometry rather than hand-copying drift-prone values:** The opened modal field should use the same field component and width constants as the closed search bar wherever possible, with only modal-specific wrapper differences.
- **Constrain the visual fix to the search top bar:** Search results, categories, language filtering, analytics, and query execution are out of scope unless they are directly interfering with focus or alignment.

---

## Scope Boundaries

- Deferred to follow-up work: broader visual redesign of the search overlay, language surface, or result grid.
- Out of scope: changing Algolia versus semantic search behavior, search route state, result ranking, analytics payloads, or public Watch route builders.
- Out of scope: introducing a separate `/watch/search`, `/videos`, or query-driven search page.

---

## Implementation Units

### U1. Restore reliable modal input autofocus

**Goal:** Ensure opening the search modal focuses the modal's text input automatically and keeps that focus after initial overlay rendering.

**Requirements:** FR1, FR2, FR5

**Dependencies:** None

**Files:**

- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

**Approach:** Inspect the existing focus timing around `SearchOverlay` and make the focus request resilient to React mount timing and client-only portal behavior. Keep the focus target on the actual modal input, and avoid moving focus to the dialog wrapper or language controls during the open path.

**Patterns to follow:** Existing focus management in `SearchOverlay`; `openSearchOverlay()` helper and search overlay tests in `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`; focus restoration patterns in nearby modal tests where jsdom can represent focus.

**Test scenarios:**

- Opening the floating search field focuses the modal input without requiring a second click.
- Focus remains on the modal input after timers or deferred open work complete.
- Clearing the input returns focus to the same modal input.

**Verification:** The focused web component test proves `document.activeElement` is the search input after opening and after relevant timers settle.

### U2. Re-align modal input geometry with the closed search field

**Goal:** Remove the visual jump between the closed floating search field and the opened modal search input.

**Requirements:** FR3, FR4, FR5

**Dependencies:** U1

**Files:**

- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/FloatingSearchField.tsx`
- `apps/web/src/components/FloatingSearchBar.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

**Approach:** Compare the closed field and opened modal field classes, then align the modal wrapper with the closed field's width, height, border radius, padding, and breakpoint behavior. Treat the provider's fixed floating header wrapper as the closed field's viewport-position source of truth, while `FloatingSearchBar` and `FloatingSearchField` own the field internals. The search field wrapper is the measured no-shift target; language controls must render outside that measured wrapper, or otherwise be excluded from it, when they would alter the field width, height, or radius.

**Patterns to follow:** `FloatingSearchFieldButton` and `FloatingSearchFieldInput` as the single visual contract for the field; shared floating-header geometry constants in `apps/web/src/lib/content-width.ts` for the closed/open top bar frame; prior solution guidance that mirror UI should derive geometry from the real component's constants.

**Test scenarios:**

- The closed floating search field and opened modal input share the same stable height and width contract classes.
- The modal top bar keeps the same horizontal alignment classes as the closed floating search bar wrapper.
- Language control rendering does not remove the modal input's stable field sizing classes.

**Verification:** Focused component assertions cover the class contract, and browser visual proof shows the field stays in place when opened.

### U3. Run focused validation and browser proof

**Goal:** Prove the restored behavior in both automated tests and a real browser surface.

**Requirements:** FR1, FR2, FR3, FR5

**Dependencies:** U1, U2

**Files:**

- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

**Approach:** Run the narrow web test file first, then a browser smoke against the local web app. Measure the closed floating field and opened modal input bounding boxes at shared mobile and desktop breakpoints, assert width, height, top, and left deltas stay within an explicit pixel tolerance, verify the active element is the modal input, and save screenshot evidence for the opened state.

**Patterns to follow:** Existing Forge local web validation shape; browser-facing change default of smoke testing plus screenshot evidence.

**Test scenarios:**

- Unit/integration test opens the modal and asserts focus.
- Browser smoke opens the modal from the floating field, compares closed and opened input bounding boxes at mobile and desktop breakpoints, verifies input focus, and captures the aligned open state.

**Verification:** Targeted Vitest passes, browser bounding-box checks confirm focus/alignment within the chosen tolerance, and screenshot evidence is saved.

---

## Risks & Dependencies

- Browser layout is the source of truth for visual shift; jsdom class assertions can prevent known drift but cannot prove pixel alignment by themselves.
- The modal language control can change row composition at medium breakpoints, so the implementation should preserve the primary input geometry independently of whether that control is visible.

---

## Sources & Research

- `docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md`
- `apps/web/AGENTS.md`
- `apps/web/CLAUDE.md`
- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/FloatingSearchField.tsx`
- `apps/web/src/components/FloatingSearchBar.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `docs/solutions/design-patterns/mirror-ui-derive-geometry-from-shared-constants.md`
