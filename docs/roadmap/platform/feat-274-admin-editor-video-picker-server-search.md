---
id: "feat-274"
title: "Admin Editor Video Picker Server Search"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on:
  - "feat-107"
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
  - "editor"
---

## Problem

The experience editor's video picker filtered only the initial in-memory
`loadVideoRows()` slice, which is capped to the first recent videos plus videos
already referenced by the current experience. Searching for a valid new-search
term such as `rivka` could show no results when that match was outside the
initial slice or matched by description/snippet evidence instead of title.

## Entry Points — Read These First

1. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` — server action
   wiring for editor data.
2. `apps/admin/src/services/watch-search.service.ts` — new Watch search
   retrieval stack used by the picker.
3. `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx` —
   merged editor video library state.
4. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — video
   picker search and selection UI.
5. `apps/admin/src/app/dashboard/live-data.ts` — `loadVideoRows()` hydration
   bridge for new-search result IDs.

## Grep These

- `videoLibraryQuery`
- `searchVideoLibraryAction`
- `loadVideoRows(`
- `videoPickerLibraryRows`

## What To Build

1. Add a server action from the experience editor page that calls the new
   `WatchSearchService.search()` stack with `resultTypes: ["video"]`, then
   hydrates ranked result IDs back into editor video rows.
2. Thread that action through the chat/editor wrapper and merge returned rows
   into the existing editor video library state.
3. Update the picker selection logic so a narrowed search updates the pending
   selection to the visible result instead of keeping a stale selection.
4. Keep picker search out of production Watch search traces by calling the
   service directly instead of the GraphQL resolver that records traces.

## Constraints

- Do not change Admin GraphQL schema.
- Do not change Watch/public search behavior.
- Do not record editor picker keystrokes in production search traces.
- Keep chat-panel missing-video hydration behavior intact.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx`
- Manual smoke: open an experience editor, add a video block, search `rivka` in
  the picker, confirm matching videos appear and can be applied.
