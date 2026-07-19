---
id: "feat-256"
title: "Watch mobile search header rows"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "search"
  - "responsive"
---

## Problem

The open Watch search modal keeps the logo, search field, language code control,
and close control on one narrow mobile row. The search field is squeezed and
its placeholder clips instead of using the available width below the compact
modal controls.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - persistent Watch
   header that owns the logo, language control, and modal close control.
2. `apps/web/src/components/SearchOverlay.tsx` - loaded search overlay whose
   field must align with the persistent header controls.
3. `apps/web/src/components/SearchOverlayInstantShell.tsx` - cold-open shell
   that must use the same geometry before the loaded overlay replaces it.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   existing header alignment, cold-open, focus, and language-slot coverage.

## Grep These

- `floating-header-language-button`
- `floating-header-search-close`
- `search-overlay-top-bar`
- `search-overlay-instant-top-bar`
- `FLOATING_HEADER_TRAILING_GROUP_CLASS`

## What To Build

1. On viewports below the existing `md` breakpoint, put the logo and modal
   close control on the first row.
2. Put the search field and globe/language-code control on the second row,
   allowing the field to consume the remaining row width.
3. Keep the existing single-row header at `md` and above.
4. Apply identical placement to the instant shell and loaded overlay so cold
   open does not jump when metadata finishes loading.
5. Add focused regression coverage for responsive row placement.

## Constraints

- Do not change search behavior, language selection, autofocus, modal focus
  order, metadata loading, or request caching.
- Keep the persistent header as the owner of logo, language, and close controls.
- Preserve safe-area offsets and the existing desktop header geometry.
- Do not add JavaScript viewport measurement or a new dependency.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Cold-open browser smoke at a narrow mobile viewport confirms row one is logo
  plus close, row two is search plus the visible language code, and the loaded
  overlay does not shift those controls.

## Completion Notes

- Added shared responsive placement classes for the persistent header, instant
  shell, and loaded overlay. Mobile uses two aligned rows, while `md` and wider
  retain the original single-row header.
- Kept the field full-width when the language control is absent and preserved
  existing autofocus, close/reopen, focus ownership, and metadata behavior.
- Focused tests passed (43 tests), along with web typecheck, lint, formatting,
  and `git diff --check`.
- Browser verification passed at 390 x 844 with zero-pixel center alignment on
  both rows, 12-pixel row/control gaps, retained search autofocus, and no
  console errors. A settled 1024 x 768 check confirmed all desktop controls
  remain on one centered row.
