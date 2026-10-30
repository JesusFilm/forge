---
id: "feat-840"
title: "Overlay Studio resize handles on panel edges"
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

Place timeline resize handle inside its top edge and inspector resize handle
inside its left edge. Remove dedicated divider layout space and background
changes. Preserve pointer capture, keyboard resizing, reset and focus outlines.

## Entry points

- `apps/manager/src/features/video-studio/timeline-split.tsx`
- `apps/manager/src/features/video-studio/inspector-split.tsx`
- `apps/manager/src/features/video-studio/studio.css`

## Verification

Browser-check adjoining panel geometry, pointer and keyboard resize, reset,
transparent backgrounds and loading requests. Run scoped lint/typecheck/format.

## Result

Both separators are positioned absolutely within their target panel: 8px along
the timeline top and inspector left edge. The inspector grid now has only two
columns; timeline available height no longer subtracts 10px. Existing grips,
focus outlines, pointer capture, keyboard controls and double-click reset remain.
The inspector drag shield excludes the pane containing its handle so pointer
capture is not disabled by the new nesting.

## Verification results

- Browser actual-component harness: preview bottom and timeline top both
  431.8125px; inspector starts at the preview column edge with no divider column.
- Inspector pointer drag 245 to 345px; timeline pointer drag 287 to 347px.
  Arrow keys add 16px; double-click resets to 245px and 40% respectively.
- Both handle backgrounds compute to transparent after dragging; CSS no longer
  contains hover/drag background overrides.
- Loading check: DOM/load 934/957ms in the isolated combined real-component
  harness. One footage metadata request and lazy waveform/image loading remain;
  the resize change adds no resources, effects, observers or dependencies. This
  is a smoke measurement, not a claim of improved end-to-end page performance.
- Manager typecheck, scoped ESLint, formatting and whitespace checks pass.

## Durable guidance

When nesting a resize handle inside the pane it controls, update any drag-time
pointer-events shield so the handle remains interactive. Derive size bounds
from available panel space without subtracting removed divider tracks.
