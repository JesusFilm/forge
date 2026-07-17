---
title: Watch Search Web Page Reliability Fix Plan
type: fix
date: 2026-06-15
origin: docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md
---

# Watch Search Web Page Reliability Fix Plan

## Summary

Fix the floating Watch search modal so query URLs and repeated front-end searches reliably reach the real search action and leave loading state. The fix should target the client search controller, preserving the existing modal, URL sync, semantic search, Algolia flag path, language metadata, and result rendering contracts.

---

## Problem Frame

The production page can open at `?q=jesus` with the search modal focused and skeleton cards visible, but never issue the real `runSearch` action. A browser trace of the page showed the first hydrated request only called `getSearchLanguageOptions`; the modal stayed skeletoned with no result links. Later typed searches can recover, proving the search backend and result rendering path are available, but the page-level client state machine can strand an initial or superseded search.

This plan carries forward the modal reliability requirement from the Algolia search modal requirements: typed queries, query URL hydration, loading states, and modal close behavior must continue to work in the modal.

---

## Requirements

- R1. Query URL hydration must issue the real search action for the hydrated query unless a newer user search supersedes it.
- R2. URL synchronization must not dispatch a same-URL navigation when the current `q` parameter already matches the intended query.
- R3. Empty-query reset paths must clear any current loading and skeleton state even when they invalidate an in-flight request.
- R4. Stale request cleanup must not hide the active spinner for a newer request.
- R5. Typed query transitions from one non-empty query to another must continue to update `?q=`, show loading feedback, and render the winning result set.
- R6. The fix must preserve the existing semantic and Algolia search action contracts, including language metadata refresh behavior.

---

## Key Technical Decisions

- KTD1. Guard no-op URL replacement in `FloatingSearchController`: same-URL `router.replace()` during query hydration can trigger an RSC navigation that interrupts the initial search flow before `runSearch` is called. Comparing the current params to the target params keeps real URL sync while avoiding the no-op navigation.
- KTD2. Centralize loading cleanup by request id: the controller already protects active requests with `requestIdRef`; a shared cleanup helper keeps the stale-request guard while making empty-query resets clear the active loading state.
- KTD3. Test the controller behavior, not backend latency: the production trace proves backend search can return and result links can prefetch. The brittle surface is the browser-side state transition, so regression coverage belongs in the floating search provider/controller tests.

---

## Implementation Units

### U1. Query URL Sync Guard

- **Goal:** Prevent query hydration and same-query searches from dispatching `router.replace()` when the browser URL already has the desired `q` state.
- **Files:** `apps/web/src/components/FloatingSearchController.tsx`.
- **Patterns:** Follow the existing `buildSearchUrl` boundary and keep `usePathname()` as the app-relative path source.
- **Test Scenarios:** Direct URL hydration from `?q=jesus` calls `runSearch` with `query: "jesus"` and does not call `router.replace()` for the already-synced URL.
- **Verification:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` passes.

### U2. Loading-State Cleanup Hardening

- **Goal:** Ensure the active request clears `loading` and `showSkeleton` across both normal search completion and empty-query reset completion.
- **Files:** `apps/web/src/components/FloatingSearchController.tsx`.
- **Patterns:** Preserve the existing request-id freshness check so stale responses cannot clear a newer request's spinner.
- **Test Scenarios:** Start a search that remains unresolved, allow skeletons to show, then reset the query; loading and skeleton state are both false after reset.
- **Verification:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` passes.

### U3. Focused Search Provider Regression Coverage

- **Goal:** Extend the existing floating search tests with observable loading state and router mock assertions.
- **Files:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Patterns:** Reuse the current `SearchModeHarness`, mocked server actions, and direct query URL hydration test.
- **Test Scenarios:** Covered by U1 and U2; no new browser automation fixture is required for this plan.
- **Verification:** Focused test run, web typecheck, and diff whitespace check pass.

---

## Acceptance Examples

- AE1. Given the browser opens `/watch?q=jesus`, when the search controller hydrates, then it does not replace the URL with the same URL and proceeds to call the search action for `jesus`.
- AE2. Given the modal is showing skeletons for an unresolved search, when the active search is reset to an empty query, then skeletons disappear and loading is false.
- AE3. Given the viewer searches `bible` and then `jesus`, when the later `jesus` action completes, then the modal renders `jesus` result cards and no stale cleanup hides the active loading state early.

---

## Scope Boundaries

- This plan does not change search ranking, Algolia configuration, LaunchDarkly flag evaluation, Admin GraphQL search behavior, or result card layout.
- This plan does not add a new search destination or route; the existing floating modal remains canonical.
- This plan does not attempt to optimize result-link RSC prefetch latency, which can be slow after results render but is not the cause of the initial skeleton hang.

---

## Risks & Dependencies

- The `URLSearchParams.toString()` comparison treats param order as meaningful. This is acceptable here because the controller builds from the live current params and only mutates `q`, but future URL-sync code should preserve the same pattern.
- Browser-level validation against production remains observational until the patch is deployed. Unit tests cover the controller transitions directly.

---

## Sources / Research

- `docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md`
- `apps/web/src/components/FloatingSearchController.tsx`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `apps/web/src/lib/search-actions.ts`
- `apps/web/src/lib/search-language-actions.ts`
- `apps/web/src/lib/search-url.ts`
