---
id: "feat-862"
title: "Inventory Studio top-bar functionality and compare five designs"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui, design]
---

## Scope

Inventory the existing header in `apps/manager/src/features/video-studio/editor.tsx`
and produce five interactive, read-only visual studies for the remote user.
Keep the actual editor unchanged pending selection. Compare hierarchy and
discovery, preserving all current functionality and conspicuous save errors.

## Deliverable

`docs/plans/2026-10-21-studio-top-bar-experiments.md` records the inventory and
alternatives. An inline visual comparison gives each design working menus and
the same editor context. No backend requests or real mutations.

## Result

Delivered Quiet editor, Two rows, Workflow tabs, Menu bar and Command menu in a
single inline carousel. Browser smoke verified creation menus, preparation and
delivery workspace switching, searchable commands and all five narrow layouts
without horizontal overflow (328px iframe content width). Desktop review at
1024px confirms a common stage height; the console has no warnings or errors.
Source contains no fetch, WebSocket or external media loading. Real editor code
and its loading path are unchanged. The user selected Two rows; feat-863 implements the selected design.
