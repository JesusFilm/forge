---
id: "feat-636"
title: "Keep Watch search state in the URL and restore focus"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch-search"
  - "accessibility"
  - "navigation"
---

## Problem

Watch search submissions are not shareable or reloadable, browser Back leaves
the site, empty suggestion results can obscure the search result state, and
closing the modal loses keyboard focus.

## Entry Points — Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx`
2. `apps/web/src/components/FloatingSearchController.tsx`
3. `apps/web/src/components/SearchOverlay.tsx`
4. `apps/web/src/lib/watch-search-url.ts`

## What To Build

- Store submitted query and language in `q` and `lang` URL parameters while
  preserving unrelated query parameters and fragments.
- Rehydrate and rerun search on initial load and browser history navigation.
- Hide suggestions on submit so empty suggestions cannot cover results.
- Restore focus to the opening trigger after the modal closes.

## Verification

- URL helper and floating search tests cover submit, reload/history state,
  empty suggestion state, and focus return.
- Web typecheck, scoped lint, formatting, and focused tests pass.
