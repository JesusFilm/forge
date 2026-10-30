---
id: "feat-863"
title: "Apply the selected two-row Studio header"
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

Implement the Two rows design selected from feat-862. Upper row: project menu,
save status/menu, project settings and primary Render and publish. Lower row:
undo/redo, Add content, Scripts, Speech and production and Assistant. Preserve
existing handlers, save/recovery states, permissions and lazy-loaded dialogs.
Move format details, history and explicit Save now into the project/save menus.

## Verification

Browser smoke with the actual header and styles at desktop and compact widths,
menu actions and save-error/read-only states; Manager typecheck, scoped
lint/format/diff. Review loading impact and preserve the existing player/media
initialization path.

## Result

Extracted `editor-header.tsx` and applied the two-row layout in `editor.tsx`
and `studio.css`. Native project/save disclosures close on action, blur and
Escape. Save failures retain a visible Retry save action. Existing recovery
notices, permission gates and callbacks are preserved.

The actual component/styles passed browser checks in light/dark themes at
desktop and compact widths, including history/add callbacks, retry save and
read-only/conflict gating. Manager typecheck, scoped ESLint and formatting
passed; all 15 existing autosave/session tests passed. Loading review: no new
dependencies, effects, requests or media initialization; lazy dialog imports,
player path and autosave lifecycle remain unchanged.
