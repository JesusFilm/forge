---
id: "feat-242"
title: "Watch search video-only default"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on:
  - "feat-172"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "semantic-search"
---

## Problem

Watch search should temporarily stop showing experience results in the public
search modal. The existing semantic fallback path intentionally preserved mixed
video and experience results, but the current product need is for untyped public
searches to behave as video-only while keeping explicit typed searches available
for internal and demo callers.

## Entry Points - Read These First

1. `apps/web/src/lib/search-actions.ts` - server-action boundary used by the
   floating search modal; owns the Algolia-versus-semantic split.
2. `apps/web/src/lib/search.ts` - shared Admin GraphQL search helper and
   `SearchContentType` conversion to Admin's `HybridSearchContentType`.
3. `apps/web/src/components/FloatingSearchController.tsx` - modal search and
   load-more calls into `runSearch`.
4. `apps/web/src/components/search/SearchResults.tsx` - shared search result
   empty state and load-more path for explicit typed callers.

## Grep These

```bash
rg -n "runSearch\\(|searchVideos\\(|type: \"experience\"|HybridSearchContentType" apps/web/src apps/admin/src
rg -n "browse experiences|search-card-experience-chip" apps/web/src
```

## What To Build

1. In `apps/web/src/lib/search-actions.ts`, default semantic searches with no
   explicit `type` to `SearchContentType = "video"` before calling
   `searchVideos`.
2. Keep explicit `type: "experience"` calls routed through semantic search so
   deliberate internal/demo experience searches keep working.
3. Leave `apps/web/src/lib/search.ts` unchanged so low-level callers can still
   opt into the full Admin search contract when they pass no type directly.
4. Update public-facing empty-state copy that still suggests browsing
   experiences from generic search results.

## Constraints

- Do not remove Admin's experience retrieval paths or GraphQL enum values.
- Do not change Algolia behavior; Algolia already returns videos.
- Do not break explicit typed searches.
- Do not regenerate GraphQL artifacts; this is not an SDL change.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/lib/search-actions.test.ts src/lib/search.test.ts
pnpm --filter @forge/web exec tsc --noEmit --pretty false
```
