---
id: "feat-310"
title: "Watch header search field width"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "ui"
---

## Problem

The floating Watch header search field grows across nearly all available space
on wide viewports, making the control visually oversized.

## Entry Points

1. `apps/web/src/lib/content-width.ts` - shared floating-header layout classes.
2. `apps/web/src/components/FloatingSearchProvider.tsx` - persistent header.
3. `apps/web/src/components/SearchOverlay.tsx` and
   `apps/web/src/components/SearchOverlayInstantShell.tsx` - opened search
   header states.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   floating-header layout coverage.

## What To Build

1. Cap the floating header search field at `800px`.
2. Preserve fluid sizing below the cap.
3. Keep trailing header controls aligned to the right edge.
4. Preserve the same field width contract while search opens.
5. Center the field against the header viewport rather than the remaining
   space between asymmetric side controls.
6. Keep the opened modal's globe and close controls in a horizontal desktop
   flex row so they do not overlap.

## Constraints

- Do not change search behavior, routing, or data loading.
- Keep the existing responsive mobile layout.
- Do not regenerate GraphQL artifacts.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx src/lib/__tests__/content-width.test.ts
pnpm --filter @forge/web exec tsc --noEmit --pretty false
```
