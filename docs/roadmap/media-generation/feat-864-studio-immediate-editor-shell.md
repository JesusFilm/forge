---
id: "feat-864"
title: "Render the Studio editor shell while project data loads"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui, performance]
---

## Scope

Replace the blocking Opening project message in
`apps/manager/src/features/video-studio/editor.tsx` with the editor layout.
Show shared header, preview space, timeline and inspector before the read resolves.
Disable project actions until data is loaded; never invent an editable document,
create an EditorSession, save recovery state or load media for the placeholder.
Preserve failure reporting and the real editor's recovery/autosave lifecycle.

## Verification

Render the real loading shell without project data and verify layout, disabled
controls and absence of player/media initialization. Run Manager typecheck,
scoped lint/format and existing session/autosave tests. Compare initial render
cost and resource behavior; preserve one existing project read.

## Result

Added the data-free `editor-loading.tsx` layout and a loading variant of the
shared `EditorHeader`. The initial server render now includes the full editor
regions; only the existing project read gates the editing session. All project
actions remain disabled until it resolves. No fake document, player or session
is created. The error screen and recovery/autosave path are unchanged.

Verification: 17 loading/session/autosave tests pass, along with Manager
typecheck, scoped ESLint, Prettier and diff checks. The loading tests render
the real StudioEditor before effects and hold its read unresolved: one read,
zero recovery writes/removals and no media elements. This checks initialization
and resource behavior in addition to visual smoke. Browser review of the actual
loading component/styles at 1280 × 720 shows the editor filling the viewport
without overflow, disabled controls, and no console warnings/errors. The remote
preview's font and hot-reload connection remain healthy.

Durable pattern: render project-independent editor chrome before the read, but
keep the mutable EditorSession, recovery and player mounted only after validated
data arrives. A fabricated empty document can trigger lifecycle work and is not
a loading-state model.
