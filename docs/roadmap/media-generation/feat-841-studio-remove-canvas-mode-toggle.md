---
id: "feat-841"
title: "Remove Studio canvas mode switch"
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

Remove the Select & move / Playback view toggle above the preview. Preserve the
existing default direct canvas selection/dragging and pause-on-interaction.
Playback remains in PreviewTransport below the preview.

## Entry point

- `apps/manager/src/features/video-studio/editor.tsx`: `selectCanvas`,
  `CanvasSelection`, `nle-stage-toolbar`.

## Verification

Check the removal and preserved selection/transport wiring; scoped lint,
Manager typecheck and formatting. The initial canvas tree remains the same
except for one removed button; no new initialization, observers, media work,
network requests or dependencies.

## Outcome

Removed the mode button, its local state and unused icon. CanvasSelection remains
mounted with the same session/state/error props and pointer-capture pause handler;
PreviewTransport remains unchanged. Checked the final wiring and absence of the
removed control. Scoped ESLint, Manager typecheck, formatting and whitespace
checks pass. Loading impact review: the original default was selection enabled,
so initial media and selection trees are identical; one button/state hook is
removed with no added render, hydration or loading work.
