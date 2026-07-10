---
title: "Watch search overlay page size mismatch"
date: "2026-06-10"
category: "logic-errors"
module: "apps/web search"
problem_type: "logic_error"
component: "frontend_stimulus"
symptoms:
  - "Watch floating search overlay initial requests used a 20-result page instead of the 10-result page size needed for Admin/web search alignment."
  - "Watch overlay Load more requests needed to keep the same 10-result page size while deriving offset from the current rendered result count."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/FloatingSearchProvider.tsx"
  - "apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx"
  - "apps/web/src/lib/search.ts"
tags:
  - "web"
  - "watch"
  - "search"
  - "pagination"
  - "page-size"
  - "keyword-first"
  - "floating-search"
---

# Watch search overlay page size mismatch

## Problem

The Watch floating search overlay already used Admin keyword-first mode through the shared web search boundary, but the overlay itself requested `limit: 20`. Admin and web-shaped ranking matched at `limit: 10`, so the Watch overlay needed a smaller initial candidate pool and matching 10-result Load more pages.

## Symptoms

- Searching from the Watch search bar requested 20 results even though the desired first page was 10 keyword-first results.
- Load more used the current result count for `offset`, but still requested another 20 results.
- The mismatch lived in the UI caller, not in Admin ranking or the shared `mode: "keyword-first"` GraphQL boundary.

## What Didn't Work

- **Changing Admin search ranking.** The backend candidate pool was already correct when the caller used the right `limit`, so ranking changes would have moved the fix to the wrong owner.
- **Changing `apps/web/src/lib/search.ts`.** That file owns the shared web Admin search contract, including `WEB_SEARCH_MODE = "keyword-first"`. Moving Watch-specific page size there would make demo/search helper callers inherit a Watch UI choice.
- **Testing only for `offset: 10`.** A test with exactly 10 initial results cannot distinguish `offset: results.length` from a hard-coded page size. The regression test needs a current result count that differs from the page size.

## Solution

Keep the page-size decision local to `FloatingSearchProvider` and use the same constant in both request paths:

```ts
const SEARCH_PAGE_SIZE = 10

await runSearch({
  query: trimmed.slice(0, 200),
  limit: SEARCH_PAGE_SIZE,
  offset: 0,
})

await runSearch({
  query: query.trim().slice(0, 200),
  limit: SEARCH_PAGE_SIZE,
  offset: results.length,
})
```

The focused component test should drive the real overlay flow: open the provider UI, type a debounced query, assert the initial `runSearch` payload, return `hasMore: true`, click Load more, assert the second payload, and verify old plus new result titles both render.

Use an initial result count that is not equal to the page size:

```ts
const initialResults = Array.from({ length: 7 }, (_, index) =>
  makeSearchResult(`initial-${index + 1}`, `Initial Result ${index + 1}`),
)

expect(mockedRunSearch).toHaveBeenNthCalledWith(2, {
  query: "the bible project",
  limit: 10,
  offset: 7,
})
```

That catches regressions to `offset: SEARCH_PAGE_SIZE`, `offset: 10`, or a separate offset counter that drifts from rendered results.

## Why This Works

Search page size affects the request's candidate pool and pagination boundary. Search pipeline mode affects how Admin retrieves and fuses candidates. Keeping those decisions in different layers prevents a Watch-specific page-size fix from changing the shared keyword-first contract.

The provider already owns local search state, stale-response guards, Load more append behavior, and the rendered result count. Using `results.length` preserves the existing offset contract while making the requested page size explicit.

## Prevention

- Put product-specific search page-size constants near the UI provider that owns the request, not in the shared search helper, unless every caller should inherit the same page size.
- When testing Load more offsets, make the existing result count differ from the page size so the assertion proves `offset` follows state.
- Assert both request shape and append behavior: `limit`, `offset`, and rendered original plus appended results.
- Keep `mode` and `searchMode` concepts separate: input `mode` selects the Admin search pipeline; response `searchMode` reports runtime degradation.

## Related Issues

- `docs/solutions/web/web-search-admin-keyword-first-opt-in.md` — shared web keyword-first boundary that this fix deliberately leaves unchanged.
- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` — overlay state, request freshness, and portal patterns.
- `docs/solutions/best-practices/mobile-search-ui-patterns-20260416.md` — client-side pagination, append behavior, and stale guard considerations.
- `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — backend `limit` / `offset` / `hasMore` contract behind Load more.
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md` — adjacent `FloatingSearchProvider` surface ownership.
