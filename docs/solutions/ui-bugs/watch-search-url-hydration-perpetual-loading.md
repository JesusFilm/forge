---
title: "Watch search URL sync can strand the overlay in loading"
date: "2026-06-15"
last_updated: "2026-06-24"
category: "ui-bugs"
module: "apps/web watch search"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Opening `/watch?q=jesus` can show the search overlay and skeleton cards indefinitely."
  - "Editing a successful search into a second query can leave the URL behind the input and keep skeleton cards visible."
  - "Clicking Load more can leave the visible result set unchanged when delayed language metadata refreshes after the first search."
  - "Production `/watch` server-action POSTs can return 200 while the UI never renders result cards."
  - "The browser can post language metadata for the partial query without ever posting the final `runSearch` payload."
root_cause: "async_timing"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/web/src/components/FloatingSearchController.tsx"
  - "apps/web/src/components/FloatingSearchProvider.tsx"
  - "apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx"
  - "apps/web/src/lib/routes.ts"
  - "apps/web/src/proxy.ts"
tags:
  - "web"
  - "watch"
  - "search"
  - "url-sync"
  - "local-state"
  - "app-router"
  - "router-replace"
  - "loading-state"
---

# Watch search URL sync can strand the overlay in loading

## Superseded Current Contract

As of 2026-06-24, Watch search no longer treats `?q=` as modal state. The modal owns search query, results, loading, and pagination in memory; page-load `q` params are ignored; typed, edited, cleared, and category searches leave the browser URL unchanged; deprecated `/search?q=...` redirects to the root Watch surface with `q` stripped.

This document remains as the production incident record. Do not reintroduce `buildSearchUrl`, `router.replace`, or `history.replaceState` for Watch modal query syncing; use `docs/brainstorms/2026-06-24-watch-search-local-state-requirements.md` as the current product contract.

## Problem

The Watch search page could open directly at a query URL, such as `/watch?q=jesus`, display the modal with skeleton result cards, and never show results. A second production path showed the same class of failure after a successful search: search `jesus`, edit the active input to `the bible proj`, pause past debounce, then type `ect`. The input showed `the bible project`, the URL stayed at `?q=the+bible+proj`, skeleton cards remained, and no final results rendered.

The backend was not simply timing out. Browser-level production tracing showed page-level client flow could post language metadata and return HTTP 200 while failing to reach the real `runSearch` action for the user-visible final query.

## Symptoms

- The page showed the search overlay, focused input, and pulsing skeleton cards for many minutes.
- Server-action POSTs returned HTTP 200, but the initial direct URL path only called `getSearchLanguageOptions`.
- Typing a new query in the overlay later issued `runSearch` and rendered result cards.
- After a successful first search, an intermediate edited query could update the URL and start skeletons while the final input value never reached `runSearch`.
- Clearing or superseding a pending search could leave `loading` and `showSkeleton` latched if the stale request was invalidated before its cleanup ran.

## What Didn't Work

- **Endpoint-only probing.** Calling isolated server actions showed they could return successfully, but it missed the App Router and client state transition that stranded the web page.
- **Waiting longer.** The observed failure could sit for 10 minutes because the UI was stuck in client state, not waiting for a normal request timeout.
- **Blaming search ranking or Algolia fallback.** Later typed searches returned results, so ranking and backend result rendering were not the primary blocker.
- **Checking only HTTP status.** The relevant question was not whether a server-action POST returned 200, but whether the page-level hydration flow reached `runSearch` and cleared the active skeleton state.
- **Testing only direct `?q=` hydration.** That proved the first URL-open path, but missed the post-success edit path where a changed-query navigation could remount the overlay and clear a newer debounce timer.

## Historical Fix (Superseded)

The first repair kept URL synchronization but moved modal-owned query updates from App Router navigation to native browser history, then tightened request-id-scoped loading cleanup. That reduced App Router remount risk while preserving the shareable `?q=` contract.

The current repair removes the URL-sync contract entirely for Watch search. The durable prevention rule is now simpler: page-level search bugs must be reproduced through the modal, and the modal must not depend on browser query params for active query, loading, results, or pagination state.

## Follow-up: Load More Signature Drift

Production smoke after the local-state merge showed typed search requests were firing with a clean URL, but the `Load more` button could still no-op. The controller had a defensive guard that compared the visible search signature against the mutable current language UI state before paging. When language metadata arrived after the first search and refreshed the default language selection, that guard treated the visible result set as stale and returned before calling `runSearch`.

The follow-up fix keeps the query, route-language, and result-source guards, but stops comparing pagination against mutable post-search language UI defaults. Load More now pages from the active signature that produced the visible results. The regression test delays `getSearchLanguageOptions`, lets the initial search proceed through the fallback path, resolves English metadata afterward, and verifies the next-page request still fires with the original signature offset.

## Verification

- PR [#1349](https://github.com/JesusFilm/forge/pull/1349) removed Watch search URL query sync and merged into `main` as `b5e32cd5` on 2026-06-24.
- PR [#1351](https://github.com/JesusFilm/forge/pull/1351) fixed Load More signature drift and merged into `main` as `4cfcf497` on 2026-06-24.
- CI passed for both changes: `format`, `lint (@forge/web)`, `test (@forge/web)`, and `build (@forge/web)`.
- Production smoke after #1351 passed: direct `?q=` stayed inert, typed `bible` search kept the URL at `/watch`, Load More fired an additional server action, and no page errors were reported.

## Prevention

- Treat Watch modal query, result, loading, and pagination state as local UI state unless the product explicitly reintroduces a shareable-search URL contract.
- Test page-level modal behavior, not only isolated server-action HTTP status; the bug class is whether the client reaches `runSearch` and clears skeleton/loading state.
- For pagination, page from the active result-set signature that produced the visible cards. Do not recompute language identity from mutable selected/default language UI state after results render.
- Include delayed language metadata in regression tests whenever `getSearchLanguageOptions` can resolve after a first search page.

## Related Issues

- [Forge Algolia Search Modal Pattern](../architecture-patterns/forge-algolia-search-modal-20260610.md)
- [Watch search overlay page size mismatch](../logic-errors/watch-search-overlay-page-size-mismatch.md)
- [Watch semantic search language metadata confirmation race](watch-semantic-search-language-metadata-confirmation-race.md)
- [Watch Staged Client Loading](../performance-issues/watch-staged-client-loading-20260611.md)
- [Next.js search overlay UI patterns](../best-practices/nextjs-search-overlay-ui-patterns-20260415.md)
- [Queueing a user action across a Suspense boundary re-key in Next.js App Router](../best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md)
