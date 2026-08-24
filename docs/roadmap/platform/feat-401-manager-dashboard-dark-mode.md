---
id: "feat-401"
title: "Manager dashboard dark mode"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-20"
duration: 1
depends_on: []
blocks:
  - "feat-406"
tags:
  - "platform"
  - "manager"
  - "design-system"
  - "accessibility"
---

## Problem

The Manager dashboard only renders its light design-system palette. Operators
working in low-light environments cannot select a darker interface, and the
dashboard does not honor the operating-system color-scheme preference.

## Entry Points - Read These First

1. `apps/manager/src/app/layout.tsx` - root document and pre-hydration setup.
2. `apps/manager/src/app/globals.css` - Manager design-system color tokens and
   dashboard shell surfaces.
3. `apps/manager/src/features/shell/manager-shell.tsx` - persistent dashboard
   shell and top-bar controls.

## Grep These

- `design-system-eleven`
- `--ds-bg`
- `--ds-panel`
- `design-system-topbar-actions`
- `TOPBAR_ICON_BUTTON_CLASS`

## What To Build

1. Add light and dark Manager design-system token sets without changing the
   existing brand accent and status semantics.
2. Resolve the first visit from `prefers-color-scheme` before hydration and
   persist an explicit operator choice locally.
3. Add an accessible light/dark switch to the top-right user menu.
4. Replace shell-only hard-coded light surfaces with existing design-system
   tokens so the sidebar, navigation, menus, and content switch together.
5. Add focused tests for preference resolution and theme-control markup.

## Constraints

- Keep theme state client-local; do not add an API, account setting, or new
  runtime dependency.
- Do not change dashboard routing, authentication, data fetching, or polling.
- Preserve the Jesus Film red brand accent and semantic success/danger colors.
- Avoid a light-theme flash when the saved or system preference is dark.

## Verification

- Thirteen focused Manager theme, shell, and client-lifecycle tests pass.
- Manager typecheck and changed-file lint pass with no warnings.
- An authenticated local runtime smoke returns the dashboard successfully and
  includes the pre-hydration initializer and accessible theme control.
- A warm local dashboard response completes in about 34 ms; the change adds no
  network request and no new production dependency.
- Visual browser QA covered the dashboard in light and dark themes, the user
  menu switch and saved-choice reload behavior, plus the Jobs and Smart Crop
  workflows; no application-origin console errors were reported in the clean
  verification run.
