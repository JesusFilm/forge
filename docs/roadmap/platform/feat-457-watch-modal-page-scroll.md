---
id: "feat-457"
title: "Watch modal page-level scrolling"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-09-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "responsive-ui"
  - "modal"
---

## Resolution

**Status:** Completed on 2026-09-04. The collection download, single-video
download, share, recommendation settings, and nested Terms dialogs now place
general vertical overflow on their full-screen viewport. Their popup surfaces
remain centered when they fit, stay reachable on short screens, and retain
local scrolling only for bounded option lists.

## Problem

Several Watch dialogs cap their content height and scroll an inset content
wrapper. On short viewports this produces a component-level scrollbar beside
the modal, while the expected behavior is page-like scrolling at the viewport
edge.

## Entry Points - Read These First

1. `apps/web/src/components/ui/dialog.tsx` - opt-in viewport wrapper used by
   Watch dialogs.
2. `apps/web/src/components/watch/DownloadModal.tsx` - single-video download
   and nested terms dialogs.
3. `apps/web/src/components/watch/CollectionDownloadModal.tsx` - collection
   download dialog shown in the reported screenshot.
4. `apps/web/src/components/watch/ShareModal.tsx` - Watch share dialog using
   the same inset-scroll pattern.
5. `apps/web/src/components/recommendations/RecommendationCookieSettings.tsx` -
   centered Watch preference dialog using an inner scroll surface.
6. `apps/web/src/components/watch/LanguagePickerPresentation.tsx` - existing
   page-aligned modal-scroll precedent.

## Grep These

- `max-h-[82vh]`
- `max-h-[86vh]`
- `overflow-y-auto`
- `viewportClassName`
- `watch-download-modal-terms-body`

## What To Build

1. Make the full-viewport dialog parent own vertical overflow for standard
   Watch share, download, and preference dialogs.
2. Keep each visible dialog width-constrained and vertically centered when it
   fits, while allowing it to begin within viewport padding and scroll in full
   on short screens.
3. Apply the same page-level scroll ownership to the nested terms dialog.
4. Preserve independent scrolling for bounded option lists and text inputs.
5. Add regression coverage for scroll ownership on each affected dialog.

## Constraints

- Do not change download, share, authentication, or terms acceptance behavior.
- Keep the viewport-level close controls fixed and accessible.
- Do not change intentionally framed experiences such as the beta-tester
  iframe or bounded dropdown/listbox scrolling.
- Preserve background scroll locking and horizontal overflow protection.

## Verification

- `pnpm --filter @forge/web test -- --reporter=dot src/components/watch/__tests__/DownloadModal.test.tsx src/components/watch/__tests__/CollectionDownloadModal.test.tsx src/components/watch/__tests__/ShareModal.test.tsx src/components/recommendations/RecommendationCookieBanner.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke the collection download, single-video download, share, and
  terms dialogs at short landscape and narrow portrait viewport sizes.
