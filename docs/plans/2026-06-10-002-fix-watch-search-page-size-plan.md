---
title: "Watch Search Page Size Plan"
type: "fix"
status: "completed"
date: "2026-06-10"
---

# Watch Search Page Size Plan

## Summary

Change the Watch floating search overlay to fetch results in pages of 10 while preserving the shared web keyword-first search mode. The work is limited to the overlay/provider request sizing and focused tests; Admin ranking, canary/demo search, and infrastructure stay unchanged.

## Problem Frame

Web search already opts into Admin's `keyword-first` pipeline at `apps/web/src/lib/search.ts`, but the Watch overlay asks for `limit: 20`. Admin and web-shaped calls match ranking behavior when the page size is `10`, so the Watch overlay needs to request the same initial candidate pool and paginate by 10 on load more.

## Requirements

- R1. The Watch search overlay initial request calls `runSearch` with `limit: 10` and `offset: 0`.
- R2. The Watch overlay Load more path calls `runSearch` with `limit: 10` and `offset` equal to the current result count.
- R3. Load more appends newly fetched results to existing results.
- R4. The shared keyword-first mode in `apps/web/src/lib/search.ts` remains unchanged.
- R5. Admin search ranking, demo/canary search pages, and Railway or auth infrastructure are not changed.
- R6. Focused tests prove the initial request, paginated request, and append behavior.

## Key Technical Decisions

- **Keep page size local to the overlay provider:** `FloatingSearchProvider` owns the Watch overlay request calls, so a named `SEARCH_PAGE_SIZE = 10` constant near that provider is the smallest clear change.
- **Continue deriving pagination offset from rendered result state:** The current `results.length` offset matches the user's visible result count and avoids adding separate offset state.
- **Do not change the shared search data boundary:** `apps/web/src/lib/search.ts` already sends `mode: "keyword-first"` for all web callers. This task changes caller page size, not the Admin GraphQL operation or server action shape.
- **Leave `components/search/SearchResults.tsx` alone:** The only current import is the `/demo-search` surface, which disables visible load more with `showLoadMore={false}` and is outside the Watch search bar acceptance criteria.

## Scope Boundaries

- In scope: `apps/web/src/components/FloatingSearchProvider.tsx` and its component test.
- Out of scope: Admin resolver ranking, Admin GraphQL schema, canary/demo pages, auth, Railway configuration, and generated GraphQL artifacts.

## Implementation Units

### U1. Track the follow-up ticket

- **Goal:** Capture the page-size follow-up against the content-discovery search work.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** None
- **Files:** `docs/roadmap/content-discovery/feat-174-watch-search-page-size.md`, `docs/roadmap/README.md`
- **Approach:** Add a focused roadmap ticket in the content-discovery lane, marked in progress during implementation and completed once validation passes.
- **Patterns to follow:** `docs/roadmap/content-discovery/feat-172-web-search-keyword-first-opt-in.md`
- **Test scenarios:** Test expectation: none -- roadmap documentation only.
- **Verification:** The roadmap ticket names the provider, tests, constraints, and plan path.

### U2. Apply the Watch overlay page size

- **Goal:** Use a named page-size constant for both initial search and load more calls.
- **Requirements:** R1, R2, R4, R5
- **Dependencies:** U1
- **Files:** `apps/web/src/components/FloatingSearchProvider.tsx`
- **Approach:** Define `SEARCH_PAGE_SIZE = 10` near the provider constants and replace both hard-coded `limit: 20` values in `search` and `loadMore`. Keep `offset: 0` for initial searches and `offset: results.length` for load more.
- **Patterns to follow:** Existing `runSearch` calls in `FloatingSearchProvider` and the fixed `WEB_SEARCH_MODE` boundary in `apps/web/src/lib/search.ts`.
- **Test scenarios:** Initial Watch overlay search for a non-empty query calls `runSearch` with the trimmed query, `limit: 10`, and `offset: 0`; load more calls `runSearch` with the same query, `limit: 10`, and `offset` equal to the current result count.
- **Verification:** Provider code has one named page-size constant and no remaining `limit: 20` in the Watch overlay request path.

### U3. Prove pagination and append behavior

- **Goal:** Add regression coverage for the request shape and state behavior.
- **Requirements:** R1, R2, R3, R6
- **Dependencies:** U2
- **Files:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:** Mock `runSearch`, render the provider and overlay, trigger a search through the visible input, then click Load more after the first response. Assert the first and second `runSearch` calls and verify the DOM contains both original and appended results.
- **Patterns to follow:** Existing jsdom `FloatingSearchProvider` tests and `SearchOverlay` load-more button behavior.
- **Test scenarios:** A query such as `the bible project` sends `limit: 10, offset: 0`; with 10 existing results and `hasMore: true`, Load more sends `limit: 10, offset: 10`; after the second response, original and appended titles are both rendered.
- **Verification:** The focused component test passes alongside the relevant web typecheck.

## Sources

- `apps/web/AGENTS.md`
- `apps/web/CLAUDE.md`
- `CONCEPTS.md`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `apps/web/src/lib/search.ts`
- `docs/roadmap/content-discovery/feat-172-web-search-keyword-first-opt-in.md`
- `docs/solutions/web/web-search-admin-keyword-first-opt-in.md`
