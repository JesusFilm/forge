---
title: "Watch search modal focus containment across lazy render phases"
date: "2026-07-28"
category: "ui-bugs"
module: "apps/web Watch search"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Tab could leave the visible search modal while its lazy controller was loading."
  - "The instant shell and loaded overlay had different keyboard behavior."
root_cause: "async_timing"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/SearchOverlay.tsx"
  - "apps/web/src/components/SearchOverlayInstantShell.tsx"
  - "apps/web/src/components/FloatingSearchProvider.tsx"
tags:
  - "watch"
  - "search"
  - "modal"
  - "accessibility"
  - "focus"
---

# Watch search modal focus containment across lazy render phases

## Problem

Watch search shows an instant modal shell while its controller loads, then
replaces that shell with the full search overlay. Only the loaded overlay kept
Tab focus contained, leaving a brief keyboard escape path during the first
render phase.

## Symptoms

- A keyboard user could reach page controls from the visible instant shell.
- Forward and reverse Tab behavior differed before and after the overlay loaded.

## What Didn't Work

Keeping the Tab handler inside `SearchOverlay` covered only the loaded
controller path; the shell is a separate modal DOM subtree.

## Solution

Extract the containment behavior into `useSearchModalFocusContainment` and use
it from both modal surfaces. The hook builds one Tab sequence from the active
overlay plus the persistent header's logo, language control, and close button.
It remains active through the close animation, when the modal is still visible.

Focused regression tests assert that Tab from the final control wraps to the
header logo, and Shift+Tab from the logo wraps back, in both the instant shell
and the loaded overlay.

## Why This Works

The persistent header is intentionally outside either dialog's DOM subtree, so
each render phase must use the same focus-containment logic to treat those
controls as modal controls. Looking up the active overlay when Tab is pressed
also keeps the listener correct when the lazy shell is replaced.

## Prevention

- Treat lazy loading shells and their settled overlays as one keyboard surface.
- Add both forward and reverse Tab-wrap coverage whenever modal controls span
  persistent and lazy-rendered DOM regions.

## Related Issues

- [Watch search modal mobile header rows](watch-search-modal-mobile-header-rows.md)
- [Watch search close paths must reset modal-owned state](watch-search-modal-close-reset.md)
