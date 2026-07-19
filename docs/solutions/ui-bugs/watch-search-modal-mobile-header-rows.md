---
title: Watch search modal mobile header rows
date: 2026-07-17
category: ui-bugs
module: watch-web-search
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "The search field was squeezed and its placeholder clipped on narrow screens."
  - "The logo, search, language, and close controls competed for one mobile row."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - "watch"
  - "search-modal"
  - "responsive-layout"
  - "mobile"
  - "cold-open"
---

# Watch search modal mobile header rows

## Problem

The open Watch search modal placed its logo, search field, language control,
and close control in one row at every breakpoint. On phone-width screens this
squeezed the search field enough to clip its placeholder and weaken the control
hierarchy.

## Symptoms

- The search field lost useful width on narrow screens.
- The globe/language code and close control crowded the field.
- A layout change applied to only one overlay phase could visibly shift during
  a cold first open.

## What Didn't Work

- Keeping the desktop flex row on mobile and relying on the search field to
  shrink cannot guarantee usable space for all four controls.
- Styling only the loaded overlay is incomplete because the persistent header
  owns the interactive chrome while the instant shell owns the first input
  shown during lazy loading.

## Solution

Define one shared modal-header layout contract and apply it to the persistent
header, instant shell, and loaded overlay:

```ts
export const FLOATING_MODAL_HEADER_LAYOUT_CLASS =
  "grid h-[108px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[44px_52px] items-start gap-3 md:flex md:h-[52px] md:gap-5"
export const FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS =
  "col-start-1 row-start-2"
export const FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS =
  "row-start-2 self-center md:self-auto"
export const FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS =
  "row-start-1 justify-self-end md:self-auto"
```

On mobile, the logo and close control occupy the first row while the search
field and language control occupy the second. At `md` and wider, the same
contract returns to the existing single-row flex layout. When no language
control is present, the field spans both grid columns.

The persistent header remains the owner of the interactive logo, language, and
close controls. The instant and loaded overlays mirror those slots and place
their input in the same field cell.

## Why This Works

All three render phases now derive geometry from the same constants, so their
columns, row heights, gaps, and desktop breakpoint cannot drift independently.
CSS handles the breakpoint without adding viewport state, effects, hydration
work, or another source of layout timing.

## Prevention

- Treat persistent chrome, lazy instant shells, and loaded overlays as one
  responsive layout contract when they visually compose a single header.
- Cover both language-present and language-absent slot placement in component
  tests.
- Verify the cold first-open path at a phone viewport and the settled desktop
  breakpoint, including autofocus, close/reopen behavior, and console errors.

## Related Issues

- `docs/roadmap/platform/feat-256-watch-mobile-search-header-rows.md`
