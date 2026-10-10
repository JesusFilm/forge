---
id: "feat-420"
title: "Watch search rate-limit feedback"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-08-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "i18n"
---

## Problem

Admin GraphQL rate limits are returned in an HTTP 200 response with
`errors[0].extensions.http.statusCode = 429`. The browser-direct Watch search
client discards GraphQL extensions, and the floating search UI renders the same
connection hint for every failure. A rate-limited user is therefore told to
check their network and may retry immediately, which cannot resolve the error.

Mobile and TV already consume the existing Admin error shape correctly. This
work is limited to preserving and presenting that shape in Web.

## Entry Points — Read These First

1. `apps/web/src/lib/watch-search-client.ts` — browser-direct GraphQL response parsing.
2. `apps/web/src/components/FloatingSearchController.tsx` — search error state ownership.
3. `apps/web/src/components/SearchOverlay.tsx` — localized failure presentation.
4. `apps/web/src/lib/watch-search-client.test.ts` — direct-client contract tests.
5. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` — integrated search-state tests.

## Grep These

- `GraphqlResponse`
- `extensions.http.statusCode`
- `searchFailed`
- `connectionHint`
- `setError`

## What To Build

1. Preserve the Admin GraphQL error status in a Web-owned typed search error.
2. Distinguish rate limiting, server failure, network failure, and unknown failure.
3. Render localized wait-and-retry guidance for a 429 while retaining the
   connection hint only for an actual network failure.
4. Apply the same classification to initial search and load-more failures.

## Constraints

- Do not change Admin GraphQL, its rate limiter, HTTP semantics, or limits.
- Do not change Mobile or TV; both already consume the existing error contract.
- Do not expose raw server error messages to users.
- Do not change search requests, ranking, results, pagination, or retry timing.
- Keep all locale catalogs structurally aligned.

## Verification

- Add regression coverage for HTTP and GraphQL-body 429 responses, 5xx responses,
  network failures, and unknown errors.
- Verify initial search and load-more choose the correct localized presentation.
- Run focused Web tests, message-catalog parity, Web typecheck, changed-file lint,
  formatting, and `git diff --check`.
