---
id: "feat-146"
title: "Watch Download Modal Mobile Close Placement"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-13"
duration: 1
depends_on:
  - "feat-023"
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
---

## Problem

On narrow mobile viewports, the Watch download modal's viewport-level X close control can visually overlap the poster thumbnail and duration badge. The close affordance needs to remain available without covering content elements.

## Entry Points - Read These First

1. `apps/web/src/components/watch/DownloadModal.tsx` - modal layout and close controls
2. `apps/web/src/components/watch/WatchModalViewportCloseButton.tsx` - shared viewport-level close control
3. `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx` - modal interaction and layout regression tests

## Grep These

- `watch-download-modal-close` in `apps/web/src/components/watch/`
- `WatchModalViewportCloseButton` in `apps/web/src/components/watch/`
- `watch-download-modal-poster` in `apps/web/src/components/watch/`

## What To Build

1. Preserve the desktop viewport-level close control used by Watch modals.
2. On mobile, reserve layout space for the close affordance inside the download modal so it cannot overlay the poster, duration badge, title, language pill, file-size selector, terms checkbox, or action buttons.
3. Add a regression test that locks the mobile close control inside the dialog before content.

## Constraints

- Keep the change scoped to `apps/web` modal presentation.
- Do not alter download URL allowlisting, proxy behavior, or terms-of-use gating.
- Keep existing close semantics: either close affordance must route through the same `handleOpenChange(false)` cleanup path.

## Verification

- `pnpm --filter @forge/web test -- DownloadModal.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Mobile browser smoke of the Watch download dialog
