---
title: Fix Watch Header Control Overlap
type: fix
status: active
date: 2026-07-14
---

# Fix Watch Header Control Overlap

## Summary

Restore a stable Watch floating-header layout so the active-language globe/code control and the adjacent account control remain distinct, aligned, and usable at production viewport widths. Keep the fix within the existing header geometry contract and add browser-level spatial regression proof.

## Problem Frame

Production Watch currently renders the language and account icons on top of each other in the floating header. The regression coincides with `feat-245` adding a language code beside the globe: `FloatingSearchProvider` widened that button locally while the shared header contract and adjacent account slot retained the earlier fixed-icon assumptions. Treat that class conflict as the leading hypothesis until a real-browser reproduction confirms the computed layout. Existing component tests assert class names and content, but they do not prove the rendered controls have non-overlapping rectangles.

## Requirements

- R1. The floating language control must render the globe and active language code as one readable control without colliding with the account control.
- R2. Language and account controls must remain horizontally separated and vertically aligned at mobile and desktop Watch breakpoints, including the narrow production shape shown in the bug report.
- R3. The search field must continue to consume the remaining header width without covering either trailing control or moving the logo.
- R4. Search-open mirroring must reserve the same trailing-control width as the closed header so opening the modal does not shift its input.
- R5. Language switching, account behavior, focus treatment, responsive header motion, and player-chrome visibility behavior must remain unchanged.
- R6. The fix must add no data fetch, client controller, dependency, or measurable page-loading regression.

## Key Technical Decisions

- **KTD1. Fix the shared trailing-control geometry:** Treat the language-plus-code control as an intrinsically sized flex item and keep the account control as a separate non-shrinking slot. The header and search-overlay mirror should derive from the same contract instead of relying on conflicting fixed-width and automatic-width utilities.
- **KTD2. Verify rendered rectangles, not only utility strings:** Retain focused component assertions for the shared contract, then use a real browser to assert the controls do not intersect and remain aligned at representative narrow and wide viewports.
- **KTD3. Preserve the existing header composition:** Keep the language event wiring, account component, search field, logo, and header visibility lifecycle intact; this is a layout regression fix rather than a redesign.

## Scope Boundaries

- Do not change language-code derivation, language routing, account authentication, player controls, or search behavior.
- Do not restyle the header, enlarge its safe-area band, or alter the Watch rail edges beyond what is required to prevent overlap.
- Do not add a new responsive breakpoint or JavaScript measurement when the existing flex layout can express the contract.

## Implementation Units

### U1. Track the production header regression

- **Goal:** Add an active roadmap ticket before implementation and preserve the production symptom, entry points, constraints, and verification contract.
- **Requirements:** R1, R2, R6.
- **Dependencies:** None.
- **Files:** `docs/roadmap/platform/feat-252-watch-header-control-overlap.md`, `docs/roadmap/README.md`.
- **Approach:** Use the next global roadmap ID and link the regression to the completed language-code selector work. Keep the ticket focused on the floating Watch header and the screenshot-backed narrow-viewport failure.
- **Patterns to follow:** `docs/roadmap/platform/feat-245-watch-language-code-selectors.md` and other completed one-day Watch UI fixes in `docs/roadmap/platform/`.
- **Test scenarios:** Test expectation: none -- roadmap-only tracking.
- **Verification:** The roadmap index contains the in-progress ticket and the ticket names the exact code and browser proof surfaces.

### U2. Make trailing controls collision-safe

- **Goal:** Give the language-plus-code and account controls an explicit non-overlapping flex contract while keeping the search field fluid.
- **Requirements:** R1, R2, R3, R4, R5, R6.
- **Dependencies:** U1.
- **Files:** `apps/web/src/lib/content-width.ts`, `apps/web/src/components/FloatingSearchProvider.tsx`, `apps/web/src/components/SearchOverlay.tsx`, `apps/web/src/components/SearchOverlayInstantShell.tsx`, `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`, `apps/web/src/lib/__tests__/content-width.test.ts`.
- **Approach:** First reproduce the overlap and inspect computed rectangles and styles for the language button, account wrapper, trailing group, and search field. If the leading class-conflict hypothesis is confirmed, remove the fixed-width/automatic-width conflict from the language slot and encode intrinsic width plus non-shrinking behavior in the shared header geometry. Ensure the closed header, full search overlay, and instant shell reserve the same trailing composition. Keep the account slot and search flex behavior unchanged except where an explicit non-shrinking boundary is needed.
- **Patterns to follow:** Shared `FLOATING_HEADER_*` constants in `apps/web/src/lib/content-width.ts`; the mirrored closed/open header contract established by `docs/plans/2026-07-09-002-fix-search-modal-focus-alignment-plan.md`; `AccountControl` as the owner of account-button sizing.
- **Test scenarios:**
  - With language code `EN`, the language button uses the expandable shared slot contract and the account control remains a separate fixed slot.
  - Without a language code, the globe-only state preserves its compact slot and does not change account alignment.
  - Opening the instant or full search overlay reserves the same language-plus-account trailing width as the closed header.
  - Hiding language chrome or replacing the account control with the search close button preserves the existing slot count and header motion behavior.
- **Verification:** Focused component and constant tests prove all three header representations consume the same collision-safe geometry, with no new runtime data or initialization work.

### U3. Prove the production layout and close the ticket

- **Goal:** Validate the regression fix in automated checks and a real browser, then mark the roadmap ticket complete.
- **Requirements:** R1 through R6.
- **Dependencies:** U2.
- **Files:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`, `docs/roadmap/platform/feat-252-watch-header-control-overlap.md`, `docs/roadmap/README.md`.
- **Approach:** Run the focused header tests and CI-sensitive web checks. In a local production-like Watch route, inspect the language and account bounding rectangles at narrow mobile and desktop widths, verify a positive horizontal gap and aligned vertical centers, open search to confirm the mirrored header remains stable, and capture screenshots. Compare page requests and initialization behavior to confirm the CSS-only fix adds no loading work.
- **Patterns to follow:** Browser geometry proof from `docs/plans/2026-07-09-002-fix-search-modal-focus-alignment-plan.md` and the Watch frontend completion requirements in `apps/web/AGENTS.md`.
- **Test scenarios:**
  - At a 390-pixel-wide viewport, the language and account rectangles do not intersect, both controls are fully visible, and the search field stays within its own rectangle.
  - At a desktop viewport, the same controls remain separated and vertically aligned without excessive trailing whitespace.
  - Opening and closing global search does not shift the input or reintroduce overlap in the persistent header controls.
  - Keyboard focus reaches language and account controls independently with visible focus rings.
- **Verification:** Focused tests, typecheck, lint/format checks, browser rectangle assertions, and before/after screenshot evidence pass; the roadmap ticket is marked complete with concise completion notes.

## Risks & Dependencies

- Tailwind utility conflicts can look correct in jsdom while the generated stylesheet resolves width utilities differently; real-browser rectangle assertions are required.
- The overlay shell mirrors the persistent header by placeholder slots, so changing only the visible button would fix the screenshot but reintroduce search-open shift.
- A very narrow viewport can legitimately compress the search field; the trailing controls must not shrink or overlap even when the search field reaches its minimum useful width.

## Sources & Research

- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/watch/AccountControl.tsx`
- `apps/web/src/lib/content-width.ts`
- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/SearchOverlayInstantShell.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `docs/roadmap/platform/feat-245-watch-language-code-selectors.md`
- `docs/plans/2026-07-09-002-fix-search-modal-focus-alignment-plan.md`
