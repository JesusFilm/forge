---
id: "feat-287"
title: "Admin Editor Single Episode Filter"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
  - "editor"
---

## Problem

The Experience editor video picker can filter collections, features, short
films, and series, but not individual episodes. Editors must search a mixed
result set when they need an episode outside a parent collection.

## Entry Points — Read These First

1. `apps/admin/src/app/dashboard/video-library-utils.ts` — shared
   `VideoLibraryCategory` parsing and canonical-label matching.
2. `apps/admin/src/services/video.service.ts` — Prisma category-to-`VideoLabel`
   filtering used by server-backed picker and library queries.
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — Experience
   editor picker option labels and selected-category action context.
4. `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx` — main Video
   Library consumer of the shared category contract.

## Grep These

- `VIDEO_LIBRARY_CATEGORIES`
- `VIDEO_LIBRARY_CATEGORY_LABELS`
- `VIDEO_PICKER_CATEGORY_OPTIONS`
- `categoryOptions`
- `searchVideoLibraryAction`

## What To Build

1. Add a `Single episodes` option to the existing video-type filter.
2. Map the option to the canonical `EPISODE` video label.
3. Preserve server-backed category-only and text-plus-category search.
4. Keep the main Video Library toolbar aligned with the shared
   `VideoLibraryCategory` union.

## Constraints

- Do not change the Admin GraphQL schema or public Watch search behavior.
- Do not introduce a second episode taxonomy; use the existing `EPISODE` label.
- Preserve ranked text-search order and existing picker-mode eligibility.
- Do not record blank-query category loads as search traces.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/video-library-utils.test.ts src/services/video.service.test.ts src/app/dashboard/experiences/experience-editor.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- `pnpm exec prettier --check apps/admin/src/app/dashboard/video-library-utils.ts apps/admin/src/app/dashboard/experiences/experience-editor.tsx apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx apps/admin/src/i18n/messages.ts apps/admin/src/services/video.service.ts`
- Browser smoke captures the picker with `Single episodes` selected when the
  local Admin preview is available.
