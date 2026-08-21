---
id: "feat-408"
title: "Manager dark legacy foreground aliases"
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
  - "accessibility"
---

## Problem

Legacy Manager components still consume `--color-ink` and related aliases.
The design-system shell defines those aliases for light mode on the body, so
dark mode can render labels such as `Dry-run report` as black on a dark panel.

## Entry Points - Read These First

1. `apps/manager/src/app/globals.css` - legacy and design-system token bridges.
2. `apps/manager/src/features/agents/automation-run-history.tsx` - affected
   dry-run disclosure.

## Grep These

- `--color-ink`
- `body.coverage-standalone:has(.design-system-eleven)`
- `.agents-run-report summary`

## What To Build

1. Map legacy foreground and panel aliases to semantic dark tokens when the
   design-system shell is in dark mode.
2. Preserve the existing light-theme aliases unchanged.
3. Verify the dry-run disclosure and its surrounding history remain readable.

## Constraints

- Do not change automation behavior or disclosure semantics.
- Keep the compatibility mapping scoped to dark design-system shells.
- Reuse existing semantic tokens; do not introduce new palette values.

## Verification

- `prettier --check` passed for the stylesheet and roadmap tickets.
- Manager TypeScript validation passed with `tsc --noEmit`.
- Focused automation run-history tests passed.
- The live local Agents screen was checked in dark mode: the collapsed summary
  resolved to `#f0eeeb`, and the expanded report uses semantic ink and muted
  tokens for values and labels.
- The CSS-only compatibility mapping does not alter rendering logic, hydration,
  routing, media, or client initialization paths.
