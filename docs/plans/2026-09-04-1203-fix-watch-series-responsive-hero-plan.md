---
title: "Watch Series Responsive Hero - Plan"
type: "fix"
date: "2026-09-04"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Watch Series Responsive Hero - Plan

## Goal Capsule

- **Objective:** People can read the full series title and use every hero action on phones, while series intros remain visually consistent with the muted Watch home and single-video intros on larger screens.
- **Means:** Reuse the bounded muted-intro sizing contract for static series heroes and make the series overlay responsive without changing its content or behaviors. (KTD1, KTD2)
- **Authority:** The user's visual feedback and settled choices override inferred implementation details. Existing Watch component contracts govern behavior outside the requested layout change.
- **Execution profile:** Code change with focused component tests, browser checks at mobile and desktop widths, and a loading-performance regression review.
- **Stop conditions:** Stop if the shared height contract changes playable trailer behavior, if action controls become unavailable, or if the cover treatment cannot preserve a legible mobile composition.
- **Tail ownership:** The shipping workflow owns review fixes, CI babysitting, and squash merge after all required checks pass.

## Product Contract

### Summary

Static Watch series pages use the same bounded intro dimensions as muted Watch home and single-video intros. On phones, the title and action controls remain contained and readable with clear space below the action row.

### Problem Frame

Static series heroes used an unbounded 16:9 frame that could grow taller than the viewport on wide displays. Their desktop title-and-actions row also squeezed long mobile titles into a narrow column and pushed controls outside the viewport.

### Key Decisions

- **Use the bounded muted intro dimensions for static series pages** (session-settled: user-directed — chosen over an unbounded 16:9 frame: the series template must match the muted single-video and Watch home intros). Governs R1, R2.
- **Keep the full-bleed image cover treatment** (session-settled: user-approved — chosen over contain or letterboxed artwork: the existing cinematic crop should remain). Governs R3.
- **Give mobile actions more space below the row** (session-settled: user-directed — chosen over the initial compact inset: the controls need a clearer bottom boundary on phones). Governs R4, R5.

### Requirements

- R1. Static series heroes use the Watch home muted-intro fallback contract, including its 34svh floor, mobile reserved-space rule, and desktop 16:9 cap.
- R2. Playable series trailers retain the existing `HeroPlayer` sizing and behavior.
- R3. Static series artwork remains full-bleed with the existing cover crop, scrim, and sticky overlay anchor.
- R4. Mobile layouts give the title the available content width and keep Download Collection and Share inside the viewport.
- R5. Standard mobile widths use a 20px bottom inset beneath the actions; widths below 360px use the compact 8px inset needed to avoid header collisions.
- R6. Action labels, accessible names, click behavior, routing, downloads, sharing, language selection, and series content remain unchanged.
- R7. The change adds no media request, dependency, client effect, runtime measurement, hydration work, or serialized page data.

### Acceptance Examples

- AE1. Covers R1, R3. Given a static series at desktop width, when its hero renders, then the intro uses the Watch home fallback dimensions and the artwork still covers the frame.
- AE2. Covers R2. Given a series with a playable trailer, when its hero renders, then `HeroPlayer` remains the rendered hero path.
- AE3. Covers R4, R5, R6. Given a 390px-wide phone viewport, when a long series title and both actions render, then the title uses the full content row, both actions remain visible, and 20px of bottom inset remains below them.
- AE4. Covers R4, R5, R6. Given a viewport narrower than 360px, when both actions render, then Share may show as an icon-only control while retaining its accessible name and the complete overlay remains clear of the header.

### Scope Boundaries

- **In scope:** Static series intro sizing, mobile hero overlay flow, action density at narrow widths, focused regression tests, responsive browser evidence, and roadmap traceability.
- **Out of scope:** Series data, routing, playback, modal behavior, language selection, artwork replacement, and redesign of playable video hero chrome.

## Planning Contract

### Key Technical Decisions

- KTD1. **Own the muted-intro fallback as one exported class string.** Apply it from both Watch home and the static series hero so their baseline dimensions cannot drift. Watch home may refine that baseline after hydration to fit its authored category rail; static series pages intentionally keep the shared baseline because they have no equivalent rail to measure. This implements R1 without adding runtime work. (session-settled: user-directed — chosen over duplicating or retaining the series-only `aspect-video` rule: the user requested intro-dimension parity)
- KTD2. **Stack title and actions on phones, then restore the established row at `md`.** Give the action group full mobile width and compact pill spacing. Below 360px, visually hide only the Share text while retaining its accessible name. This implements R4-R6. (session-settled: user-approved — chosen over keeping desktop side-by-side alignment on phones: screenshot review showed that layout clipping the title and actions)
- KTD3. **Use CSS-only responsive classes.** Preserve `object-cover`, event handlers, and component boundaries. This satisfies R3, R6, and R7.

### Assumptions

- The existing Watch home muted-intro fallback is the intended shared static sizing baseline. The home carousel's post-hydration rail fit is a page-specific refinement rather than the parity target for static series pages.
- The narrow-phone 8px inset is preferable below 360px because browser evidence shows that 20px would reduce the vertical room needed to keep the complete overlay clear of the header.

## Implementation Units

### U1. Share the muted-intro sizing contract

