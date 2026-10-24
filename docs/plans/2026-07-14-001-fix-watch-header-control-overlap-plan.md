---
title: Fix Watch Header Control Overlap
type: fix
status: completed
date: 2026-07-14
---

# Fix Watch Header Control Overlap

## Summary

Remove the duplicate series-page language control so the global Watch header is the only trailing-control surface. Preserve the existing header geometry, keep the language action available in static and playable series heroes, and add browser-level spatial regression proof.

## Problem Frame

Production reproduction at `/watch/lumo-the-gospel-of-matthew.html/english.html` showed the series page rendering two independent fixed controls in the same top-right area: the global header account control and `SeriesPageClient`'s local language button. At 400 px wide their rectangles intersected, while a normal video route using only the global header had positive separation. The bug is duplicate UI ownership, not the shared header width contract.

## Requirements

- R1. The floating language control must render the globe and active language code as one readable control without colliding with the account control.
- R2. Language and account controls must remain horizontally separated and vertically aligned at mobile and desktop Watch breakpoints, including the narrow production shape shown in the bug report.
- R3. The search field must continue to consume the remaining header width without covering either trailing control or moving the logo.
- R4. Search-open mirroring must reserve the same trailing-control width as the closed header so opening the modal does not shift its input.
- R5. Language switching, account behavior, focus treatment, responsive header motion, and player-chrome visibility behavior must remain unchanged.
- R6. The fix must add no data fetch, client controller, dependency, or measurable page-loading regression.

## Key Technical Decisions

- **KTD1. Eliminate the duplicate control:** Remove the series-local fixed language button and publish the existing global-header language-switcher event instead. Do not change the already-correct global trailing-control geometry.
- **KTD2. Keep one event publisher per hero mode:** `SeriesPageClient` owns the event for a static series hero. When a playable trailer renders `HeroPlayer`, pass the language callback and count through `SeriesHero` so the player remains the sole publisher and can preserve fullscreen/chrome visibility behavior.
- **KTD3. Verify rendered rectangles, not only DOM presence:** Retain focused event-wiring tests, then use a real browser to assert exactly one language control, positive separation from the account control, and aligned centers at representative narrow and wide viewports.

## Scope Boundaries

- Do not change language-code derivation, language routing, account authentication, player controls, or search behavior.
- Do not restyle the header, enlarge its safe-area band, or alter the Watch rail edges beyond what is required to prevent overlap.
- Do not alter shared header sizing or add a responsive breakpoint to compensate for a duplicate control.

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

### U2. Route series language switching through the global header

- **Goal:** Remove the series-local fixed button and preserve one global language-switcher publisher across static and playable series heroes.
- **Requirements:** R1, R2, R3, R4, R5, R6.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/SeriesPageClient.tsx`, `apps/web/src/components/watch/SeriesHero.tsx`, `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`, `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`.
- **Approach:** Remove `series-page-language-button`. In static mode, publish `WATCH_HEADER_LANGUAGE_SWITCHER_EVENT` with the existing modal callback and active code. In playable-trailer mode, delegate the callback and playable-language count through `SeriesHero` to `HeroPlayer`, avoiding competing last-writer-wins publishers and preserving fullscreen visibility behavior.
- **Patterns to follow:** `HeroPlayer`'s existing `WATCH_HEADER_LANGUAGE_SWITCHER_EVENT` contract and `WatchSectionRenderer`'s `onLanguageClick`/`playableLanguageCount` wiring.
- **Test scenarios:**
  - A static series with 2+ languages publishes the global header callback and active code, while no series-local button renders.
  - A static series with fewer than 2 languages hides the global switcher.
  - A playable series trailer delegates the callback and count to `HeroPlayer` and does not publish a competing parent event.
  - Invoking the global callback opens the existing series language modal.
- **Verification:** Focused series and floating-header tests prove single-owner event wiring with no new runtime data or initialization work.

### U3. Prove the production layout and close the ticket

- **Goal:** Validate the regression fix in automated checks and a real browser, then mark the roadmap ticket complete.
- **Requirements:** R1 through R6.
- **Dependencies:** U2.
- **Files:** `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`, `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`, `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`, `docs/roadmap/platform/feat-252-watch-header-control-overlap.md`, `docs/roadmap/README.md`.
- **Approach:** Run the focused series/header tests and CI-sensitive web checks. In the reproduced series route, assert that the obsolete local button is absent, the single global language control has a positive gap from the account control at mobile and desktop widths, and search-open state remains stable. Compare requests and initialization behavior to confirm the event-only integration adds no loading work.
- **Patterns to follow:** Browser geometry proof from `docs/plans/2026-07-09-002-fix-search-modal-focus-alignment-plan.md` and the Watch frontend completion requirements in `apps/web/AGENTS.md`.
- **Test scenarios:**
  - At a 390-pixel-wide viewport, the language and account rectangles do not intersect, both controls are fully visible, and the search field stays within its own rectangle.
  - At a desktop viewport, the same controls remain separated and vertically aligned without excessive trailing whitespace.
  - Opening and closing global search does not shift the input or reintroduce overlap in the persistent header controls.
  - Keyboard focus reaches language and account controls independently with visible focus rings.
- **Verification:** Focused tests, typecheck, lint/format checks, browser rectangle assertions, and before/after screenshot evidence pass; the roadmap ticket is marked complete with concise completion notes.

## Risks & Dependencies

- A duplicate fixed control can look harmless at desktop widths; real-browser narrow-viewport rectangle assertions are required.
- The header event is last-writer-wins. Static and playable hero modes must never publish competing state.
- A very narrow viewport can legitimately compress the search field, but the one global trailing group must remain separated and aligned.

## Sources & Research

- `apps/web/src/components/watch/SeriesPageClient.tsx`
- `apps/web/src/components/watch/SeriesHero.tsx`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `docs/roadmap/platform/feat-245-watch-language-code-selectors.md`
- `docs/plans/2026-07-09-002-fix-search-modal-focus-alignment-plan.md`
