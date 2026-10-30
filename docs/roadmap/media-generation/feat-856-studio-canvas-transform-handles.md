---
id: "feat-856"
title: "Scale and rotate selected preview items with canvas handles"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Add four corner scale handles and a top-middle rotation stem/dot to
`apps/manager/src/features/video-studio/canvas-selection.tsx`. Uniform scaling
preserves proportions and anchors the opposite corner; rotation uses the visible
selection centre. Preview transforms locally during dragging and commit one
EditorSession edit on release. Cancel/lost capture/window blur restores original
paint. Read-only projects hide handles. Preserve click selection and movement.

## Verification

Pointer-event regression checks for scale, rotation, cancellation and undo,
existing selection/movement checks, Manager typecheck/lint/format. Avoid pointer
move layout reads, initial requests or new dependencies.

## Result

Four square corner handles resize proportionally, anchoring the opposite corner;
the circular top-edge handle connects via a stem and rotates around visible
content centre. When the top edge is at the preview boundary the rotation dot
is inset to remain usable. Controls support keyboard arrow adjustments and hide
for read-only documents. Pointer preview changes stay local until release;
cancel, lost capture and window blur restore original paint.

Nine canvas tests pass, including selection, movement, proportional scaling,
rotation pivot compensation, undo, cancellation, read-only controls and no extra
layout reads during pointer moves. Manager typecheck, scoped ESLint, format/diff
checks pass. Browser interaction using the actual component verified 100x80 to
150x120 scaling with the same top-left corner, Undo restoring original geometry,
and a 90-degree rotation preserving centre (191,181).

Loading/performance: adds five lightweight buttons only while an editable visible
item is selected. No dependencies, media requests or initialization effects.
Geometry is captured on gesture start; pointer moves use arithmetic and local
paint only, with a test proving no repeated getBoundingClientRect reads.

## Rotation-handle retention correction

Release previously remeasured an axis-aligned bounding rectangle and dropped
the frame rotation, snapping the handle to the top. The regression asserted
`rotate(90deg)` after release and failed with an empty transform before the fix.
Measure local content bounds with the item rotation neutralised synchronously,
restore layer paint before returning, and rotate the measured centre into canvas
space. Store the item rotation on the frame and accumulate subsequent drag
angles. Opposite-corner scale anchors also rotate with the selection.

Ten canvas tests pass, including successive 90/180-degree releases with stable
frame centre and no pointer-move layout reads. Browser evidence with actual DOM
geometry: handle stayed at (259,181) after first release and (191,249) after the
second, matching the released pointer; frame rotations were 90 and -180 degrees.
Additional bounds measurement is limited to selected rotated items on edits,
seeks and resize; no media initialization, requests or playback-tick work added.
