---
id: "feat-501"
title: "Watch header visual alignment"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "branding"
---

## Problem

The full Jesus Film Project logo on Watch home appears inset from the shared
content rail. Its visible left edge should align with the left edge of the
section text below it without changing the compact inner-page logo. The
adjacent Library label is also visually larger than the EN language code even
though both are peer header labels. In short landscape viewports, the trailing
controls can overflow their grid track and no longer share the content rail's
right edge.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - shared floating
   header and route-specific logo rendering.
2. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - home
   and inner-route logo coverage.
3. `apps/web/src/lib/content-width.ts` - shared Watch content and header edges.

## Grep These

- `floating-header-logo`
- `isWatchHome`
- `WATCH_PAGE_LEFT_EDGE_CLASSES`
- `WATCH_PAGE_CONTENT_CLASSES`

## What To Build

1. Optically align the full Watch-home ministry logo with the content rail's
   left edge.
2. Keep the compact inner-page logo at its existing position.
3. Match the Library label's type size, weight, tracking, and capitalization to
   the language-code label while preserving both icons.
4. Let the search track contract around the intrinsic header controls and keep
   the trailing controls on the content rail's right edge.
5. Keep the same responsive content edges in compact landscape instead of
   replacing them with viewport gutters.
6. Pin the alignment, flexible grid, and label typography in focused tests.

## Constraints

- Preserve search behavior and the trailing header controls.
- Preserve logo assets, destinations, responsive sizes, and search behavior.
- Keep the correction CSS-only so it adds no rendering, hydration, or network
  work.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke Watch home and an inner Watch route at mobile and desktop
  widths.
- Confirm no new page-loading resources or client initialization paths.

## Completion Notes

- The floating header now keeps the shared content-rail edges in compact
  landscape, aligning the home logo and trailing language control with page
  content.
- Intrinsic outer grid tracks let the middle search field contract before the
  Library and language controls can overflow.
- Library now uses the same responsive font size, weight, tracking, and
  uppercase treatment as the language code.
- Chromium measurement at 944px wide confirmed a 64px left edge. The EN
  control uses an optical offset that accounts for both its inner padding and
  the label's trailing letter-spacing; raster inspection confirms the painted
  N reaches the 880px guide while the search remains flexible.
- Focused tests, typecheck, lint, formatting, and diff checks pass. The local
  browser used CI fixture data, whose expected blocked remote media requests
  produced unrelated 403 console messages.
