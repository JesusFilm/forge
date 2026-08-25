---
id: "feat-409"
title: "Manager dark sidebar depth"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on:
  - "feat-406"
blocks:
  - "feat-410"
tags:
  - "platform"
  - "manager"
  - "design-system"
  - "navigation"
---

## Problem

The Manager dark-mode sidebar needs its own surface rather than the muted panel
token. An initial near-black value was too dark; the navigation should match the
user-supplied `#141414` swatch while retaining clear selected and hover states.

## Entry Points - Read These First

1. `apps/manager/src/app/globals.css` - dark tokens and shell sidebar styles.
2. `apps/manager/src/features/shell/manager-shell.tsx` - sidebar structure.

## Grep These

- `--ds-panel-muted`
- `.design-system-shell-sidebar`
- `.design-system-shell-nav a.is-active`

## What To Build

1. Add a semantic sidebar surface token that preserves the current light theme.
2. Match the dark sidebar surface to the supplied `#141414` swatch.
3. Verify the rail remains distinct from the workspace and that navigation,
   selected items, and report controls remain readable.

## Constraints

- Do not change navigation structure or behavior.
- Preserve the existing light-theme sidebar appearance.
- Reuse existing text, border, hover, and selection tokens.

## Verification

- `prettier --check` passed for the stylesheet and roadmap tickets.
- Manager TypeScript validation passed with `tsc --noEmit`.
- Focused shell tests passed.
- The live local coverage screen was visually checked in dark mode: the sidebar
  resolved to the supplied `#141414`, and the selected navigation surface to
  `#2a2927` with the semantic ink color.
- The light token aliases the previous muted-panel surface, preserving the
  existing light-theme sidebar.
- The token-only presentation change does not alter rendering logic, hydration,
  routing, media, or client initialization paths.
