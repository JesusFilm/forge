---
id: "feat-842"
title: "Hide resize focus outlines during pointer dragging"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Hide the full-length focus outline when dragging timeline/inspector resize
handles. Preserve focus indication for keyboard resizing.

## Entry points

- `apps/manager/src/features/video-studio/studio.css`: divider focus styles.
- `apps/manager/src/features/video-studio/{timeline,inspector}-split.tsx`:
  pointer-down focus and `data-resizing`.

## Verification

Check keyboard focus and pointer dragging computed outlines in both handles;
format and whitespace checks. Style-only change adds no loading work.

## Outcome

Divider outlines default to none. Keyboard focus rings apply only while the
corresponding split is not in its pointer-resizing state. Browser verification
recorded computed outline `none` during both inspector and timeline drags,
including an inspector drag starting from keyboard focus; keyboard ArrowLeft
still resized and showed its solid 2px outline. Format/whitespace checks pass.
No JavaScript, initialization, resource loading or media behavior changed.
