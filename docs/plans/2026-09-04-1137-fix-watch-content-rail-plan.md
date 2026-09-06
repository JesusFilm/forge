---
title: "Watch Template Content Rail - Plan"
type: fix
date: "2026-09-04"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Template Content Rail - Plan

## Goal Capsule

- **Objective:** Series, experience hero, language index, language inventory, and History pages align their primary content with the established Watch home and video rail.
- **Means:** Apply the existing public Watch rail token to route-level inner content while preserving full-bleed backgrounds and media (KTD1).
- **Authority:** The user request and `docs/roadmap/platform/feat-453-watch-template-content-rail.md` define the intended layout.
- **Stop conditions:** Stop if the shared rail would constrain full-bleed media, alter the 1920px maximum, or require unrelated route behavior changes.
- **Execution profile:** Code change with focused component tests, Web type validation, formatting, and representative browser smoke coverage.
- **Tail ownership:** Ship through the repository PR workflow after review and CI validation.

## Product Contract

### Summary

Use one content rail across public Watch templates. Keep page backgrounds and hero media full bleed.

### Problem Frame

Watch templates used different maximum widths and duplicated gutter ladders. The series template also left major content regions uncapped, which caused visible alignment drift on wide screens.

### Requirements

- R1. Primary content on the templates changed by this work uses the shared 1920px maximum and responsive Watch gutters.
- R2. Series hero copy, metadata, and episode cards share the same content rail.
- R3. Language index, language inventory, history, and experience hero content use the same content rail.
- R4. Full-bleed backgrounds and media remain outside the padded content rail.
- R5. Focused tests protect the shared token usage on affected templates.

### Scope Boundaries

- The shared maximum width and gutter values do not change.
- Internal demos and preview-only route behavior do not change.
- The malformed logged-out History authentication redirect is deferred because it is unrelated to layout.
- Watch home, video detail, episode detail, What's New, and not-found templates already use the shared rail and are verification baselines rather than modification targets.

## Planning Contract

### Key Technical Decisions

- KTD1. **Use `WATCH_PAGE_CONTENT_CLASSES` as the route-level inner-content contract.** (session-settled: user-directed — chosen over template-local width and gutter classes: one token gives consumers a canonical value and reduces layout drift.) Governs R1, R2, R3, R4.
- KTD2. **Separate full-bleed shells from constrained inner wrappers.** Section backgrounds retain their viewport width while the child content receives KTD1. Governs R4.
- KTD3. **Verify token membership in focused component tests.** These assertions catch future reintroduction of local width classes without coupling tests to the token's current individual values. Governs R5.

### Assumptions

- The current 1920px maximum and `px-5 md:px-16 xl:px-24` gutter ladder remain the canonical public Watch layout.
- Existing carousel bleed behavior remains correct when its surrounding route-level rail is standardized.
- The History authentication redirect defect is recorded as a separate finding and does not block this layout change.
- The narrower language, inventory, and History containers are unintentional alignment drift rather than deliberate reading-measure constraints.
- Existing home, video detail, episode detail, What's New, and not-found wrappers conform to KTD1; verification must promote any non-conforming baseline into implementation scope.

## Implementation Units

### U1. Establish the shared public Watch rail contract

- **Goal:** Make the existing content-width module the documented source for route-level Watch content alignment.
- **Requirements:** R1, R4.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/lib/content-width.ts`
- **Approach:** Clarify the roles of the outer alignment, generic content, and public Watch content tokens without changing the canonical width or gutter values.
- **Patterns to follow:** Preserve the existing composition of `WATCH_PAGE_CONTENT_CLASSES` from `CONTENT_WIDTH_ALIGN_CLASSES` and the Watch gutter token.
- **Test scenarios:** Test expectation: none -- this unit changes token documentation rather than runtime values.
- **Verification:** Consumers can import one named route-level rail while full-bleed alignment remains separately available.

### U2. Standardize series and experience content wrappers

- **Goal:** Align series hero copy, metadata, episode grids, and experience video-hero copy through KTD1 and KTD2.
- **Requirements:** R2, R4, R5.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/components/watch/SeriesPageClient.tsx`
  - `apps/web/src/components/watch/SeriesEpisodesGrid.tsx`
  - `apps/web/src/components/watch/SeriesHero.tsx`
  - `apps/web/src/components/sections/VideoHero.tsx`
  - `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`
  - `apps/web/src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx`
  - `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`
  - `apps/web/src/components/sections/__tests__/VideoHero.test.tsx`
