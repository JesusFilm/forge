---
id: "feat-325"
title: "Watch search direct client contract"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-02"
duration: 1
depends_on:
  - "feat-254"
blocks: []
tags:
  - "platform"
  - "watch"
  - "search"
  - "web"
---

## Problem

Watch search returns Admin-owned result fields, but Web still performs
per-result `videoBySlug` calls when `watchSearch` leaves card material such as
`label` and `childCount` empty. That adds frontend-server work and extra Admin
round trips to the critical search response path.

## Entry Points - Read These First

1. `apps/admin/src/services/watch-search.service.ts`
2. `apps/admin/src/graphql/queries/watch-search.ts`
3. `apps/web/src/lib/search.ts`
4. `apps/web/src/lib/search.test.ts`
5. `apps/admin/src/services/watch-search.service.test.ts`

## What To Build

1. Populate card material required by Web from the Admin `watchSearch` response
   for the final bounded result page.
2. Remove Web's missing-label catalog fallback so search consumes one Admin
   response instead of issuing per-result `videoBySlug` calls.
3. Preserve public search authorization and avoid exposing unpublished,
   internal, or debug-only fields.

## Verification

- Admin `watchSearch` hydrates `label` and `childCount` for video results.
- Web search maps those fields directly from `watchSearch`.
- Web search no longer calls `videoBySlug` to fill missing search card labels.
