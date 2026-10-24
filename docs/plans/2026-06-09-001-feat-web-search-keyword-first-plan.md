---
title: "Web Search Keyword-First Opt-In Plan"
type: "feat"
status: "completed"
date: "2026-06-09"
---

# Web Search Keyword-First Opt-In Plan

## Summary

Opt the web search data boundary into Admin's existing `mode="keyword-first"` search pipeline so the floating web search bar and shared paginated search results use the title-weighted lexical stack while preserving the current UI and degraded `searchMode` response handling.

## Problem Frame

Admin already exposes keyword-first as an opt-in request mode, but `apps/web` omits the `mode` argument and therefore receives the default hybrid pipeline. The user wants the web search bar to use keyword-first by changing the query parameters in the Admin GraphQL call, not by adding a new UI mode selector or altering search result rendering.

## Requirements

- R1. Web search requests pass `mode: "keyword-first"` to Admin's public `Query.search` resolver.
- R2. Existing web callers keep their current API shape so `FloatingSearchProvider`, demo search, and load-more flows do not need per-call changes.
- R3. The response `searchMode` degradation signal remains normalized and returned unchanged.
- R4. The change is covered by a focused test that proves the GraphQL operation declares and sends `mode`.

## Key Technical Decisions

- **Centralize the opt-in in `apps/web/src/lib/search.ts`:** All current web search paths call `searchVideos` directly or via `runSearch`, so a default `mode` at this boundary changes the floating search bar without duplicating arguments across client components.
- **Keep `mode` as a fixed internal constant:** The request is a product cutover for the web app, not a user-selectable setting. A constant avoids widening server action input shapes before a caller needs override behavior.
- **Assert the GraphQL contract, not ranking:** Web cannot cheaply verify Admin's ranking behavior in unit tests. The app-side responsibility is to send the correct nullable `mode` argument and preserve existing response mapping.

## Implementation Units

### U1. Add the roadmap ticket

- **Goal:** Track the web consumer opt-in separately from the completed Admin keyword-first implementation.
- **Files:** `docs/roadmap/content-discovery/feat-172-web-search-keyword-first-opt-in.md`, `docs/roadmap/README.md`
- **Test Scenarios:** Documentation-only; verify the ticket references `feat-109`, marks current work in progress during implementation, and is completed when validation passes.

### U2. Opt web search into keyword-first

- **Goal:** Add `$mode: String` to the web Admin GraphQL operation and pass `mode: "keyword-first"` in `searchVideos`.
- **Files:** `apps/web/src/lib/search.ts`
- **Patterns:** Follow the existing `type` argument plumbing in `SEARCH_QUERY` and the variable object inside `searchVideos`.
- **Test Scenarios:** `searchVideos("jesus")` calls the Admin client with `variables.mode === "keyword-first"` while preserving `q`, `locale`, `limit`, `offset`, and optional content `type`.

### U3. Add a query contract test

- **Goal:** Guard against accidentally dropping the `mode` variable or reverting to Admin's default hybrid pipeline.
- **Files:** `apps/web/src/lib/search.test.ts`
- **Patterns:** Follow query-printing assertions from `apps/web/src/lib/fragments/__tests__/watch-video.test.ts` and mock the Admin client at the module boundary.
- **Test Scenarios:** The printed operation declares `$mode: String` and calls `search(... mode: $mode ...)`; the Admin client receives `mode: "keyword-first"` for normal and content-type-filtered searches.

## Risks & Dependencies

- Admin must already have `Query.search.mode` in the deployed schema before this web branch ships. The field is present in `apps/admin/schema.graphql` and documented by `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`.
- Keyword-first still uses embeddings when available. If embeddings are unavailable, Admin will continue to return `searchMode: "keyword-only"` and the web normalization path should remain unchanged.

## Sources

- `apps/web/src/lib/search.ts`
- `apps/web/src/lib/search-actions.ts`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/admin/schema.graphql`
- `docs/roadmap/content-discovery/feat-109-search-keyword-first-mode.md`
- `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`
