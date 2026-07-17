---
title: "fix: Prevent Watch subtitle header overlap"
type: fix
status: active
date: 2026-07-16
---

# fix: Prevent Watch subtitle header overlap

## Summary

Recompose the Watch language modal's subtitle controls so the heading and toggle remain the primary mobile row while the conditional Translate with AI action moves to a second row. Restore the compact single-row arrangement at desktop widths.

## Problem Frame

At a narrow mobile viewport, the subtitle heading competes with a non-shrinking action group containing both the Translate with AI pill and the fixed-width toggle. The left flex item collapses, but its title and count paint into the action group, producing the overlap shown on the Russian Watch page. The existing layout test covers the toggle-only state and does not exercise the translated-subtitles-only state that renders both controls.

## Requirements

- R1. At narrow mobile widths, the subtitle heading, count, and toggle must remain readable and non-overlapping.
- R2. When the selected audio language has no matching subtitle, Translate with AI must render as a secondary row without displacing the heading or toggle.
- R3. At `sm` and wider widths, the heading, toggle, and conditional AI action should return to a compact inline arrangement only if the 608px modal can contain the longest supported localized labels without overlap; otherwise the AI action must remain on its second row.
- R4. Existing subtitle availability, toggle enablement, request-sent behavior, tooltips, focus treatment, and localization behavior must remain unchanged.
- R5. Browser proof must cover the CTA-present Russian state at mobile width and the longest supported localized or RTL label set at the 608px modal width, confirming no sibling intersection or horizontal overflow before and after Request sent.

## Key Technical Decisions

- **Use explicit responsive grid placement:** A two-column mobile grid gives the heading flexible space and reserves the toggle's intrinsic width; the AI action spans a second row. A three-column `sm` layout is allowed only when localization proof shows the modal's fixed maximum width can contain it.
- **Keep the toggle in the primary row:** The toggle is the direct state control for subtitles and belongs with the section heading. Translate with AI is conditional remediation and should be visually subordinate.
- **Keep DOM, focus, and visual order aligned:** Render the heading first, the toggle second, and Translate with AI third at every breakpoint so keyboard navigation follows the same primary-to-secondary hierarchy users see.
- **Give heading text an explicit mobile reflow:** Pair the icon with a `min-w-0` text stack that permits the localized heading to wrap and keeps the count beneath it on mobile; the count may return inline at wider widths only when geometry remains valid.
- **Preserve the action's wrapping safeguards:** Retain `min-w-0`, bounded width, shrink, and mobile text wrapping so long localized labels cannot recreate the overflow inside their own row.

## Implementation Units

### U1. Encode the responsive subtitle-header contract

- **Goal:** Replace the competing mobile flex row with deterministic responsive placement while preserving all control behavior.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** None
- **Files:** `docs/roadmap/platform/feat-264-watch-subtitle-header-overlap.md`, `apps/web/src/components/watch/LanguagePickerModal.tsx`, `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- **Approach:** Create and activate the roadmap ticket, then make the heading tooltip, toggle tooltip, and optional AI tooltip direct responsive-layout participants in that DOM order. Place heading and toggle in the first mobile row and the AI action across the second row aligned to the logical end. Within the heading, keep the icon fixed and let a `min-w-0` title/count stack wrap without painting outside its cell. Use separate inline columns from `sm` upward only if localized geometry proof passes; otherwise retain the two-row composition. Do not hide or clip content and do not change subtitle state conditions.
- **Patterns to follow:** `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md`; the inline-toggle contract from `docs/roadmap/platform/feat-250-watch-single-video-subtitles.md`; existing `MODAL_FOCUS_RING_CLASS` and `MultilingualTooltip` wrappers in `apps/web/src/components/watch/LanguagePickerModal.tsx`.
- **Test scenarios:**
  - Available same-language subtitles render the heading/count and enabled toggle in the primary row without the AI action.
  - Translated subtitles with no same-language option render an enabled toggle in the primary row and Translate with AI in the second mobile row.
  - No selectable subtitles render a disabled toggle in the primary row and Translate with AI in the second mobile row.
  - A deliberately long localized heading wraps within the mobile text stack, keeps its count beneath it, and does not intersect the toggle.
  - Keyboard focus reaches the subtitle toggle before Translate with AI in the CTA-present enabled state.
  - From `sm` upward, the toggle and conditional AI action occupy separate inline columns beside the heading only when the longest supported localized labels fit.
  - Clicking Translate with AI still changes the button to Request sent without navigation or subtitle-state mutation.
- **Verification:** Focused component tests pass and assert the responsive placement contract rather than only the absence of `flex-col` classes.

### U2. Prove the mobile and desktop geometry

- **Goal:** Confirm the fix against the reported Safari-sized state and ensure the compact desktop layout remains intact.
- **Requirements:** R1, R2, R3, R5
- **Dependencies:** U1
- **Files:** `docs/roadmap/platform/feat-264-watch-subtitle-header-overlap.md`
- **Approach:** Open the language modal from the Watch player language control on `/watch/jesus.html/russian.html`. Inspect the CTA-present state at 390px width, including after Request sent. At the 608px modal width, repeat with the longest supported localized or RTL combination of heading and AI-action labels. Capture visual proof and compare element bounding rectangles instead of relying only on document scroll width. If the three-column composition fails this localization check, keep the AI action on its second row at all modal widths.
- **Test scenarios:**
  - At 390px width, heading and toggle rectangles do not intersect, the AI action starts below the first row, and the modal stays within the viewport.
  - After the request state changes to Request sent, the same geometry remains valid.
  - At the 608px modal width, the longest supported localized or RTL heading and AI-action labels remain contained and non-intersecting before and after Request sent.
  - The desktop result either proves heading, toggle, and AI action share one aligned row or confirms the AI action remains on its second row.
- **Verification:** Focused tests, web typecheck, and lint pass; mobile and desktop screenshots show the intended hierarchy; computed geometry reports no relevant intersections or horizontal overflow.

## Scope Boundaries

- No changes to subtitle selection rules, translation-request persistence, translated subtitle availability, or player cue rendering.
- No redesign of the language section, modal actions, Watch player, mobile app, or TV app.
- No typography reduction, content clipping, or hiding the subtitle count to manufacture space.

## Risks & Dependencies

- `MultilingualTooltip` supplies the layout wrapper, so responsive grid classes must be applied to the wrapper rather than only the nested button.
- Unit tests can verify DOM structure and responsive class contracts but not pixel geometry; the CTA-present browser state is required to close the regression gap.
- The current worktree started behind `origin/main`; implementation must branch from the refreshed `origin/main` while preserving unrelated untracked files.

## Sources & Research

- `apps/web/src/components/watch/LanguagePickerModal.tsx` — current subtitle header, CTA, and toggle composition.
- `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` — toggle-only and AI-request coverage with the missing combined-state geometry contract.
- `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md` — mobile stacking and localized pill shrink guidance.
- `docs/roadmap/platform/feat-250-watch-single-video-subtitles.md` — requirement to keep the subtitle toggle aligned with its heading when space permits.
- PR #1540 — introduced the inline toggle layout but proved only the toggle-only state.
- PR #1587 — later language catalog work whose no-overflow smoke did not detect sibling intersection.
