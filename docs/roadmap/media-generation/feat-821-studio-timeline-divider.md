---
id: "feat-821"
title: "Resize Studio timeline with a draggable divider"
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

Add a horizontal divider between workspace and timeline in
`apps/manager/src/features/video-studio/editor.tsx`. Implement a small layout-only
component in `timeline-split.tsx`, styled in `studio.css`. Mouse/touch dragging,
arrow keys, Home/End and double-click reset resize the timeline. Bound sizes so
preview and timeline remain usable, including after window resizing.

## Constraints

No project mutations or persistence. Use pointer capture with cancel cleanup.
Keep drag state inside the layout component so resizing does not rerender the
player or timeline. Preserve the viewport containment from feat-820. Remove the
browser's bottom-corner resize affordance in favor of the visible divider.
No dependencies, network requests, or global pointer listeners.

## Verification

Browser smoke: grow/shrink, bounds, keyboard/reset, window resize, page overflow.
Scoped format, lint, typecheck. Check loading cost and child rerender isolation.

## Verification evidence

Scoped ESLint, TypeScript, Prettier and diff whitespace checks pass. Real Manager
preview rebuilt successfully. Browser verification used the actual TimelineSplit
component with the shared shell and editor CSS, with disposable panel content:

- Up increased timeline from 230px to 246px; dragging upward 100px increased it
  to 346px and released pointer capture/drag styling on pointer-up.
- Home reached 120px minimum; End preserved 160px preview space; double-click
  restored the default 40% allocation.
- Resizing to a 500px-tall window recalculated the maximum to 195px and retained
  160px preview. Document height remained 500px. At 800×600 the minimum was 120px
  and the document stayed 600px tall.
- Instrumented workspace and timeline children each rendered once through all
  drag and keyboard operations, confirming layout state stays isolated.

Performance: no dependencies or requests added; one ResizeObserver watches the
layout container and is disconnected on unmount. Pointer movement uses capture
and component-local handlers; no document listeners or project state updates.
The browser harness and render counters are temporary and outside the repository.

## Durable interaction rule

Keep pane resizing state in a layout component receiving stable React children.
Observe available container height rather than assuming a viewport/header size.
Use pointer capture, clean up on cancellation/lost capture, and provide keyboard
bounds/reset for a focusable separator.
