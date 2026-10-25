---
id: "feat-289"
title: "Watch Modal Close Position System"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on:
  - "feat-023"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
---

## Problem

Watch modal close icons do not follow one enforceable placement rule. Several
dialogs use the shared close control, the download modal hides it on
mobile, and feedback, beta signup, global language selection, and quiz dialogs
own separate close markup. This makes the close affordance move between modal
surfaces and leaves some phone layouts without a top-right icon.

## Entry Points

1. `apps/web/src/components/watch/WatchModalViewportCloseButton.tsx` — shared
   Watch modal close control and placement contract.
2. `apps/web/src/components/watch/DownloadModal.tsx` — mobile-hidden shared
   close control.
3. `apps/web/src/components/FeedbackModal.tsx` and
   `apps/web/src/components/watch/BetaTesterModal.tsx` — global Watch dialogs
   with local close markup.
4. `apps/web/src/components/watch/GlobalLanguagePickerModal.tsx` and
   `apps/web/src/components/sections/QuizButton.tsx` — additional Watch dialog
   surfaces.
5. `apps/web/src/components/SearchOverlay.tsx` and
   `apps/web/src/components/FloatingSearchProvider.tsx` — persistent-header
   search close control that must remain top-right without duplicating it.

## Grep These

- `WatchModalViewportCloseButton`
- `DialogClose`
- `role="dialog"`
- `aria-modal="true"`
- `hidden sm:flex`

## What To Build

1. Define one safe-area-aware top-right position in the shared Watch modal
   close component and prevent callers from overriding or hiding it.
2. Use the shared close control on every Watch dialog that currently owns a
   separate close icon, including lazy loading fallbacks.
3. Preserve existing close callbacks, focus restoration, Escape handling,
   modal activity ownership, and persistent-header search geometry.
4. Add focused regression coverage for the shared position and each converted
   dialog surface.

## Constraints

- Keep the change inside `apps/web` and Watch documentation.
- Do not change modal content, download behavior, iframe policies, or search
  field/header alignment.
- Do not render two close icons for one modal state.
- Keep the close control above content within each Watch modal without escaping
  its accessibility or stacking context.

## Verification

- Focused Vitest coverage for the shared close component and converted modal
  surfaces.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Mobile browser smoke on a Watch page with representative modal screenshots.

## Completion Evidence

- 137 focused Vitest cases passed across 10 Watch modal test files.
- Web typecheck and lint passed.
- Mobile browser checks verified Language and Share close controls at the
  safe-area-adjusted viewport top-right, inside the dialog accessibility tree,
  unique, and clickable.
