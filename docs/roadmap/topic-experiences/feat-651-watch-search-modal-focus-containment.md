---
id: "feat-651"
title: "Watch search modal focus containment"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "watch"
  - "web"
  - "search"
  - "accessibility"
---

## Problem

The Watch search overlay exposes header controls outside its dialog, allows
background header controls to remain interactive, and does not restore focus to
the control that opened it. A nested language picker must close before Escape
closes the modal.

## What To Build

1. Keep the modal controls, including close, inside the dialog.
2. Make the background page and floating header inert while the modal is open.
3. Keep Tab and Shift+Tab within dialog controls and restore focus to the exact
   trigger after the close transition.
4. Let Escape close an open nested language picker before closing search.

## Verification

- Add automated keyboard and focus-return regression coverage.
- `pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Focused ESLint and Prettier for changed files.
- Manual desktop NVDA/VoiceOver and 320px viewport smoke before merge.
