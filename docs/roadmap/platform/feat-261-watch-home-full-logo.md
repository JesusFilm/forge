---
id: "feat-261"
title: "Watch home full Jesus Film Project logo"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-15"
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

The shared Watch header uses the compact Jesus Film sign on every route. The
Watch homepage should show the full Jesus Film Project ministry logo, while
inner Watch pages should retain the compact sign and its existing layout.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - shared floating
   header, route classification, logo asset, and responsive sizing.
2. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - route
   and header rendering coverage.
3. `apps/web/public/images/jesus-film-logo-full.svg` - tracked full vector logo
   matching the official `JFP-RED.svg` mark on `jesusfilm.org`.
4. `apps/web/public/images/jesusfilm-sign.svg` - existing compact inner-page
   mark.

## Grep These

- `floating-header-logo`
- `jesusfilm-sign.svg`
- `jesus-film-logo-full.svg`
- `localized-home`

## What To Build

1. Render the full tracked SVG on root and localized Watch-home routes.
2. Keep the compact SVG and current sizing on every inner Watch route.
3. Give the full logo a responsive route-specific slot so it remains legible
   without crowding the mobile search and trailing controls.
4. Keep the search overlay field aligned with the route-specific logo slot.
5. Add focused regression coverage for root home, localized home, and inner
   route variants.

## Constraints

- Use the tracked SVG vector asset; do not introduce a raster replacement or a
  runtime request to `jesusfilm.org`.
- Preserve the logo link destinations, accessibility label, search reset,
  floating-header motion, and inner-page compact-logo dimensions.
- Do not add client initialization or page-load network work.
- Preserve unrelated in-progress changes in the shared header and tests.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke root/localized home and an inner Watch page at mobile and
  desktop widths.
- Confirm the change only selects a bundled SVG and CSS classes from the
  already-parsed pathname, with no new request or initialization path.

## Completion Notes

- Root and localized Watch-home routes now render the tracked full Jesus Film
  Project SVG in a responsive route-specific slot; inner routes retain the
  existing compact sign, dimensions, and Watch-home destination.
- Both the instant and fully loaded search overlays reserve the same logo width
  as the closed header, preventing a home-only alignment jump.
- Added focused assertions for the full root/localized-home variant, its
  official 139:36 SVG dimensions, overlay alignment, and the unchanged compact
  inner-route variant.
- TypeScript syntax transpilation, scoped Prettier validation, and
  `git diff --check` pass. Local browser smoke returned 200 for the homepage
  with the full SVG and for an inner page with the compact SVG. Focused Vitest
  and package typecheck/lint could not run because the worktree's existing
  dependency tree was incomplete; no package or lockfile change was made.

