---
title: "Watch Series Footer Parity - Plan"
type: fix
date: 2026-08-26
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Series Footer Parity - Plan

## Goal Capsule

- **Objective:** Viewers can reach the standard ministry navigation, giving, contact, legal, and AI-attribution content from every playable Watch series or collection landing page.
- **Means:** Append the existing shared Watch footer to the resolved two-segment series route after the series surface (KTD1, KTD2).
- **Authority:** The Product Contract defines route behavior. The Planning Contract defines composition. Existing package and repository instructions govern implementation details.
- **Stop conditions:** Stop if the route can no longer distinguish series/collection landings from authored experiences, or if adding the footer requires moving it into the client bundle.
- **Execution profile:** Small server-composition fix with focused route regression coverage and production-shaped page verification.
- **Tail ownership:** The implementation run owns roadmap completion, validation, cleanup, and PR readiness.

## Product Contract

### Summary

Add the shared Watch footer to all resolved two-segment series and collection landing pages without changing the footer itself or other Watch route families.

### Problem Frame

Production still renders `hope-collection`, `reflections-of-hope`, and `storyclubs` landing pages through `SeriesPageClient` with no footer element. Individual video and episode routes already render the shared footer, so collection viewers lose standard navigation and attribution content at the end of the listing page.

### Key Decisions

- **Series and collection landing pages receive footer parity** (session-settled: user-directed — chosen over preserving the historical series exclusion: production verification confirmed the exclusion still creates an incomplete terminal page). Governs R1, R2, R3, R4.

### Requirements

- R1. Every resolved two-segment route whose route model kind is `series` renders one shared Watch footer after the series page surface.
- R2. Both collection-labeled and series-labeled records receive the same footer behavior.
- R3. The footer remains server-composed and does not enter the `SeriesPageClient` client bundle.
- R4. The existing shared footer content, locale behavior, styling, stacking contract, and attribution notice remain unchanged.
- R5. Video, contextual episode, Watch home, authored experience, inventory, history, embed, and not-found route behavior remains unchanged.
- R6. Route regression coverage proves footer presence, uniqueness, and ordering for both supported series labels.

### Acceptance Examples

- AE1. Covers R1, R2, R6. Given a collection-labeled route model, when the two-segment Watch route renders, then `SeriesPageClient` is followed by exactly one `watch-home-footer` element.
- AE2. Covers R1, R2, R6. Given a series-labeled route model, when the same branch renders, then it has the same footer placement as a collection-labeled record.
- AE3. Covers R3, R4, R5. Given an existing video or contextual episode route, when it renders after this change, then its existing single shared footer remains present and no duplicate is introduced.

### Scope Boundaries

- Keep the change inside the catch-all Watch route's resolved series branch and its route tests.
- Reuse `WatchHomeFooter` without modifying its copy, links, layout, translations, or layering.
- Do not add the footer to one-segment, authored-experience fallback, inventory, history, embed, or not-found surfaces.
- Do not refactor `SeriesPageClient` or move server composition into client code.

## Planning Contract

### Key Technical Decisions

- KTD1. **Compose after the series client.** Append `WatchHomeFooter` as the final server-rendered sibling in the `routeModel.kind === "series"` return so the footer follows all series content and structured data remains non-visual.
- KTD2. **Reuse the shared terminal surface.** Use `apps/web/src/components/home/WatchHomeFooter.tsx` unchanged so series pages inherit the same localization, navigation, attribution, and stacking behavior as other Watch pages.
- KTD3. **Reverse the explicit route regression.** Replace the historical series-footer absence assertion with presence, uniqueness, and ordering assertions for collection and series labels.

### Assumptions

- The `routeModel.kind === "series"` branch remains the canonical composition point for both collection-labeled and series-labeled two-segment pages.
- Existing `WatchHomeFooter` component tests remain the source of truth for footer content and visual layer contracts; route tests only prove composition.
- The shared footer adds server-rendered markup and the existing lazy footer-logo image request, but no new client JavaScript, hydration work, above-the-fold media, or eager loading.

### Sequencing

Create and start the roadmap ticket before production code changes. Add a failing route regression, update server composition, run focused and package-level checks, verify the rendered HTML and loading posture, then mark the ticket complete.

## Implementation Units

### U1. Track and add series footer composition

