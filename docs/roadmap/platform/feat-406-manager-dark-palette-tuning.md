---
id: "feat-406"
title: "Manager dark palette tuning"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-20"
duration: 1
depends_on:
  - "feat-401"
blocks:
  - "feat-407"
  - "feat-408"
  - "feat-409"
  - "feat-410"
tags:
  - "platform"
  - "manager"
  - "design-system"
  - "accessibility"
---

## Problem

The first Manager dark-mode palette is not dark enough, and its coverage status
reds and greens are visually harsh. The initial tuning pass fixed those issues
but made the neutral ramp feel cold. A later pass overcorrected toward brown;
the dashboard should retain its depth with an almost-neutral charcoal that has
only a subtle warm bias.

## Entry Points - Read These First

1. `apps/manager/src/app/globals.css` - dark theme and coverage semantic colors.
2. `docs/roadmap/platform/feat-401-manager-dashboard-dark-mode.md` - original
   dark-mode scope and verification.

## Grep These

- `:root[data-theme="dark"]`
- `.stat-segment--human`
- `.stat-segment--none`
- `.tile--human`
- `.tile--none`

## What To Build

1. Move dark backgrounds and panels toward deep, near-neutral warm charcoal
   without a visible brown cast.
2. Add coverage semantic variables that preserve current light-theme colors.
3. Override coverage green, red, and supporting purple with calmer dark-theme
   values across bars, legends, tiles, checkboxes, and numeric summaries.
4. Verify state distinction and text legibility in both themes.

## Constraints

- Do not change light-theme rendering.
- Keep success, none, and AI states visually distinct without relying on fill
  color alone.
- Do not change coverage behavior, data, or interaction semantics.

## Verification

- `prettier --check` passed for the stylesheet and roadmap ticket.
- Manager TypeScript validation passed with `tsc --noEmit`.
- Focused shell and coverage tests passed (19 tests across 4 files).
- Dark text and status-label contrast against the new background is at least
  6.16:1; the palette-only change does not alter rendering, hydration, routing,
  media, or client initialization paths.
- The live local coverage screen was refreshed and visually checked in dark
  mode; computed tokens matched the near-neutral charcoal ramp.
