---
id: "feat-264"
title: "Watch search first-open autofocus"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
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

The Watch search input does not reliably receive focus the first time a viewer
opens the modal. The initial click renders `SearchOverlayInstantShell` while
the lazy search controller loads, and that shell only attempts focus from a
delayed effect. Once the controller has loaded, repeat opens use the full
overlay's stronger focus lifecycle and appear to work.

## Entry Points - Read These First

1. `apps/web/src/components/SearchOverlayInstantShell.tsx` - first-open shell
   input and delayed focus effect.
2. `apps/web/src/components/SearchOverlay.tsx` - full overlay focus pattern to
   keep consistent after the controller loads.
3. `apps/web/src/components/FloatingSearchProvider.tsx` - transition from the
   immediate shell to the lazy controller.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - shell,
   full-overlay, and reopen regression coverage.

## Grep These

- `SearchOverlayInstantShell`
- `document.activeElement`
- `focus({ preventScroll: true })`
- `renders the search input shell immediately`

## What To Build

- Focus the instant-shell input as soon as it mounts on the first open.
- Keep a bounded retry for browser/layout timing without depending on that
  retry for the initial focus assertion.
- Preserve focus when the instant shell hands off to the full overlay.
- Add regression coverage that distinguishes a first-ever open from a repeat
  open after the controller has loaded.

## Constraints

- Keep the lazy controller and instant-shell performance architecture.
- Do not change search queries, language metadata loading, modal geometry, or
  close/reset behavior.
- Prevent focus from scrolling the page behind the modal.
- Do not add dependencies or regenerate GraphQL artifacts.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web exec tsc --noEmit --pretty false`
- `pnpm --filter @forge/web lint`
- Browser smoke a cold first open and a close/reopen cycle at desktop and
  mobile widths, confirming `document.activeElement` is the search input.
