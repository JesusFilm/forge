---
id: "feat-831"
title: "Resize the Studio inspector with a divider"
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

Add a vertical drag handle between preview and inspector, using pointer capture,
keyboard arrows/Home/End and double-click reset. Bound inspector width to reserve
preview space, adapt to workspace resizing, and preserve existing small-screen
inspector hiding. Keep sizes local to the editor session and avoid data writes.

## Verification

Browser-check drag/keyboard/reset, bounds and overflow with actual Inspector.
Run scoped lint, typecheck and formatting. Compare load timings/resource counts;
no new network requests or media loads should result from resizing.

## Outcome

`inspector-split.tsx` owns pointer capture, cancellation, keyboard resizing,
reset and workspace ResizeObserver cleanup. The editor wraps its existing stage
and inspector in this component. Inspector width is 200–560px with at least
240px reserved for the preview; CSS keeps inspector and divider hidden together
at the existing 850px breakpoint. Size changes stay local and never edit projects.

Browser verified dragging from 245px to 425px, Home to 200px, End to 560px,
and double-click reset to 245px. Workspace overflow stayed zero. Resizing caused
no extra resource requests: one metadata, two waveforms, three thumbnails.
Warm reload DOM/load was 222/229ms versus the preceding compact-inspector
fixture's 321/328ms; cold observation was 655/675ms (cache variation, not a
speedup claim). All media remained deferred until after load. Scoped ESLint,
manager typecheck, Prettier and diff checks passed.

Durable rule: a resizable inspector needs an independently constrained wrapper
with min-width/min-height zero so intrinsic field content cannot force the grid
wider. Hide that wrapper and the separator together on narrow layouts.
