---
title: Manager global .grid gap overrides Tailwind gap utilities
date: 2026-10-30
category: ui-bugs
module: manager-shell
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - A Manager element with the Tailwind `grid` class ignores `gap-*` utilities and renders 16px gaps.
  - Tailwind sizing utilities on Studio shell controls are overridden by plain `globals.css` selectors.
root_cause: config_error
resolution_type: code_fix
severity: low
related_components:
  - frontend
tags:
  - manager
  - tailwind
  - css-cascade
  - studio-shell
---

# Manager global .grid gap overrides Tailwind gap utilities

## Problem

`apps/manager/src/app/globals.css` declares an unlayered legacy rule:

```css
.grid {
  display: grid;
  gap: 16px;
}
```

Tailwind v4 emits its utilities inside `@layer utilities`, and unlayered
styles always win over layered ones regardless of specificity or order. Any
Manager element that uses the `grid` class therefore keeps `gap: 16px` even
when it also has `gap-0.5`, `gap-2` and so on. The same precedence applies to
every plain selector in `globals.css` (for example the collapsed-rail
`.design-system-shell-sidebar:has(...) .studio-product-switch-trigger` rules),
which override Tailwind width, height and padding utilities on the same node.

## Fix

- For stacked lists, use `flex flex-col gap-*` instead of `grid gap-*`
  (feat-910's Studio product switcher option list does this).
- When a layout needs grid, set the gap in a `globals.css` rule for that
  component class rather than with a Tailwind utility.
- Use the unlayered precedence deliberately for responsive or collapsed-state
  overrides of Tailwind-styled shell controls, and keep those rules scoped to
  a component class such as `.studio-product-switch*`.

## Prevention

Grep `grep -n "^\.grid {" apps/manager/src/app/globals.css` before relying on
Tailwind `gap-*` with the `grid` class in Manager. Removing the legacy rule
would change spacing across existing Manager pages, so treat that as its own
scoped change.
