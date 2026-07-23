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
2. Preserve the existing copy, links, separators, and footer layering.
3. Add focused regression coverage for the three-column contract.

## Constraints

- Do not change footer destinations or localized labels.
- Do not change the footer's sticky-player stacking layer.
- Keep the three columns usable within compact viewport widths, long-label
  locales, and both LTR and RTL directions.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/__tests__/WatchHomeFooter.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke at a compact viewport confirms all three groups are adjacent.

## Completion Notes

- Replaced the compact stacked contact layout with a three-column grid and
  allowed long localized labels to wrap within their tracks while preserving
  the existing desktop width, separators, copy, and links.
- Used logical inline borders and padding so separators remain between columns
  in both LTR and RTL locales.
- Added focused component coverage for the three-column layout contract.
- Focused tests, Web typecheck, targeted ESLint, Prettier, and browser
  verification passed. At a 375px browser content width, all three columns
  shared the same row, the page had no horizontal overflow, and no browser
  errors were reported.
