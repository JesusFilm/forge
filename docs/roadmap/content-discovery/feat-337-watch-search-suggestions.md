---
id: "feat-337"
title: "Add language-aware Watch search suggestions"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-06"
completed_date: "2026-08-11"
duration: 1
depends_on:
  - "feat-334"
  - "feat-336"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "search"
  - "mobile"
  - "accessibility"
---

## Problem

Explicit Watch search submission prevents incomplete drafts from launching the
full retrieval pipeline, but viewers receive no help completing known Watch
titles. The modal needs inexpensive language-aware title suggestions that do
not restore live result search or introduce popularity/history serving.

## Entry Points - Read These First

1. `docs/plans/2026-08-06-001-feat-watch-search-suggestions-plan.md`
2. `apps/admin/src/services/typesense-watch-search-lexical.ts`
3. `apps/admin/src/graphql/queries/watch-search.ts`
4. `apps/web/src/components/SearchOverlay.tsx`
5. `apps/web/src/components/FloatingSearchField.tsx`
6. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

## Grep These

```bash
rg -n "watchSearchSuggestions|TypesenseWatchSearchSuggestions" apps/admin apps/web packages/admin-graphql
rg -n "suggestionRequestKey|fetchWatchSearchSuggestions|aria-autocomplete" apps/web/src
rg -n "watch_search_lexical|languageIdentity|localeCodes" apps/admin/src/services
```

## What To Build

1. Add a bounded Admin suggestion service that resolves the exact public
   language slug and queries localized `title_*` and `metadata_*` fields in
   `watch_search_lexical`, with title matches ranked ahead of description-only
   matches.
2. Publish an additive public GraphQL query returning at most five structured
   title completions with optional description context and match source,
   without traces, embeddings, hydration, popularity, or history.
3. Add an abortable browser client with a 180 millisecond trailing debounce,
   two-meaningful-character threshold, timeout, and stale-response guard.
4. Render a manual-selection editable combobox in the existing search modal.
   Pointer or active-option Enter fills the draft only; a later Enter/Search
   key or visible search action performs the full search.
5. Keep the existing Search language control and use its exact public slug.
   Support IME composition, keyboard navigation, screen-reader relationships,
   mixed-direction titles, 44-pixel touch rows, and reduced mobile viewports.

## Constraints

- No popular searches, recent searches, search history, personalization,
  query-log serving, or curated fallback.
- No frontend query-language detection and no change to the Search language
  filter.
- No result-card hydration, watchability lookup, transcript lane, embedding
  call, full-search trace, or prefix analytics. Description context may come
  only from the already-indexed lexical metadata lane.
- Keep suggestions optional and fail empty without blocking explicit search.
- Keep the full search controller lazy and the instant shell request-free.

## Verification

- Admin service and resolver tests prove one title-dominant Typesense request,
  fixed server caps, exact slug resolution, stable description context,
  public-resolver registration, and empty fallback when the optional backend
  is unavailable.
- Web tests prove debounce timing, cancellation, stale-response suppression,
  draft-only selection, later explicit submission, close/reset behavior,
  ARIA relationships, IME safety, and mobile viewport placement.
- Schema print, Admin GraphQL generation, affected typechecks, lint, formatting,
  and focused test suites pass.
- Desktop and narrow-mobile browser proof shows the existing language filter,
  quiet one-line description context with restrained match highlighting,
  usable suggestion rows, no full search before explicit submit, and no
  initial page-load request or bundle regression.
