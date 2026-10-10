---
id: "feat-236"
title: "Admin image picker media library browser"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-07-07"
duration: 4
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

The experience editor image picker currently behaves like a flat image list.
Editors need a picker that feels like the media library: folders on the left,
images on the right, global search, and drag/drop upload into the selected
folder, without exposing full folder-management controls inside the picker.

## Entry Points - Read These First

1. `docs/brainstorms/2026-07-07-admin-image-picker-media-library-browser-requirements.md` - product requirements and scope boundaries.
2. `apps/admin/AGENTS.md` - admin architecture rules.
3. `apps/admin/CLAUDE.md` - service, permission, GraphQL, and dashboard conventions.
4. `apps/admin/src/app/dashboard/media/page.tsx` - existing full media library route and folder-scoped upload behavior.
5. `apps/admin/src/app/dashboard/media/folder-tree.tsx` - folder tree interaction model to adapt or extract.
6. `apps/admin/src/app/dashboard/media/media-asset-table.tsx` - current asset browser/list behavior.
7. `apps/admin/src/app/dashboard/media/media-asset-drop-target.tsx` - folder-scoped drag/drop upload behavior.
8. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` - current flat picker modal, selection target handling, and block writes.
9. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` - current image asset loading for the editor.

## Grep These

- `imagePickerTarget|filteredImageLibrary|mediaLibrary` in `apps/admin/src/app/dashboard/experiences`
- `MediaFolderTree|MediaAssetDropTarget|MediaAssetTable` in `apps/admin/src/app/dashboard/media`
- `folderId|mediaAssetPreviewUrl|kind: "IMAGE"|status: "READY"` in `apps/admin/src/app/dashboard`
- `backgroundImageAssetId|imageAssetId|mediaAssetId` in `apps/admin/src/app/dashboard/experiences`

## What To Build

1. Extract or adapt the existing media library browser pattern for picker use:
   left folder/path navigation, right image results, and selection-oriented
   asset rows/cards.
2. Keep folder management out of the picker. Do not expose create, rename, move,
   reorder, or delete folder actions there.
3. Make picker search global across the full image library, regardless of the
   selected folder, and show folder/path context on search results.
4. Support drag/drop image upload into the currently selected folder from inside
   the picker, with permission-aware disabled behavior.
5. Preserve existing block write semantics: selecting an image writes both the
   URL field and the corresponding asset ID field.
6. Add empty states for empty selected folder, no global search matches, and no
   ready image assets.

## Constraints

- Preserve admin's UI -> service/action -> Prisma/storage architecture.
- Do not add folder-management actions inside the picker.
- Do not include PDFs, videos, or generic files in picker results.
- Do not hand-edit generated GraphQL or Prisma artifacts.
- Keep the full `/dashboard/media` route as the asset-management surface.

## Verification

- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- Experience editor picker can select an existing image from a folder and write
  the URL plus asset ID.
- Picker global search finds image assets outside the selected folder and shows
  folder/path context.
- Drag/drop upload in the picker creates the image in the selected folder.
- Users without upload permission can browse/select but cannot upload.
- Picker UI exposes no folder create, rename, move, reorder, or delete controls.
