---
id: "feat-304"
title: "Watch footer contact three-column layout"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

The Watch footer stacks its address, phone numbers, and legal links at compact
viewport widths even though these details are intended to read as three
adjacent columns.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeFooter.tsx` - the shared footer and
   contact-information layout.
2. `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx` - focused
   footer layout and layering contracts.

## Grep These

- `100 Lake Hart Drive`
- `watch-footer-contact-grid`
- `privacyPolicy`

## What To Build

1. Render the address, phone numbers, and legal links in a three-column grid at
   every viewport width.
2. Distribute the three columns equally across the footer content width without
   dividers.
3. Keep the Give Now action on the same navigation row from medium viewport
   widths.
4. Preserve the existing copy, links, and footer layering.
5. Add focused regression coverage for the layout contracts.

## Constraints

- Do not change footer destinations or localized labels.
- Do not change the footer's sticky-player stacking layer.
- Keep the three columns usable within compact viewport widths and long-label
  locales.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/__tests__/WatchHomeFooter.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke at a compact viewport confirms all three groups are adjacent.

## Completion Notes

- Replaced the compact stacked contact layout with a full-width, equal
  three-column grid and allowed long localized labels to wrap within their
  tracks while preserving the copy and links.
- Removed the contact-column dividers and kept Give Now on the navigation row
  from medium viewport widths, while allowing long localized navigation labels
  to wrap within that row.
- Added focused component coverage for the three-column layout contract.
- Focused tests, Web typecheck, targeted ESLint, Prettier, and browser
  verification passed. At 840px all nine navigation actions shared one
  centerline and the three divider-free contact columns measured 232px each.
  At 375px the three 107px columns shared one row without horizontal overflow,
  and no browser errors were reported.
