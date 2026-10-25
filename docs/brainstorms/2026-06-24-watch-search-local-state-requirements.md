---
date: 2026-06-24
topic: watch-search-local-state
---

# Watch Search Local State

## Summary

Watch search should behave like a local modal workflow: open search, type a query, submit it, and see results without the browser URL becoming part of the search state. This brief supersedes the older `?q=` search behavior in prior search-modal brainstorms.

---

## Problem Frame

The existing URL query contract made every search query shareable and reloadable, but it also made the App Router part of a modal interaction that should be fast and local. Recent production failures showed that visible `?q=` updates could happen while the real search action never ran, leaving users with skeleton cards and no Load more path.

The simpler product behavior is enough for the Watch surface: users can type what they want, press Enter, clear or backspace, submit another query, and continue using pagination from the current result set.

---

## Key Decisions

- **Search input is local UI state.** The modal owns the active query, results, loading state, and pagination state.
- **Browser query params are not a search source.** Visiting with `?q=` must not auto-open the modal or auto-run a search.
- **Search does not write `?q=`.** Typed, pasted, category-clicked, cleared, and edited searches must leave the browser URL unchanged.
- **Legacy search links become inert.** Old query-bearing links should land on the normal Watch surface without preserving or executing the query.

---

## Requirements

**User Interaction**

- R1. A viewer can open the Watch search modal, type a query, press Enter, and receive results without the page URL changing.
- R2. A viewer can clear, backspace, or replace the query, submit again, and receive the new result set without reloading or navigating.
- R3. Category clicks still populate the search input and run the category search without changing the URL.
- R4. Load more continues to paginate from the current in-memory search query, language selection, result source, and offset.
- R5. Empty, loading, skeleton, error, no-results, and stale-request behavior remain tied to the current modal request lifecycle.

**Routing and Compatibility**

- R6. The modal must ignore `q` in the current URL on initial page load.
- R7. Opening or closing the modal must not add, remove, or rewrite `q` in the URL.
- R8. Deprecated `/search?q=...` links should route to the normal Watch entry point without running or preserving the query.
- R9. Existing non-search URL parameters must not be modified by search interactions.

**Search Semantics**

- R10. The current language selection and route-derived audio language continue to influence search exactly as they do outside URL query sync.
- R11. Search result links continue to use valid Watch route builders and public audio language slugs.
- R12. Removing URL query behavior must not remove the modal as the canonical Watch search surface.

---

## Acceptance Examples

- AE1. **Typed search**
  - **Given:** A viewer is on `/watch`.
  - **When:** They open search, type `jesus`, and press Enter.
  - **Then:** Results render and the URL remains `/watch`.
  - **Covers:** R1, R5

- AE2. **Edit and resubmit**
  - **Given:** Results for `jesus` are visible.
  - **When:** The viewer replaces the input with `bible` and presses Enter.
  - **Then:** The modal renders `bible` results, clears stale `jesus` loading state, and does not navigate.
  - **Covers:** R2, R5

- AE3. **Legacy query link**
  - **Given:** A viewer opens `/watch?q=jesus`.
  - **When:** The page loads.
  - **Then:** The modal does not auto-open and no search runs from `q`.
  - **Covers:** R6, R8

- AE4. **Load more**
  - **Given:** A submitted query has more results.
  - **When:** The viewer clicks Load more.
  - **Then:** More results append for the active modal query without consulting the URL.
  - **Covers:** R4

---

## Scope Boundaries

- No shareable search URLs in this version.
- No search-history, recent-searches, or saved-search replacement for the removed URL behavior.
- No new search route or full-page search destination.
- No changes to search ranking, Algolia-vs-semantic source selection, or language-filter product behavior.

---

## Sources / Research

- Prior URL-sync contract: `docs/brainstorms/2026-04-20-web-floating-search-redesign-requirements.md`
- Later modal/search-source requirements: `docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md`
- Production failure learning: `docs/solutions/ui-bugs/watch-search-url-hydration-perpetual-loading.md`
- Current modal controller: `apps/web/src/components/FloatingSearchController.tsx`
- Current overlay tests: `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
