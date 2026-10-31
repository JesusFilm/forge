---
id: "feat-855"
title: "Select the visible item clicked in the preview"
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

Reproduce preview pointer selection against overlapping items in
`apps/manager/src/features/video-studio/canvas-selection.tsx`. Ensure a click
selects the visible foreground item rather than retaining the previously selected
background layer. Preserve shared EditorSession selection, geometry, dragging and
media loading behavior. Preserve the existing blank/content fallback and verify inactive items.

## Verification

Real CanvasSelection pointer events with EditorSession and DOM geometry; red
before fix, green after. Manager typecheck, scoped lint/format, and assess layout
reads/media initialization impact.

## Result

The real pointer-event regression failed before the fix: expected foreground,
received background. Removed the selected-item-first branch; picking now uses
existing front-to-back DOM paint order and updates the shared session item ID.
Four tests pass: foreground click with background selected, background click
outside foreground, inactive foreground filtering, and dragging only the clicked
foreground item. Manager typecheck, scoped ESLint, format and diff checks pass.

Performance assessment: this deletes a hit-test traversal and its possible
content geometry reads. It adds no initialization, observers, requests or
per-frame layout work; selection/media/render lifecycles are unchanged.
