---
id: "feat-280"
title: "Admin Editor Video Picker Type Filter"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-07-21"
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

The Experience editor video picker supports full-library text search but cannot
narrow results by video type. Editors building media collections must scan a
mixed list when they specifically need a parent collection, feature, short
film, or series, and locally filtering the initial picker preload would miss
matching rows outside the first 30 videos.

## Entry Points

1. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — picker
   query state, result intersection, eligibility rules, and modal controls.
2. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` — server action for
   picker result retrieval and search tracing.
3. `apps/admin/src/app/dashboard/live-data.ts` — picker row hydration.
4. `apps/admin/src/app/dashboard/video-library-utils.ts` — canonical Video
   Library category contract.
5. `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx` —
   picker interaction and server-result regression coverage.

## Grep These

- `videoLibraryQuery`
- `searchVideoLibraryAction`
- `VideoLibraryCategory`
- `videoPickerLibraryRows`
- `loadVideoRows`

## What To Build

1. Add an accessible video-type select to the picker using the existing All,
   Collections, Features, Short films, and Series categories.
2. Combine the selected category with text search, picker-mode eligibility, and
   duplicate-item exclusion.
3. Make category-only filtering server-backed so results are not limited to
   the initial 30-row preload.
4. Reset query and category when a new picker session opens and preserve the
   current pending, error, preview, dub, expansion, and apply behavior.

## Constraints

- Do not change Admin GraphQL schema or public Watch search behavior.
- Do not introduce a separate video-type taxonomy.
- Do not record blank-query category loads as search traces.
- Keep the existing picker trace clients and ranked text-search order.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/video-library-utils.test.ts src/app/dashboard/live-data.test.ts src/app/dashboard/experiences/experience-editor.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- Browser smoke the media-collection picker and capture the type control with a
  narrowed result set.