- **Approach:** Keep glass and artwork shells full width. Add inner wrappers for metadata and episode cards, and apply the shared rail to hero overlays.
- **Execution note:** Use focused component assertions and a wide-viewport browser measurement because this work is primarily layout behavior.
- **Patterns to follow:** Mirror the full-bleed shell plus constrained content structure already used by Watch home sections.
- **Test scenarios:**
  - Render a series with metadata and confirm the inner metadata wrapper contains every shared rail class.
  - Render a series episode grid and confirm the card grid contains every shared rail class while the glass wrapper remains full bleed.
  - Render the interactive series hero and confirm its overlay uses the shared rail.
  - Render the static series hero fallback and confirm its copy aligns through the shared rail without constraining hero media.
  - Render the experience VideoHero overlay and confirm it contains every shared rail class while the hero media wrapper remains unpadded.
- **Verification:** At a viewport wider than 1920px, series hero text, metadata, and episode cards resolve to the same 1920px box and desktop padding.

### U3. Standardize language and history route rails

- **Goal:** Remove narrower route-local containers from language discovery, inventory, and history templates.
- **Requirements:** R1, R3, R5.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/app/[locale]/[htmlLang]/history/page.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/history/page.test.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/languages/page.tsx`
  - `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx`
  - `apps/web/src/components/watch/WatchLanguageIndexBrowser.test.tsx`
  - `apps/web/src/components/watch-language-inventory/InventoryFilterShell.tsx`
  - `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
  - `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.test.tsx`
- **Approach:** Apply KTD1 to the route-level content wrappers and remove duplicated horizontal padding from their parents.
- **Execution note:** Validate both focused rendering tests and representative local routes because these templates have different data and authentication states.
- **Patterns to follow:** Use one shared token on the first inner content wrapper beneath a full-width route shell.
- **Test scenarios:**
  - Render the language directory and confirm its browser container contains every shared rail class while its parent has no horizontal padding or maximum-width classes.
  - Render populated and empty language inventory states and confirm their principal content regions use the shared rail.
  - Render inventory filters and confirm the filter body aligns with the page content rail while its parent has no competing horizontal padding or maximum-width classes.
  - Render History with a mocked authenticated session and confirm its primary content wrapper contains every shared rail class.
- **Verification:** Representative local routes render successfully and their primary content aligns with the same shared rail used by series pages.

## Verification Contract

- Run the focused Vitest suites for series layout, language directory, and language inventory components.
- Run `pnpm --filter @forge/web typecheck`.
- Run targeted ESLint and Prettier checks on the changed Web files.
- Run `git diff --check`.
- Audit home, video detail, episode detail, What's New, and not-found wrappers before implementation; any baseline that does not use the shared rail enters the relevant implementation unit.
- Smoke representative local home, video, series, episode, language, inventory, What's New, and not-found routes. Smoke History only with a logged-in session; its malformed logged-out redirect is a known non-blocking limitation.
- At 375px, 768px, and a viewport wider than 1920px, measure representative series, experience hero, language index, language inventory, and authenticated History wrappers. Confirm the expected responsive padding, no doubled gutters, no horizontal overflow, and aligned content edges.
- At a viewport wider than 1920px, confirm each representative inner wrapper resolves to a 1920px outer box with 96px desktop padding while its full-bleed shell remains viewport width.
- At the same wide viewport, confirm a Watch home carousel still bleeds to the viewport edge while its first card aligns with the shared content edge.
- Review the diff for page-loading performance risk: changed Web files must introduce no hooks, effects, data fetches, client-component boundaries, or new `use client` directives.

## Definition of Done

- R1 through R5 are satisfied.
- U1 through U3 meet their verification outcomes.
- Focused tests, type checking, linting, formatting, and diff checks pass.
- Browser smoke confirms representative templates render and the responsive geometry matches the shared rail. Authenticated History is required only when a logged-in session is available; its logged-out redirect remains a recorded non-blocking limitation.
- Full-bleed media remains unconstrained.
- No unrelated History authentication fix or abandoned experimental code remains in the diff.