- **Goal:** Give Watch home and static series heroes one responsive height source.
- **Requirements:** R1, R2, R3, R7; KTD1, KTD3.
- **Dependencies:** None.
- **Files:** `apps/web/src/lib/watch-home-hero-fit.ts`, `apps/web/src/lib/watch-home-hero-fit.test.ts`, `apps/web/src/components/home/WatchHomeTvCarousel.tsx`, `apps/web/src/components/watch/SeriesHero.tsx`, `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`.
- **Approach:** Extract the existing bounded fallback classes into a shared export. Use the export in the home muted-intro branch and the static series branch. Leave the playable trailer branch and image cover classes unchanged.
- **Execution note:** This is a layout-contract change; use focused unit coverage plus runtime viewport measurement as the first proof.
- **Patterns to follow:** The existing Watch home fit constants and the static-versus-playable branch in `SeriesHero`.
- **Test scenarios:**
  1. A static series without a playable variant renders the shared height class and does not render `aspect-video`.
  2. A static series image retains `object-cover`, its scrim, and its overlay anchor.
  3. A series with a playable variant still delegates to `HeroPlayer`.
  4. The shared height contract retains the documented 34svh floor, mobile reserve, and desktop 16:9 cap.
- **Verification:** Focused tests pass. Same-viewport browser measurements record the static series height, the muted Watch home baseline and settled height, and the muted single-video intro boundary so any intentional post-hydration divergence is visible rather than inferred.

### U2. Repair the mobile title and action layout

- **Goal:** Keep long titles and every action readable and tappable across phone widths.
- **Requirements:** R4, R5, R6; KTD2, KTD3.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/SeriesPageClient.tsx`, `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`.
- **Approach:** Stack the title and action regions below `md`, use the page's mobile content gutter, give actions the available width, and restore the side-by-side layout at `md`. Apply the standard 20px bottom inset and the narrow-phone exception from R5.
- **Execution note:** Treat 320px as the stress case and 390px as the standard mobile acceptance viewport.
- **Patterns to follow:** Existing responsive Tailwind breakpoints, pill button semantics, and `sr-only` accessibility treatment.
- **Test scenarios:**
  1. The mobile overlay carries the 20px bottom inset and the below-360px compact override.
  2. The content row is column-oriented by default and returns to a row at `md`.
  3. The actions use full mobile width and return to content width at `md`.
  4. The narrow-phone Share label becomes visually hidden while the button retains its translated accessible name.
  5. Download and Share clicks continue to open their existing modal flows.
- **Verification:** Component tests pass, and browser captures at 320px and 390px show no title squeeze, clipping, action overflow, or header collision.

### U3. Record visual, performance, and roadmap evidence

- **Goal:** Leave durable proof that the responsive repair works and does not degrade page loading.
- **Requirements:** R3-R7.
- **Dependencies:** U1, U2.
- **Files:** `design-qa.md`, `docs/roadmap/platform/feat-453-watch-series-intro-dimensions.md`, `docs/roadmap/README.md`.
- **Approach:** Record the source defect, final responsive screenshots, cover-treatment confirmation, interaction checks, and loading-performance review. Mark the roadmap ticket complete after validation.
- **Test expectation:** None -- this unit records evidence for behavior proven by U1 and U2.
- **Verification:** The QA record covers 320x700, 390x844, and 1920x1080 viewports. The roadmap ticket lists the focused tests, typecheck, lint, formatting, browser smoke, and performance conclusion.

## Verification Contract

- Run the focused Vitest suites for `WatchHomePage`, `SeriesHero`, `SeriesPageClient`, and `watch-home-hero-fit` from the web package.
- Run the web TypeScript check and web lint, including generated UI locale validation.
- Run Prettier in check mode for touched files and `git diff --check`.
- Render `/watch/impulses-for-the-way.html` at 320x700, 390x844, and 1920x1080. Use 320x700 to prove the icon-only Share control retains its accessible name, the 8px inset applies, and the overlay clears the header. Use 390x844 to prove the 20px inset and fully labeled actions. Confirm desktop retains the side-by-side composition.
- At a common desktop viewport, record the static series height, the muted Watch home baseline and settled height, and the muted single-video intro boundary. Treat the shared fallback as the parity contract and record the home rail-fit refinement separately.
- Render the Watch home muted intro at the same target viewports and confirm extracting the fallback class did not change its composition.
- Run the playable-series branch test and smoke one series page with a trailer to confirm `HeroPlayer` sizing and controls remain unchanged.
- Confirm the static image still uses cover cropping and that the browser console has no page error.
- Review the diff for loading-performance impact. The exit condition is no added request, media asset, dependency, effect, runtime measurement, hydration work, or serialized data.

## Definition of Done

- U1 is complete when home and static series heroes consume the same bounded muted-intro class and focused sizing tests pass.
- U2 is complete when the responsive overlay tests and all three target viewport checks pass without clipping or regressions to action behavior.
- U3 is complete when the visual QA record and completed roadmap ticket contain the final verification evidence.
- All touched code passes focused tests, typecheck, lint, formatting, and whitespace checks.
- The final diff contains no abandoned experiments or unrelated refactors.
- Required PR checks pass, review findings are resolved, and the authorized squash merge completes.
