---
id: "feat-817"
title: "Keep the Studio editor inside the sidebar boundary"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Problem

The editor's `margin: -12px -16px 0` assumes a padded page wrapper, but
`studio-shell-content` is unpadded. Its toolbar and timeline overlap the primary
sidebar by 16px and extend past the right edge of the content area.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/studio.css` — `.nle-editor`.
2. `apps/manager/src/features/shell/manager-shell.tsx` — shell content and sidebar.
3. `apps/manager/src/app/globals.css` — `.studio-shell-content` and shell grid.

## Grep These

- `nle-editor|studio-shell-content|design-system-shell-main`

## What To Build

Remove the editor's negative outer margin and allow its flex container to shrink
inside the shell. Keep the sidebar and its collapse behavior unchanged.

## Constraints

CSS layout correction only. Preserve preview mounting, timeline behavior, media
requests, palette and editor state.

## Verification

Measure the editor and toolbar bounds against the main column with the primary
sidebar expanded and collapsed. Compare the actual shell/editor styles before
and after at desktop widths. Check formatting and diff whitespace. Verify added
CSS cost and absence of added JavaScript or resource requests.

## Verification Evidence

A browser layout diagnostic using the actual shell and editor styles measured
expanded-sidebar main bounds at x=252–1265. Before the fix the editor occupied
x=236–1281; after the fix it occupies x=252–1265, with the toolbar inset at x=253.
Collapsed-sidebar main and editor bounds both occupy x=88–1265.
The live remote preview serves the corrected CSS. Prettier and diff checks pass.
Compressed editor CSS decreased from 3,272 to 3,261 bytes; no JavaScript, media,
render timing, or request changes were introduced.

## Durable Layout Guidance

The Studio route renders directly inside the unpadded `studio-shell-content`.
Do not use negative margins to compensate for a page wrapper on this route;
the outer editor must respect the main grid column in both sidebar states.
