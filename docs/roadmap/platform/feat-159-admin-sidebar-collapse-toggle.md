---
id: "feat-159"
title: "Admin Sidebar Collapse Toggle"
owner: "ekkasit"
priority: "P2"
status: "in-progress"
start_date: "2026-05-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
---

## Problem

The Forge Admin desktop sidebar is always open on large screens. In dense
editorial routes such as `/dashboard/experiences/[id]`, that permanently
reserved width competes with the AI chat panel and editor canvas. Editors need a
simple way to hide the sidebar and bring it back without navigating away.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/components/admin-shell.tsx`
4. `apps/admin/src/components/admin-shell.test.tsx`
5. `docs/plans/2026-05-10-002-feat-admin-sidebar-collapse-toggle-plan.md`

## Grep These

- `ShellSidebarContent` in `apps/admin/src/components/admin-shell.tsx`
- `xl:ml-[240px]` in `apps/admin/src/components/admin-shell.tsx`
- `Close navigation` in `apps/admin/src/components/admin-shell.tsx`
- `left-[240px]` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`

## What To Build

1. Add an upper-right close control to the desktop sidebar header.
2. Hide the fixed desktop sidebar when that control is clicked.
3. Shift the main content wrapper left when the sidebar is hidden.
4. Add a top-bar show-sidebar control while the desktop sidebar is hidden.
5. Preserve mobile drawer behavior and existing nav visibility rules.
6. Scope the experience editor's bottom gradient/toolbar to the canvas so it
   does not overlap the AI Chat panel when the sidebar is hidden.

## Constraints

- Keep scope inside `apps/admin`.
- Do not change nav data, route definitions, permissions, or shell i18n shape.
- Reuse existing admin shell colors, radii, spacing, and lucide icons.
- Do not persist sidebar state in this pass.

## Verification

- `pnpm --filter @forge/admin test -- src/components/admin-shell.test.tsx`
- `pnpm --filter @forge/admin exec eslint src/components/admin-shell.tsx src/components/admin-shell.test.tsx`
- Browser smoke: open `/dashboard/experiences/[id]?locale=en`, click the sidebar close button, confirm the sidebar hides and the editor area expands; click the top-bar show button and confirm the sidebar returns.
