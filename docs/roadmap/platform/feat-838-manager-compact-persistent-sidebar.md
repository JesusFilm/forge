---
id: "feat-838"
title: "Compact and persistent Manager navigation"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [platform, manager, navigation]
---

## Scope

Reduce the collapsed Manager sidebar from 88px to 56px with compact icon spacing.
Remember expanded/collapsed preference across navigation and browser visits. Read
its cookie in the server layout so the initial HTML already has the correct width.
Keep the responsive mobile navigation and expanded layout intact.

## Entry points

- `apps/manager/src/features/shell/manager-shell.tsx`
- `apps/manager/src/app/dashboard/layout.tsx`
- `apps/manager/src/app/globals.css`

## Verification

Check narrow rail geometry, usable icons, expansion and persistence on reload;
check initial rendered markup and loading behavior. Run scoped lint, formatting
and Manager typecheck.

## Result and validation

- Collapsed rail is 56px (was 88px), with 36px navigation targets, 4px
  vertical gaps and 6px side padding. Icon links retain accessible names and
  now expose native hover titles.
- One-year, same-origin `manager-sidebar` cookie stores both states. Dashboard
  and design server entry points read it before rendering; the existing native
  checkbox remains uncontrolled, avoiding a new hydration effect or request.
- Actual shell component browser verification with server rendering: expanded
  252px, collapsed 56px, all eight navigation targets 36x36px; both preferences
  survive reload and match server markup. No horizontal overflow.
- Loading check in the isolated actual-component harness: expanded DOM/load
  450/461ms, collapsed 250/256ms (cache variation; not an improvement claim).
  No layout-shift entries observed; preference loading adds no fetch. Actual
  remote Next preview font returns 200 and HMR WebSocket opens.
- Seven existing shell/design tests pass. Scoped ESLint, Manager typecheck,
  formatting and diff whitespace checks pass.

## Durable guidance

Keep collapsed grid width and `--studio-sidebar-offset` synchronized: fixed
shell overlays consume that offset. Read persisted layout preferences in the
server entry point to avoid shifting the workspace after hydration.
