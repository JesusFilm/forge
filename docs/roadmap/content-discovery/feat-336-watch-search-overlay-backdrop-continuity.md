---
id: "feat-336"
title: "Watch search overlay backdrop continuity"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
completed_date: "2026-08-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "responsive"
---

## Problem

The loaded Watch search overlay renders a second near-opaque black backdrop
beginning 14rem above the viewport bottom. That layer creates a sharp
horizontal boundary which makes the full-viewport background blur appear cut
off, even though the modal itself correctly spans the dynamic viewport.

## Entry Points - Read These First

1. `apps/web/src/components/SearchOverlay.tsx` - full loaded overlay and the
   redundant `search-overlay-bottom-backdrop` layer.
2. `apps/web/src/components/SearchOverlayInstantShell.tsx` - cold-open shell
   whose single full-viewport backdrop already renders continuously.
3. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - modal
   chrome regression coverage.

## Grep These

- `search-overlay-bottom-backdrop`
- `bg-black/85`
- `h-dvh`
- `backdropFilter`

## What To Build

1. Remove the redundant bottom backdrop from the loaded search overlay.
2. Keep the existing full-viewport dimming and blur on the dialog root.
3. Preserve search layout, scrolling, instant-shell handoff, and header chrome.
4. Add a regression assertion that the loaded overlay does not reintroduce a
   separate bottom dimming layer.

## Constraints

- Do not change search behavior, request timing, result layout, or scrolling.
- Do not change the instant-shell or persistent header ownership model.
- Do not add viewport measurement JavaScript or browser-specific detection.
- Keep the fix scoped to the redundant visual layer and its regression test.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web exec tsc --noEmit --pretty false`
- `pnpm --filter @forge/web lint`
- Browser-smoke the loaded search overlay at desktop and mobile viewport sizes;
  confirm its blur/dimming remains continuous to the viewport bottom.

## Completion Notes

- Removed the loaded overlay's redundant near-opaque bottom backdrop while
  keeping the dialog root's full-viewport blur and dimming unchanged.
- Updated the focused overlay regression test to reject a separate bottom
  backdrop layer; all 89 focused tests pass.
- Browser verification at 1440 x 900 and 390 x 844 confirmed the overlay spans
  the full viewport, retains `blur(12px)` and `rgba(0, 0, 0, 0.75)`, and has no
  bottom cutoff layer.
