---
title: "Localized Watch Topic Query - Plan"
type: "fix"
date: "2026-08-14"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Localized Watch Topic Query - Plan

## Goal Capsule

- **Objective:** Make a Watch browse-topic click submit the localized label the viewer selected while preserving the category's stable English `searchTerm` as structural identity.
- **Authority:** GitHub issue #1897 and `docs/roadmap/content-discovery/feat-363-watch-localized-topic-search-query.md` define the accepted F6 behavior and boundaries.
- **Execution profile:** Apply one frontend event-path correction with colocated Arabic, English, Russian, and Simplified Chinese regression coverage.
- **Stop condition:** Stop and report if the visible localized title cannot flow through the existing search submission path without changing backend search, routing, the language picker, or category identity.
- **Tail ownership:** Complete scoped verification, code review, durable-learning assessment, and roadmap closure. Leave the work uncommitted for user review.

## Product Contract

### Summary

The Watch topic grid will submit each card's localized visible title through the existing explicit-search path. Stable category terms continue to identify card structure, icons, and tests.

### Problem Frame

The Watch search overlay localizes topic labels but submits the adjacent English `searchTerm`. Chinese viewers therefore click `圣经故事`, see `bible stories` inserted into the field, and search with text different from the label they selected.

### Key Decisions

- **F6-only scope.** (session-settled: user-directed — chosen over bundling other Chinese-perspective findings: the accepted task is only GitHub issue #1897.) Governs R1-R4.

### Requirements

- R1. A browse-topic card click must submit the card's localized visible title through the existing Watch search path.
- R2. `cat.searchTerm` must remain the React key, icon lookup key, and `data-testid` identity.
- R3. Regression coverage must prove that Arabic, English, Russian, and Simplified Chinese labels become both the controlled input value and the outbound search query after the stable Bible Stories card is clicked.
- R4. The fix must not change backend search, query-language resolution, routes, the language picker, category catalogs, generated GraphQL outputs, or other feedback items.

### Scope Boundaries

- Keep product-code changes inside the Watch overlay's category click seam, its category-identity comment, and the colocated interaction test. The plan, roadmap status and index, and any justified durable learning remain required execution artifacts.
- Do not add per-locale query maps or duplicate translated topic text in TypeScript.
- Do not attempt to improve Chinese retrieval, ranking, language detection, or playback-language selection.
- Do not alter request count, dependencies, route behavior, hydration, initial rendering, or page-load work.

### Acceptance Examples

- AE1. Given the UI locale is Chinese and the stable Bible Stories card is visible as `圣经故事`, when the viewer clicks it, then the input and `searchWatchDirect` query are `圣经故事`, while the card keeps `search-overlay-category-bible-stories`.
- AE2. Given the UI locale is English and the stable Bible Stories card is visible as `Bible Stories`, when the viewer clicks it, then the input and `searchWatchDirect` query are `Bible Stories`, while the card keeps `search-overlay-category-bible-stories`.
- AE3. Given the UI locale is Arabic or Russian, when the viewer clicks the stable Bible Stories card, then the input and `searchWatchDirect` query use the matching Arabic or Russian label while the structural card identity remains unchanged.

## Planning Contract

### Key Technical Decisions

- KTD1. **Pass the already-resolved card title into the shared search function.** The render loop already derives the locale-aware title next to the click handler, and the controller's `search()` function already owns controlled-input updates, normalization, and request submission. This avoids new locale data or a second submission path. Covers R1-R4.
- KTD2. **Preserve `searchTerm` as structural identity only.** Update the stale category comment so future changes do not restore its former double duty as query text. Covers R2.
- KTD3. **Hand off an isolated, uncommitted diff.** (session-settled: user-approved — chosen over direct editing of the main checkout and auto-shipping: the user requested the full isolated Compound Engineering sequence and review before landing.)

### Implementation Constraints

- Follow the existing locale switch pattern in `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` by using `setRequestLocale` before rendering.
- Assert the actual `searchWatchDirect` mock call rather than only the rendered card label; the existing label-only behavior does not detect this bug.
- Keep `apps/web/src/lib/search-categories.ts` runtime data unchanged. Only its role documentation may change.
- Preserve generated GraphQL files unchanged.

### Research Grounding

- `apps/web/src/components/SearchOverlay.tsx` computes `title` from `CATEGORY_TITLE_KEYS[cat.searchTerm]` and currently sends `cat.searchTerm` to `handleCategoryClick`.
- `apps/web/src/components/FloatingSearchController.tsx` shows that `search()` writes the supplied value into the controlled input and sends its normalized form to `searchWatchDirect`.
- `apps/web/src/lib/watch-search-query.ts` normalizes only Unicode form, surrounding whitespace, and the 200-code-point limit, so Chinese script and English capitalization remain unchanged at the request boundary.
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` already uses `setRequestLocale` for locale-specific interaction coverage and mocks `searchWatchDirect` at the submission boundary.
- A production control check confirmed that manually entering `圣经故事` returns Watch results. The failed card flow is therefore isolated to the text submitted by the topic-card click, not Chinese retrieval support itself.
- `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md` identifies deliberate card or suggestion activation as an explicit submission and recommends testing that shared boundary.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` requires load-impact evidence proportionate to the changed risk surface. This event-argument-only change warrants a scoped diff audit proving no render, hydration, request, dependency, or resource-loading change.

## Implementation Units

### U1. Submit and test localized topic titles

- **Goal:** Route the localized card title through the existing category submission path and pin representative behavior across Arabic, English, Russian, and Simplified Chinese.
- **Requirements:** R1-R4; covers AE1-AE3 and KTD1-KTD3.
- **Dependencies:** None.
- **Files:** `apps/web/src/components/SearchOverlay.tsx`, `apps/web/src/lib/search-categories.ts`, `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`, `apps/web/vitest.setup.ts`, `docs/roadmap/content-discovery/feat-363-watch-localized-topic-search-query.md`.
- **Approach:**
  1. Treat the category click handler's argument as user-facing query text and pass the already-computed localized title from each card.
  2. Keep every structural use of `cat.searchTerm` unchanged and correct the category-module comment that still describes it as query text.
  3. Add locale-specific interaction coverage at the existing Watch search mock boundary.
  4. Mark the roadmap ticket complete after verification.
- **Execution note:** Start with the Chinese assertion against the outbound query so the current bug is observable before changing the handler.
- **Patterns to follow:** Existing category rendering in `apps/web/src/components/SearchOverlay.tsx`; locale switching and `searchWatchDirect` assertions in `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Test scenarios:**
  1. Covers AE1. Set the UI locale to Chinese, open the overlay, locate the Bible Stories card by its stable English test id, click its `圣经故事` label, and assert that the controlled input and outbound query both contain `圣经故事`, not `bible stories`.
  2. Covers AE2. Use the default English locale, click the same stable Bible Stories card, and assert that the controlled input and outbound query both contain `Bible Stories` while the test id remains unchanged.
  3. Covers AE3. Repeat the request-boundary assertion for Arabic and Russian to prove the fix is locale-general rather than Chinese-specific.
- **Verification:** The focused interaction test passes and fails if the click path is changed back to `cat.searchTerm`. The source diff contains no backend, route, picker, generated-type, dependency, request-count, hydration, or initial-render changes.

## Verification Contract

| Gate                 | Scope                                                                                             | Done signal                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused regression   | `pnpm --filter @forge/web test -- --run src/components/__tests__/FloatingSearchProvider.test.tsx` | Arabic, English, Russian, and Simplified Chinese topic-click cases pass at the outbound query boundary, with one request per click.                                                            |
| Web type safety      | `pnpm --filter @forge/web typecheck`                                                              | TypeScript completes without errors.                                                                                                                                                           |
| Web lint             | `pnpm --filter @forge/web lint`                                                                   | ESLint and UI-locale drift checks pass.                                                                                                                                                        |
| Scoped formatting    | Prettier check for touched Web, plan, and roadmap files                                           | No formatting drift remains.                                                                                                                                                                   |
| Frontend load impact | Review the final diff and request/resource surfaces                                               | No new request, dependency, route, hydration, render branch, timer, observer, dynamic import, or initial-load work exists.                                                                     |
| Browser behavior     | In the Chinese Watch UI, click the `圣经故事` topic card against a reachable search environment   | The field contains `圣经故事` and the search returns results; if the configured endpoint is unavailable, record that environmental block separately from the automated request-boundary proof. |
| Scope audit          | Compare the final diff with R4 and `feat-363`                                                     | Only the F6 frontend seam, tests, plan, roadmap status, and any justified durable learning changed.                                                                                            |

## Definition of Done

- R1-R4 and AE1-AE2 are satisfied by the implementation and focused regression coverage.
- U1 verification and every applicable Verification Contract gate pass.
- `cat.searchTerm` remains the category's key, icon key, and test identity.
- Generated GraphQL outputs, backend search, routes, and language selection remain unchanged.
- The final diff contains no abandoned experiments or unrelated cleanup.
- `docs/roadmap/content-discovery/feat-363-watch-localized-topic-search-query.md` is marked complete after verification.
- The code-review pass has no unresolved blocking findings, and the durable-learning assessment is complete.
- The work remains uncommitted for user review.
