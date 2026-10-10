---
id: "feat-288"
title: "Watch promotional text heading alignment"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
---

## Problem

In the two-column promotional Text block, the right-side Markdown heading starts
above the left-side authored heading because the left column also contains a
divider and eyebrow. The eyebrow also sits too low beneath the divider.

## Entry Points

1. `apps/web/src/components/sections/Text.tsx`
2. `apps/web/src/components/sections/Text.test.tsx`

## What To Build

Place the left authored heading and the first right-side promotional heading in
the same desktop grid row. Keep the divider and eyebrow above that row and move
the eyebrow higher by reducing the divider's bottom spacing. Preserve the
existing stacked mobile flow and Markdown rendering. Keep the stacked layout at
tablet widths and introduce the two-column composition at 1280px, where both
columns have enough room for the promotional typography. Do not render a line
separator between the heading and body in the stacked layout.

## Verification

- `node_modules/.bin/vitest run src/components/sections/Text.test.tsx`
- ESLint, Prettier, and `git diff --check` for the touched files.

## Completion Evidence

- Focused Text component Vitest: 4 tests passed.
- The authored heading and promotional Markdown column both occupy desktop grid
  row 2, while the divider and eyebrow occupy row 1.
- Reduced the divider bottom margin from `mb-7` to `mb-4`, moving the eyebrow
  12px higher.
- Responsive browser proof confirmed the section stays stacked at 390px and
  1024px, switches to two columns at 1280px, and has no horizontal overflow at
  any tested width. At 1280px and 1440px, the two heading top edges had an exact
  0px delta.
- Browser screenshots: `output/playwright/watch-promotional-responsive-mobile.png`,
  `output/playwright/watch-promotional-responsive-tablet.png`, and
  `output/playwright/watch-promotional-responsive-wide.png`.
- Removed the pre-existing stacked-layout top border from the Markdown column
  so the responsive breakpoint change does not introduce an unrequested line
  separator at tablet or mobile widths.
- ESLint, Prettier, and `git diff --check` passed.
