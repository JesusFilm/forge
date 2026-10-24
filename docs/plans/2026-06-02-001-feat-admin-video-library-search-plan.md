---
title: "feat: Add admin video library search"
type: feat
status: active
date: 2026-06-02
roadmap: docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md
---

# feat: Add admin video library search

## Summary

Add a real search field to `/dashboard/videos` so operators can filter the
Core-synced video catalog across the fields visible or useful in the video
library: identifiers, slug/title/description, type/source, timestamps, locale
metadata, dub language metadata, and image metadata.

## Problem Frame

The video library now paginates and exposes richer row metadata, but the page
still has a disabled filter control. Operators need a fast way to narrow the
catalog without knowing which specific field contains the value they remember.
The request is to add a search field and filter by every video field; for this
read-only catalog slice that means a broad, server-side query filter over the
Video row plus the related locale, dub/language, and image fields already used
to render the table.

## Requirements

- R1. `/dashboard/videos` renders an enabled search field instead of the
  disabled filter affordance.
- R2. The query is URL-backed as `q` so refresh, sharing, and browser back/next
  preserve the filtered catalog.
- R3. Pagination counts and page links apply to the filtered result set.
- R4. Filtering searches active videos across core Video fields, localized
  title/description fields, dub/language fields, and image URL/kind fields.
- R5. The first page is selected when the query changes or when a query link is
  built without an explicit page.
- R6. Empty-state copy distinguishes "no videos exist" from "no videos match
  this search".
- R7. The implementation keeps Core-sourced videos read-only; no edit or
  mutation behavior is introduced.

## Scope Boundaries

- Do not add faceted filters, advanced query syntax, sort controls, or bulk
  actions in this slice.
- Do not change admin GraphQL SDL unless implementation finds an unavoidable
  schema need; this page can use the existing dashboard service/server data
  path.
- Do not import from `apps/web` or change public watch routes.
- Do not use client-side filtering over one page of rows; the catalog search
  must be server-side so pagination remains truthful.

## Context & Patterns

- `docs/plans/2026-06-01-001-feat-admin-video-library-pagination-plan.md`
  completed pagination/thumbnails/type labels/visitor links and explicitly
  deferred search/filter controls.
- `docs/roadmap/platform/feat-100-admin-video-and-media-editorial-workflows.md`
  is already `in-progress` and covers this admin video workflow refinement.
- `apps/admin/src/app/dashboard/videos/page.tsx` is a server-rendered route
  that already parses `page` and calls `loadVideoLibraryPage`.
- `apps/admin/src/app/dashboard/live-data.ts` owns the dashboard loader and
  already enriches Video rows with locales, dubs/languages, images, and
  visitor URLs.
- `apps/admin/src/app/dashboard/video-library-utils.ts` owns pagination helpers
  and is the right place for query parsing/normalization helpers.
- `apps/admin/src/services/video.service.ts` already owns read-only Video
  listing/counting and should grow the reusable Prisma filter contract.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` has current SSR coverage
  for `/dashboard/videos`.

## Key Technical Decisions

- Keep the feature server-rendered: parse `q` from `searchParams`, pass it into
  `loadVideoLibraryPage`, and render a GET form whose submit naturally updates
  the URL.
- Add a normalized `search` option to `VideoService.list` and
  `VideoService.countActive` so the list and total use the same
  `Prisma.VideoWhereInput`.
- Treat "every video field" as every searchable scalar on the Video row plus
  related fields operators can reasonably search from this catalog:
  `id`, `coreId`, `slug`, `label`, `videoSource`, `createdAt`, `updatedAt`,
  locale `locale/title/description`, dub/language identifiers and playback
  URLs, and image `url/kind`.
- Search enum-like fields by matching against known enum values after query
  normalization, then OR those enum matches with textual `contains` filters.
- Preserve query parameters in pagination links and omit `q` when the normalized
  query is empty.

## Implementation Units

### U1. Search Query Helpers

**Goal:** Normalize video-library query input and keep URL construction
predictable.

**Requirements:** R2, R5

**Files:**

- Modify: `apps/admin/src/app/dashboard/video-library-utils.ts`
- Test: new focused test file near `video-library-utils.ts` or existing
  dashboard utility coverage if present

**Test scenarios:**

- Missing, array, whitespace-only, and overlong query inputs normalize safely.
- Pagination hrefs preserve a non-empty query and omit it when blank.
- Page parsing still clamps invalid values to page 1.

### U2. Service-Level Video Search Filter

**Goal:** Make `VideoService.list` and `VideoService.countActive` accept the
same optional search string and apply a broad Prisma OR filter.

**Requirements:** R3, R4, R7

**Files:**

- Modify: `apps/admin/src/services/video.service.ts`
- Test: `apps/admin/src/services/video.service.test.ts`

**Test scenarios:**

- List/count calls without a query preserve current active-video behavior.
- A text query searches Video identifiers/slug plus locale title/description.
- A query matching label/source text adds enum filters.
- A query matching dub language/image data searches through related rows.

### U3. Dashboard Loader and Page UI

**Goal:** Wire `q` through the page, loader, pagination, and empty state.

**Requirements:** R1, R2, R3, R5, R6

**Files:**

- Modify: `apps/admin/src/app/dashboard/live-data.ts`
- Modify: `apps/admin/src/app/dashboard/videos/page.tsx`
- Modify: `apps/admin/src/i18n/messages.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Test scenarios:**

- The page renders an enabled search field with the submitted query.
- `loadVideoLibraryPage` receives `{ page, query }`.
- Previous/next links preserve `q`.
- Filtered empty results render the search-specific empty state.

## Verification

- `pnpm --filter @forge/admin test -- apps/admin/src/app/dashboard/dashboard-ui.test.tsx apps/admin/src/services/video.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- Browser smoke with Helium against `/dashboard/videos?q=<known-value>` when a
  local admin server is available.
