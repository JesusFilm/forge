---
id: "feat-407"
title: "Manager SEO priority list restyle"
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
  - "seo"
  - "design-system"
---

## Problem

The SEO overview priority queue looks like a stack of large rounded black
cards. Repeated borders, icon boxes, status rails, and arrows make the queue
feel heavier and less scannable than an operator list should.

## Entry Points - Read These First

1. `apps/manager/src/features/seo/seo-workspace.tsx` - priority queue markup.
2. `apps/manager/src/app/globals.css` - `.seo-priority-list` presentation.

## Grep These

- `What needs an operator now`
- `.seo-priority-list`
- `.seo-priority-icon`

## What To Build

1. Present the queue as a responsive two-column action grid instead of a
   full-width row table.
2. Remove boxed icons, left status rails, and oversized row silhouettes.
3. Preserve action affordance, severity color, keyboard focus, and row content.
4. Keep the list readable and compact at Manager breakpoints.

## Constraints

- Do not change queue ordering, navigation, data, or action semantics.
- Keep every row as a keyboard-accessible button.
- Reuse the existing Manager dark-theme tokens.

## Verification

- `prettier --check` passed for the stylesheet and roadmap tickets.
- Manager TypeScript validation passed with `tsc --noEmit`.
- Focused SEO workspace tests passed.
- The local SEO overview was visually checked at the desktop breakpoint: seven
  actions rendered as two equal columns, with the existing narrow breakpoint
  collapsing the grid to one column.
- The CSS-only presentation change does not alter rendering logic, hydration,
  routing, media, or client initialization paths.
