---
id: "feat-651"
title: "Watch search modal focus containment"
owner: "codex"
priority: "P1"
status: "complete"
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

## Resolution

2026-10-20: main merged into the branch (no rebase). Checked in a real
browser (headless Chromium, local fixture with the real header and
overlay, search responses replayed from production):

- Opening with Enter on the header search button moves focus to the
  input, including the first lazy open.
- Tab and Shift+Tab stay inside the dialog in the browse, suggestions,
  results, fallback-results and error states (8–25 presses each).
- Escape closes the nested search-language picker first and returns focus
  to its trigger; a second Escape closes search.
- Closing returns focus to the header search button.
- The instant shell shown before the overlay code loads now has its own
  close button and keeps Tab between its two controls, because the header
  is inert while search is open.

Not run: NVDA/VoiceOver, real devices.

## October 29 current-main verification

Updated against main a672f688b; 186 provider tests pass. Chromium checks at
320, 390 and 1280px confirm first lazy-open focus, 24 forward/backward Tab
steps inside the dialog, inert header, no horizontal page overflow, and Escape
returning focus to the exact search opener. At 320px the input is 260px wide.
These checks start after provider hydration and still exercise a cold overlay.
Combined loading validation and exact-head CI remain release gates; this is
prepared code, not a claim that the PR has merged.
