---
id: "feat-252"
title: "Watch header control overlap"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-07-14"
duration: 1
depends_on:
  - "feat-245"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "responsive"
  - "accessibility"
---

## Problem

Production Watch can render the floating-header language and account controls
on top of each other at narrow viewport widths. The regression coincides with
feat-245 widening the globe control to include the active language code, while
the adjacent account control and mirrored search-header geometry retained the
earlier fixed-icon slot assumptions.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - persistent Watch
   header, language button, account control, and search-close state.
2. `apps/web/src/lib/content-width.ts` - shared floating-header slot and gap
   constants.
3. `apps/web/src/components/SearchOverlay.tsx` and
   `apps/web/src/components/SearchOverlayInstantShell.tsx` - mirrored trailing
   control placeholders used while search is open.
4. `apps/web/src/components/watch/AccountControl.tsx` - account button sizing.
5. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - current
   class-contract coverage that does not measure rendered separation.

## Grep These

- `FLOATING_HEADER_LANGUAGE_SLOT_CLASS`
- `FLOATING_HEADER_TRAILING_GROUP_CLASS`
- `floating-header-language-button`
- `watch-account-control`
- `search-overlay-trailing-controls-spacer`

## What To Build

1. Reproduce the production overlap and inspect computed button, group, and
   search-field rectangles before editing.
2. Give the language-plus-code and account controls an explicit non-shrinking,
   non-overlapping flex contract at mobile and desktop breakpoints.
3. Keep the persistent header, full search overlay, and instant shell on the
   same trailing-width contract so opening search does not shift the input.
4. Add focused regression coverage and real-browser geometry assertions with
   screenshot proof.

## Constraints

- Do not change language-code derivation, Watch routing, account auth, player
  controls, or search behavior.
- Do not add JavaScript measurement, a dependency, a fetch, or client startup
  work for a CSS layout bug.
- Keep the logo, safe-area positioning, header motion, and focus behavior.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx src/lib/__tests__/content-width.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at 390px and desktop widths proves positive horizontal
  separation, aligned vertical centers, stable search-open geometry, and
  independent keyboard focus for language and account controls.
