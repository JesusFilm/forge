---
id: "feat-857"
title: "Snap canvas rotation near 45-degree increments"
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

In `apps/manager/src/features/video-studio/canvas-selection.tsx`, gently snap
pointer rotation within 4 degrees of each 45-degree increment. Use the snapped
angle for the preview frame and centre-preserving position compensation as well
as the final stored rotation. Preserve free rotation outside the tolerance,
undo/cancel and the retained rotation handle position.

## Verification

Actual canvas gesture tests for near-0/45/90/135/180 and negative angles, free
angles and pivot compensation; existing gesture regressions; typecheck and scoped
lint/format/diff. Arithmetic only, with no new layout reads or media requests.

## Result

Rotation snaps within 4 degrees of every 45-degree increment, retaining free
rotation outside that band. The same effective angle drives saved rotation,
selection frame and position compensation, preserving the content pivot.
Nineteen actual canvas gesture tests pass, covering positive/negative snapping,
180-degree wrapping, free angles, retained handles, undo and cancellation.
Manager typecheck and scoped lint/format/diff checks pass. Arithmetic only: no
additional media requests, initialization or pointer-move layout measurements.
