---
id: "feat-264"
title: "Watch language modal page-aligned scroll"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "responsive-ui"
---

## Problem

The Watch language picker owns vertical overflow on its centered 608px popup
at wider breakpoints. In short landscape viewports, including Safari, this
places the native scrollbar between the modal content and close control rather
than at the viewport edge like page scrolling.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - responsive modal
   shell and current overflow owner.
2. `apps/web/src/components/ui/dialog.tsx` - Base UI portal, backdrop, and popup
   composition.
3. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` -
   focused modal shell and interaction coverage.
4. `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md` -
   existing viewport-first mobile overflow pattern to preserve.

## Grep These

- `watch-language-picker-modal`
- `overflow-y-auto`
- `DialogContent`
- `DialogPrimitive.Viewport`

## What To Build

1. Add an opt-in full-viewport scroll parent to the shared dialog composition
   without changing non-opted dialogs.
2. Move language-picker vertical overflow to that parent at every breakpoint.
3. Keep the visible form centered and constrained to 608px when it fits while
   preserving access to every control in short viewports.
4. Preserve fullscreen portal behavior, focus containment, background scroll
   lock, horizontal overflow protection, and independent combobox scrolling.

## Constraints

- Keep the fix local to dialog layout and the Watch language picker.
- Do not change language/subtitle state, catalog links, Watch routes, or data
  fetching.
- Do not apply the new scroll parent to Share, Download, or other dialogs.

## Verification

- `pnpm --filter @forge/web test -- --reporter=dot src/components/ui/dialog.test.tsx src/components/watch/__tests__/LanguagePickerModal.test.tsx`
  covers opt-in versus default dialog composition and scroll ownership.
- `pnpm --filter @forge/web typecheck` passes.
- `pnpm --filter @forge/web lint` passes.
- Safari/iOS WebKit smoke at `1280x543`, plus narrow portrait and tall desktop
  checks, confirms the scrollbar is at the viewport edge and all controls are
  reachable without background-page scrolling.

## Plan

Implementation plan:
`docs/plans/2026-07-16-001-fix-watch-language-modal-parent-scroll-plan.md`
