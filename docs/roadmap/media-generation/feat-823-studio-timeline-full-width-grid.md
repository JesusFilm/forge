---
id: "feat-823"
title: "Fill the Studio timeline width with the editing grid"
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

In `apps/manager/src/features/video-studio/timeline.tsx`, make the grid and time
ruler fill at least the viewport minus the sticky track label column, independently
of the zoomed project extent. `timeline-scale.ts` calculates canvas width separately
from pixels per frame. Blocks, playhead, ruler values and pointer/frame conversions
share that pixel scale. Resizing the window adds empty grid; it never stretches
blocks. The ruler continues past the project end into that space.

## Result and verification evidence

Grid width is the maximum of available viewport width and zoomed project extent.
Zoom can shrink blocks below the available viewport, leaving a full-width grid.
Ruler labels cover the entire canvas, including times past the project duration.
One ResizeObserver tracks container width and disconnects on unmount. Initial
measurement uses a layout effect to avoid painting a short grid first.

Browser checks used the actual Timeline/Inspector with disposable session data:

- At 1280px window width, the grid was 1168px (1278px viewport minus 110px labels).
  A half-duration block was 350px at zoom 1; ruler ticks continued to 16.0 seconds
  beyond the 10-second project extent.
- Zooming out to 0.3 shrank the block to 105px, kept the grid at 1168px, and extended
  the visible ruler to 53.3 seconds.
- Widening to 1920px expanded the grid to 1808px and ruler to 83.8 seconds while
  the same block stayed 105px wide.
- A previous empty-project smoke confirmed the grid fills the viewport with no
  blocks. Horizontal scrolling remains available when the zoomed project is wider.

Three scale regression tests cover window-width independence, zoom-out with extra
ruler time and zoom-in/seeking coordinates. These and 12 existing layout/session
tests pass, alongside scoped ESLint, TypeScript, Prettier and whitespace checks.
No browser-test writes reached live data.

Performance: no dependency, media/player initialization or network request added.
One measurement and observer initialize the grid; updates affect Timeline only.
Row computation stays memoized by document, and playback/dragging does not rerun
the measurement effect. The scale helper is constant-time arithmetic.

## Durable layout rule

Separate time scale from canvas extent. Zoom determines pixels per frame; viewport
width only adds empty grid and corresponding ruler ticks. Never derive the time
scale from a viewport-filling canvas, because that stretches blocks and prevents
zooming out. Keep seeking, blocks and ruler labels on the same time scale.
