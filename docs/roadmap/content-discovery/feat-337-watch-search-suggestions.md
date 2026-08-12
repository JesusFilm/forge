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
full retrieval pipeline, but title-shaped autocomplete rows feel like search
results rather than useful query suggestions. The modal needs inexpensive,
language-aware query phrases followed by grouped direct content matches without
restoring the full retrieval pipeline or introducing popularity/history serving.

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

1. Add a bounded Admin autocomplete service that resolves the exact public
   language slug and queries localized `title_*` and `metadata_*` fields in
   `watch_search_lexical`. Extract useful word and phrase suggestions from both
   lanes, then hydrate only the bounded direct video matches needed for links.
2. Publish an additive public GraphQL query returning query suggestions first
   and direct content matches second, with enough metadata to group direct
   matches as Titles, Collections, and Scenes.
3. Add an abortable browser client with a 180 millisecond trailing debounce,
   two-meaningful-character threshold, timeout, and stale-response guard.
4. Render a manual-selection editable combobox in the existing search modal.
   Query suggestions fill the draft only; direct content matches navigate to
   the item. A later Enter/Search key or visible search action performs the full
   search for typed query text.
5. Keep the existing Search language control and use its exact public slug.
   Support IME composition, keyboard navigation, screen-reader relationships,
   mixed-direction titles, 44-pixel touch rows, and reduced mobile viewports.
6. Keep the populated autocomplete state in memory across blur/refocus without
   another backend request. Align the panel to the search field, stretch it to
   the remaining visual viewport, and move Search language into the panel as a
   quiet "Searching in" context control.
7. Return up to six extracted query phrases before the existing six direct
   content matches.
8. Render search language as one quiet “Searching in {language}” text action.
   Opening it replaces the full suggestions panel with focused language search;
   dismissing it restores cached suggestions without another request.

## Constraints

- No popular searches, recent searches, search history, personalization,
  query-log serving, or curated fallback.
- No frontend query-language detection and no change to the Search language
  filter.
- No watchability lookup, transcript lane, embedding call, full-search trace,
  or prefix analytics. Direct-match hydration is limited to indexed video IDs
  and link/group metadata; phrase candidates come only from indexed lexical
  title and description text.
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
