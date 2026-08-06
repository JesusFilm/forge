---
id: "feat-337"
title: "Watch search close focus restoration"
owner: "codex"
priority: "P2"
status: "not-started"
start_date: "2026-08-05"
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

When keyboard users close floating Watch search with Escape, focus currently
falls back to `<body>` instead of returning to the `Search videos` launcher.
The modal closes and resets correctly, but the lost focus position makes the
next keyboard action ambiguous.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - shared search open,
   close, and launcher ownership.
2. `apps/web/src/components/SearchOverlay.tsx` - full-controller Escape path.
3. `apps/web/src/components/SearchOverlayInstantShell.tsx` - cold first-open
   Escape path.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - search
   focus, close/reset, and lazy-handoff coverage.

## What To Build

- Keep a stable launcher ref across the instant shell and full controller.
- Return focus to the visible search launcher after the closing transition.
- Preserve query reset, modal playback pause ownership, and logo-close behavior.
- Cover Escape from both cold and warm search states.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- At `http://127.0.0.1:3010/watch`, activate `Search videos` with the keyboard,
  close with Escape, and verify `document.activeElement` is the launcher after
  the 200 ms closing transition.
