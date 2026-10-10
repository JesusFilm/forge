---
id: "feat-257"
title: "Watch logo route destination"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "navigation"
---

## Problem

The shared Watch header logo always routes to the Watch home page. On the
Watch home page itself, the logo should instead return viewers to the parent
Jesus Film Project website, while inner Watch pages should continue using the
logo as a route back to Watch home.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - shared floating
   header, current logo link, and base-path-stripped `usePathname()` value.
2. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   floating header rendering and mocked pathname coverage.
3. `apps/web/src/lib/routes.ts` - Watch pathname classification, including
   root and localized-home routes.

## Grep These

- `floating-header-logo`
- `usePathname`
- `parseWatchPath`
- `localized-home`

## What To Build

1. Classify the current base-path-stripped Watch pathname.
2. Link the logo to `https://www.jesusfilm.org/` on root and localized Watch
   home routes.
3. Keep the logo linked to the base-path-aware Watch root on all inner routes.
4. Add focused regression coverage for home and inner-page destinations.

## Constraints

- Keep the change inside `apps/web` apart from this roadmap ticket.
- Preserve the existing logo image, sizing, accessibility label, header
  motion, and search-reset behavior.
- Do not add a network request, effect, or new client-side initialization.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Confirm the change adds only a pathname-derived link choice and therefore
  does not add work to the page-loading path.

## Completion Notes

- The shared header now classifies its existing base-path-stripped pathname.
  Root and localized Watch-home routes link the logo to the parent Jesus Film
  Project website; inner Watch routes retain the base-path-aware `/watch`
  destination.
- Added regression coverage for root home, localized home, and an inner video
  route; the focused suite passed all 45 tests.
- Web TypeScript typecheck and focused ESLint validation passed. Full-worktree
  lint in the isolated Windows checkout was not usable because Git converted
  untouched source files to CRLF; the two touched TypeScript files were
  normalized with Prettier before focused lint.
- The change adds no fetch, effect, hydration branch, or client-side
  initialization beyond classifying the pathname already used by the header.
