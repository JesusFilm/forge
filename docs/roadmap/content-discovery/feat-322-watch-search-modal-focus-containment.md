---
id: "feat-322"
title: "Watch search modal focus containment"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-28"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "modal"
  - "accessibility"
---

## Problem

The Watch search modal lazily replaces its instant shell with the loaded search
overlay. The loaded overlay contained a Tab trap, but the instant shell did
not, so keyboard focus could leave the visible modal before the controller was
ready.

## Entry Points - Read These First

1. `apps/web/src/components/SearchOverlay.tsx` - loaded modal overlay.
2. `apps/web/src/components/SearchOverlayInstantShell.tsx` - lazy-loading
   modal surface.
3. `apps/web/src/components/FloatingSearchProvider.tsx` - persistent header
   controls that remain part of the modal interaction.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   focused modal keyboard regression coverage.

## Grep These

- `floating-header-logo`
- `floating-header-search-close`
- `SearchOverlayInstantShell`
- `useSearchModalFocusContainment`

## What To Build

1. Share one focus-containment hook between the instant and loaded modal
   surfaces.
2. Keep the persistent header's logo, language control, and close button in
   the same Tab sequence as the active overlay.
3. Retain containment through the close animation while the modal is visible.
4. Add regression tests for forward and reverse Tab wrapping in both render
   phases.

## Constraints

- Keep the existing global search modal; do not add a search route.
- Do not change search data loading, language selection, or close/reset
  behavior.
- Do not add page-load network requests, timers, or dependencies.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web exec tsc --noEmit --pretty false`
- `pnpm --filter @forge/web lint`
- `pnpm --filter roadmap generate:readme`
