---
module: Studio editor
problem_type: ui_bug
tags: [studio, preview, selection, layers]
date: 2026-10-21
---

# Preview clicks must follow visible layer order

`apps/manager/src/features/video-studio/canvas-selection.tsx` previously preferred
an already selected item's content rectangle over every other hit. A full-frame
selected background therefore intercepted clicks on foreground content, leaving
the shared EditorSession selection (and timeline highlight) on the background.

The composition paints tracks/items in DOM order. Canvas selection already
reverses those active DOM layers for front-to-back picking; use the first content
hit from that list regardless of prior selection. Keep full-frame layout wrappers
out of content geometry. The existing no-content fallback remains unchanged.

The regression renders the real CanvasSelection with an EditorSession and
overlapping layer geometry. It failed with background selected after a foreground
click before the fix. It now verifies foreground selection, background selection
outside foreground content, inactive-item filtering, and dragging only the clicked
item. Selection shares the same item ID used by timeline and inspector consumers.

This removes the extra selected-layer hit-test pass and adds no observers, frame
work, media requests or initial mount work. Keep playback ticks free of layout
reads as the existing selection measurement effect requires.

## Canvas scale and rotation handles

Handle pointer-down targets must use the selected item ID rather than ordinary
content hit testing, so an overlapping foreground cannot steal a handle gesture.
Capture canvas geometry, the content bounds, layer transform origin and pointer
position once. Scale proportionally about the opposite corner; compensate x/y
when changing scale or rotation because the rendered layer transform origin is
the full canvas centre, which can differ from visible content centre.

Preview the layer style and selection box locally, then commit one session edit
on pointer release. Reset original paint on cancellation, lost capture or window
blur. Never add layout measurements to pointer moves or playback ticks. Retain
preview/media signatures; transform changes should not reacquire media.

Persist the frame orientation when remeasuring after rotation. Using only the
rotated content axis-aligned bounding box loses orientation and resets the handle
to the top on release. Measure the local rectangle with item rotation temporarily
neutralised, restoring layer style synchronously before paint; then rotate its
centre about the full-frame transform origin and retain item rotation in the
selection box. Scale anchors must be rotated too, and subsequent rotation
gestures add to the retained frame angle. This measurement belongs only to the
existing selection/edit/seek/resize path, never pointer moves or playback ticks.

Pointer rotation gently snaps within 4 degrees of every 45-degree increment.
Calculate the effective snapped delta before deriving pivot compensation and
frame paint; snapping only the saved rotation would make the item or handle
shift on release. Keep free angles outside that tolerance and normalize stored
rotation across the +/-180 boundary.