- **Goal:** Add the shared footer to the resolved series/collection route and pin the behavior in route tests.
- **Requirements:** R1, R2, R3, R4, R5, R6; AE1, AE2, AE3; KTD1, KTD2, KTD3.
- **Dependencies:** None.
- **Files:**
  - `docs/roadmap/platform/feat-424-watch-series-footer-parity.md`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- **Approach:**
  1. Create the required roadmap ticket with `status: "in-progress"` and exact implementation and verification entry points.
  2. Change the existing collection-labeled regression from footer absence to a single footer after the mocked series surface.
  3. Add equivalent coverage for the defensive series label.
  4. Append the existing shared footer to the series branch after `SeriesPageClient`.
- **Execution note:** Start by reversing the existing absence assertion so the behavior change is test-led.
- **Patterns to follow:** The video and contextual episode returns in the same route already compose `WatchHomeFooter` after `WatchPageClient`. Preserve the footer's layer contract documented in `docs/solutions/ui-bugs/watch-footer-sticky-player-layering.md`.
- **Test scenarios:**
  - Covers AE1. Resolve a collection-labeled two-segment record and assert one series surface followed by one shared footer.
  - Covers AE2. Resolve a series-labeled two-segment record and assert the same footer count and ordering.
  - Covers AE3. Run the existing video and contextual episode route cases and confirm each still renders exactly one footer.
  - Render a series route with unavailable language identity and confirm the not-found path exits before any footer is composed.
- **Verification:** Focused route tests pass, the series branch remains server-rendered, and the diff contains no footer-component or client-boundary changes.

### U2. Validate the production-shaped page and close tracking

- **Goal:** Prove the change is safe for routing, formatting, type correctness, localization reuse, and page loading before completing the roadmap item.
- **Requirements:** R3, R4, R5, R6.
- **Dependencies:** U1.
- **Files:**
  - `docs/roadmap/platform/feat-397-watch-series-footer-parity.md`
- **Approach:** Run focused tests first, then package lint and type checking. Inspect server-rendered output for one series surface followed by one footer. Compare client-side initialization and media-loading signals with the unchanged baseline, accounting for the expected lazy footer-logo asset. Mark the roadmap ticket complete only after all required evidence passes.
- **Patterns to follow:** Use the repository's frontend performance verification requirement and the existing Watch route smoke conventions.
- **Test scenarios:** Test expectation: none -- this unit validates U1 and updates tracking without introducing behavior.
- **Verification:** All Verification Contract checks pass, the roadmap ticket is complete, and no abandoned or unrelated changes remain.

## Verification Contract

| Check                    | Command or evidence                                                                                                                                                                                                                    | Proves                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Focused route regression | `pnpm --filter @forge/web test -- 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`                                                                                                                             | Collection, series, video, episode, and not-found route composition                                                    |
| Footer contract          | `pnpm --filter @forge/web test -- src/components/home/__tests__/WatchHomeFooter.test.tsx`                                                                                                                                              | Shared footer locale, content, attribution, and stacking behavior remains intact                                       |
| Type safety              | `pnpm --filter @forge/web typecheck`                                                                                                                                                                                                   | Server composition and test changes satisfy TypeScript contracts                                                       |
| Lint                     | `pnpm --filter @forge/web lint`                                                                                                                                                                                                        | Package conventions and generated locale checks pass                                                                   |
| Format                   | `pnpm exec prettier --check 'apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx' 'apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' 'docs/roadmap/platform/feat-424-watch-series-footer-parity.md'` | Touched files conform to repository formatting                                                                         |
| Rendered behavior        | Local production-shaped browser or server HTML smoke on a series route                                                                                                                                                                 | Exactly one footer follows the series surface and localized content renders                                            |
| Loading posture          | Compare client scripts, hydration warnings, above-the-fold media, eager loading, and footer-owned requests before and after the route-only change                                                                                      | No new client JavaScript or eager above-the-fold media is introduced; only the known lazy footer-logo request is added |

## Definition of Done

- U1 is complete when both collection and series labels render exactly one shared footer after `SeriesPageClient`, and unchanged route families retain their existing behavior.
- U2 is complete when all applicable verification checks pass and the roadmap ticket is marked `complete`.
- The final diff contains only the plan, roadmap ticket, series route composition, and focused regression coverage.
- No generated GraphQL artifacts, footer content, translations, client boundaries, or unrelated files change.
- Dead-end experiments and abandoned code are removed before commit.
