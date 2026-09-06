---
id: "feat-452"
title: "Watch search backdrop dismissal"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-03"
completed_date: "2026-09-03"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "accessibility"
---

## Problem

The global Watch search modal can be dismissed with its close control or the
Escape key, but clicking the non-interactive backdrop does not close it. This
leaves a familiar modal interaction missing on both the instant loading shell
and the fully loaded search surface.

## Entry Points — Read These First

1. `apps/web/src/components/SearchOverlay.tsx` — fully loaded search overlay,
   suggestion portal, and content interaction boundaries.
2. `apps/web/src/components/SearchOverlayInstantShell.tsx` — first-frame search
   shell shown while the interactive search controller loads.
3. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` — search
   modal behavior and staged-loading regression coverage.

## Grep These

- `search-overlay-instant-shell`
- `search-overlay-field-shell`
- `search-suggestions-panel`
- `setOpen(false)`

## What To Build

1. Close the search modal when the user clicks its non-interactive backdrop.
2. Preserve clicks inside the search field, results, browse cards, language
   controls, and suggestion panel.
3. Apply the same dismissal behavior to the instant shell and loaded overlay.
4. Add focused regression coverage for backdrop dismissal and protected modal
   content.

## Constraints

- Preserve the existing close animation, Escape behavior, focus trap, and
  provider-owned search reset boundary.
- Do not change search requests, result navigation, or staged chunk loading.
- Do not add document-wide pointer listeners for a modal-owned interaction.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web exec tsc --noEmit --pretty false`
- `pnpm prettier --check apps/web/src/components/SearchOverlay.tsx apps/web/src/components/SearchOverlayInstantShell.tsx apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx docs/roadmap/content-discovery/feat-452-watch-search-backdrop-dismissal.md`

## Completion Notes

- Added backdrop-click dismissal to the instant and fully loaded search
  overlays while preserving the provider-owned close animation and reset.
- Protected the search field, loaded content, suggestion panel, and instant
  placeholder content from bubbling backdrop clicks.
- All 149 focused `FloatingSearchProvider` tests pass; focused TypeScript,
  ESLint, and Prettier checks pass.
- Chrome smoke testing on the local Watch page confirmed that interacting with
  the search field keeps the loaded modal open and clicking the empty backdrop
  clears the query, completes the close animation, and returns to the page.
- The change adds only local click handlers and no imports, effects, requests,
  or initial-load resources, so the search modal's staged-loading behavior and
  page-loading path are unchanged.
