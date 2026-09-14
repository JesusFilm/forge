---
id: "feat-501"
title: "Admin Experience Editor Performance"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-14"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "editor"
  - "performance"
---

## Problem

Large Experience pages are extremely slow to load and edit. The editor eagerly
queries and serializes the complete image library even though the picker is
closed, and canvas rendering repeatedly scans that library to resolve authored
asset previews. Library growth therefore increases both route latency and the
cost of unrelated editor updates.

## Entry Points - Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
5. `apps/admin/src/app/dashboard/experiences/experience-editor/image-picker-browser.tsx`
6. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`

## Grep These

- `loadMediaLibrary|mediaLibraryPromise` in `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
- `mediaAssetPreviewUrl|openImagePickerTarget|ImagePickerBrowser` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `imageAssetId|backgroundImageAssetId|mediaAssetId` in Experience block payloads

## What To Build

1. Load only image assets referenced by the active Experience document during
   the initial route render.
2. Fetch the complete media library on demand when an editor opens the image
   picker, with explicit loading and retryable error feedback.
3. Resolve canvas image previews through an indexed lookup rather than repeated
   full-library scans.
4. Add focused tests for recursive referenced-asset discovery and the picker
   loading state.

## Constraints

- Keep scope inside `apps/admin` plus this roadmap ticket.
- Preserve existing image selection, upload, folder browsing, and clearing
  behavior.
- Do not change the Experience block schema or generated GraphQL artifacts.
- Do not trade initial route performance for missing previews of images already
  referenced by the document.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx src/app/dashboard/experiences/experience-editor/image-picker-browser.test.tsx src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin exec eslint src/app/dashboard/experiences/[id]/page.tsx src/app/dashboard/experiences/experience-editor.tsx src/app/dashboard/experiences/experience-editor/image-picker-browser.tsx src/app/dashboard/experiences/experience-editor/block-helpers.ts`
- Compare initial editor route payload/query scope before and after: the initial
  media query must be bounded to asset ids referenced in the active blocks; the
  full library query must run only after opening the picker.
