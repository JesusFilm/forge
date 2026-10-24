---
id: "feat-174"
title: "Watch search page size"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
duration: 1
depends_on:
  - "feat-172"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
---

## Problem

The Watch floating search overlay already uses web's keyword-first search mode, but it requests `limit: 20`. Admin and web-shaped search calls align at `limit: 10`, so the Watch overlay needs a 10-result initial request and 10-result load-more pages.

## What To Build

- [x] Add a named page-size constant near the Watch search provider code.
- [x] Change initial Watch overlay searches to call `runSearch` with `limit: 10` and `offset: 0`.
- [x] Change Load more to call `runSearch` with `limit: 10` and `offset` equal to the current result count.
- [x] Preserve `mode: "keyword-first"` in `apps/web/src/lib/search.ts`.
- [x] Add focused tests for initial request shape, load-more request shape, and append behavior.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - Watch overlay search state and `runSearch` calls.
2. `apps/web/src/components/SearchOverlay.tsx` - Load more button surface.
3. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - jsdom coverage for provider and overlay behavior.
4. `apps/web/src/lib/search.ts` - shared web search boundary that already sends keyword-first mode.

## Grep These

- `runSearch` - provider and shared search action call sites.
- `limit:` - search page-size arguments to verify the Watch overlay changed without touching other search surfaces.
- `SEARCH_PAGE_SIZE` - named page-size constant for the Watch overlay.
- `loadMore` - pagination path that must use the current result count as the next offset.

## Constraints

- Do not change Admin search ranking or schema behavior.
- Do not change demo/canary search pages.
- Do not change auth, Railway, or infrastructure files.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`

## Plan

Implementation plan:
`docs/plans/2026-06-10-002-fix-watch-search-page-size-plan.md`
