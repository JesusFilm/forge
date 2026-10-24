---
title: Watch Search Edited Query Hang Fix Plan
type: fix
date: 2026-06-15
origin: docs/plans/2026-06-15-001-fix-watch-search-web-page-reliability-plan.md
---

# Watch Search Edited Query Hang Fix Plan

## Summary

Fix the remaining Watch search modal hang when a viewer completes one search, edits the active query, pauses briefly, and continues typing. The first hydration fix stopped same-URL navigations, but changed-query URL sync still uses Next router navigation and can interrupt the modal's debounced search flow.

## Problem Frame

Production repro on 2026-06-15:

1. Open `watch.jesusfilm.org/watch`.
2. Search `jesus`; results render.
3. Clear/edit the input, type `the bible proj`, pause long enough for debounce, then type `ect`.
4. The URL stays at `?q=the+bible+proj`, the input shows `the bible project`, skeleton cards remain, and no result cards render.

The browser trace showed a server-action POST for language metadata at the partial query URL, but no `runSearch` POST for either the partial query or the final query. This points to client-side navigation/remount interruption, not search backend latency.

## Requirements

- R1. Editing a non-empty completed search into another non-empty query must render the winning final result set.
- R2. Query URL sync must keep `?q=` shareable without triggering a Next App Router/RSC navigation for modal-only search typing.
- R3. Existing direct `?q=` hydration must continue to search on initial mount.
- R4. Empty-query reset, stale request guards, language filters, and load-more behavior must remain unchanged.

## Implementation Units

### U1. Modal URL Sync Without Next Navigation

- **Goal:** Replace changed-query `router.replace()` calls with `window.history.replaceState()` for search modal `?q=` updates.
- **Files:** `apps/web/src/components/FloatingSearchController.tsx`.
- **Rationale:** `?q=` is client modal state. Updating it through Next navigation can remount the overlay while debounced input is still active, clearing pending searches.
- **Test Scenarios:** Changed-query sync updates `window.location.search` and does not call `router.replace`.

### U2. Edited Query Regression Coverage

- **Goal:** Cover the exact interaction invariant: a completed search can be edited through an intermediate debounced query and then a final query without losing the final search.
- **Files:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Test Scenarios:** Search `jesus`, type `the bible proj`, let debounce fire, type `the bible project`, let debounce fire, and assert the final `runSearch` call is made while no Next router replace occurs.

## Verification

- Focused Vitest file: `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- Web typecheck.
- Browser smoke reproducing the post-success edit path.

## Scope Boundaries

- Do not change search ranking, Admin GraphQL, Algolia flag behavior, result cards, or route structure.
- Do not introduce a new search page; the floating modal remains the search surface.
