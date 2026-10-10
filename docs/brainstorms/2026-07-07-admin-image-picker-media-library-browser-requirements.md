---
date: 2026-07-07
topic: admin-image-picker-media-library-browser
---

# Admin Image Picker Media Library Browser

## Problem Frame

The experience editor can open an image picker from image-bearing block
surfaces, but the current picker behaves like a flat filtered list. Editors need
the same media-library mental model they use on `/dashboard/media`: folders on
the left, assets on the right, global search, and folder-scoped uploads. The
picker should make selecting existing managed images feel natural without
turning the picker into a full media management surface.

## Requirements

**Library Browser**

- R1. The image picker presents a compact media library browser with folder/path
  navigation on the left and image assets for the current view on the right.
- R2. The browser reuses the media library's folder hierarchy and current folder
  concepts, including a root `Library` location.
- R3. Folder management is out of scope inside the picker: no create, rename,
  move, reorder, or delete folder actions appear there.
- R4. Asset management is limited to what selection requires: browse, search,
  upload into the selected folder, preview image metadata, select, and close.
- R5. The browser is image-only for this picker. Non-image assets are not shown
  as selectable results.

**Search And Filtering**

- R6. Global search always searches the entire image library, regardless of the
  selected folder.
- R7. While a search is active, results show each image's folder/path context so
  editors can understand where a match lives.
- R8. Clearing search returns the asset pane to the selected folder's direct
  image contents.
- R9. Empty states distinguish between an empty folder, no global search
  matches, and no ready image assets available.

**Upload And Selection**

- R10. Dragging image files onto the picker uploads them into the currently
  selected folder.
- R11. Upload feedback makes the target folder clear before and after the upload.
- R12. Newly uploaded ready images become available for selection without
  forcing the editor to leave the experience editor.
- R13. Selecting an image writes both the target preview URL field and the
  matching asset ID field for the block surface that opened the picker.
- R14. The picker preserves the existing editor behavior for clearing or
  replacing a selected image.

**State And Permissions**

- R15. Users without upload permission can still browse and select images, but
  cannot upload.
- R16. Processing or failed image assets should not look like missing content. If
  shown, they are visibly unavailable for selection with clear status; otherwise
  empty states must not imply that matching ready images exist.
- R17. Closing the picker returns the user to the same editing context without
  losing unsaved block edits.

## Success Criteria

- An editor can open the picker from a section, container, or card image control,
  navigate folders on the left, and select an image from the right pane.
- Searching for an image finds matches across the full image library even when a
  nested folder is selected.
- Dragging an image into the picker uploads it into the selected folder and makes
  it available for selection in the same workflow.
- The saved block stores both the managed asset ID and current preview URL.
- The picker does not expose folder-management controls.

## Scope Boundaries

- Do not build folder creation, renaming, moving, or deletion inside the image
  picker.
- Do not broaden this picker to PDFs, videos, or generic files.
- Do not replace the full `/dashboard/media` asset-management route.
- Do not require consumer app changes in web, mobile, or TV.
- Do not migrate every legacy image URL field as part of the picker browser
  work; planning may identify follow-up normalization work if needed.

## Key Decisions

- **Extract the media-library browser pattern:** The existing media library
  already provides the right left-folder/right-assets model, so the picker
  should adapt that interaction instead of inventing a separate chooser.
- **Selection-focused picker:** Folder management remains in `/dashboard/media`
  to keep the picker fast and low-risk for editors who are in the middle of
  composing an experience.
- **Global search by default:** Search ignores the selected folder because the
  picker's job is to help editors find the right image quickly, not preserve a
  filesystem-style search scope.
- **Folder-scoped upload:** Drop upload uses the selected folder because upload
  location is one of the few organization actions that naturally belongs inside
  image selection.

## Dependencies / Assumptions

- `apps/admin` already has a `MediaFolder` hierarchy, asset `folderId`, a media
  library route, and folder-scoped upload behavior to adapt.
- The first picker integration should target the currently exposed experience
  block image controls before expanding to every image-bearing nested item.

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R4][Technical] Which existing media library components can be
  extracted cleanly for picker use, and which need a selection-specific wrapper?
- [Affects R10-R12][Technical] Should picker uploads use the existing server
  action directly, a shared action, or a new action that returns picker-ready
  image rows?
- [Affects R16][Product/Technical] Should processing images appear as disabled
  rows, or should the picker show only ready images with clearer empty states?

## Next Steps

-> `/ce:plan` for structured implementation planning.
