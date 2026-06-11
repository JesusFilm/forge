---
id: "feat-172"
title: "Web search keyword-first opt-in"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-06-09"
duration: 1
depends_on:
  - "feat-109"
blocks:
  - "feat-174"
tags:
  - "web"
  - "search"
---

## Problem

`apps/web` currently omits Admin search's `mode` argument, so the floating search bar and shared search result pagination use Admin's default hybrid pipeline. Admin's keyword-first mode is complete and available as an opt-in; web should now opt into it at the shared search data boundary.

## What To Build

- [x] Add `mode: "keyword-first"` to the Admin GraphQL search operation used by `apps/web/src/lib/search.ts`.
- [x] Keep client-facing search action and UI props unchanged.
- [x] Add a focused web test proving the query declares/sends the keyword-first mode.

## Entry Points — Read These First

1. `apps/web/src/lib/search.ts` — shared web Admin search query and mapper.
2. `apps/web/src/lib/search-actions.ts` — server action wrapper used by client components.
3. `apps/web/src/components/FloatingSearchProvider.tsx` — floating search bar request path.

## Grep These

- `searchVideos` — shared web search resolver used by the floating search bar, demo search, and shared result pagination.
- `mode: $mode` — GraphQL query contract for the Admin keyword-first opt-in.
- `searchMode` — response degradation signal that remains separate from input `mode`.

## Constraints

- Do not add a user-visible search-mode selector or a new route; this ticket is a web app opt-in at the Admin GraphQL boundary.
- Do not change `runSearch` input shape unless a caller needs runtime mode selection.
- Admin `Query.search.mode` must already be deployed before this web consumer ships.

## Verification

- `pnpm --filter @forge/web test -- src/lib/search.test.ts`
- `pnpm --filter @forge/web lint`

## Plan

Implementation plan:
`docs/plans/2026-06-09-001-feat-web-search-keyword-first-plan.md`
