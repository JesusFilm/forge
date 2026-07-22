---
id: "feat-292"
title: "Refine Watch promotional text styling"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "experiences"
  - "web"
  - "watch-page"
---

## Problem

The promotional Experience text block renders horizontal and vertical gradient
rules beside its left-column heading. These ray-like decorations distract from
the authored content on the Watch homepage.

## Entry Points — Read These First

1. `apps/web/src/components/sections/Text.tsx` — promotional text variant layout and decorative rules.
2. `apps/web/src/components/sections/Text.test.tsx` — server-rendered promotional text coverage.

## Grep These

- `rg -n 'bg-linear-to-r|bg-linear-to-b|data-variant="promotional"' apps/web/src/components/sections/Text.tsx`
- `rg -n 'Text promotional Markdown' apps/web/src/components/sections/Text.test.tsx`

## What To Build

1. Remove the horizontal and vertical decorative gradient rules from the promotional text heading column.
2. Reduce the promotional heading size at desktop breakpoints.
3. Preserve the promotional block content, responsive grid, and right-column list markers.
4. Add regression coverage for the heading scale and removed decorations.

## Constraints

- Do not alter authored text or Markdown rendering.
- Do not remove list-item dashes in the content column.
- Do not change other Experience block variants.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/Text.test.tsx`
- Render the Watch homepage and confirm the promotional block has no horizontal or vertical rays on its left side.
