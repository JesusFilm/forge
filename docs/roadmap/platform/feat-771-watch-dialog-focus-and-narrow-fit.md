---
id: "feat-771"
title: "Watch dialog focus return and 320 px fit repairs"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
  - "accessibility"
---

## Problem

The 2026-10-20 overnight Watch audit (rounds 06 and 08) found three dialog
defects on phones and keyboards:

1. **Language & Subtitles: Escape on the open language list drops focus.**
   Production at 320 px, and reproduced locally at 320 and 1280 px with the
   real `LanguagePickerModal`: Escape 1 closes the list and keeps the dialog
   open, but focus lands on `<body>`. `LanguagePickerModal` closes the list
   from a capture-phase `document` `keydown` listener that calls
   `stopPropagation()`, so `LanguageCombobox`'s own Escape handler (which
   refocuses the trigger) never runs, and the focused search input unmounts.
   PR #2663's `stopPropagation` in that same input handler does not reach
   this dialog.
2. **Single-video Download dialog footer at 320 px.** The Close + Download
   row did not wrap and widened the dialog past the screen. Fixed by PR #2836.
3. **Collection download dialog footer at 320 px.** After a finished queue
   the "Download again" + Close row did not wrap: the dialog content grew to
   346 px in a 320 px viewport and "Download again" ended at x=338. The
   language and quality selects and the progress card were cut. Fixed on PR
   #2836 (same pattern).

## Entry Points — Read These First

1. `apps/web/src/components/watch/LanguageCombobox.tsx` — the open/close
   focus effects near `searchRef.current?.focus()`.
2. `apps/web/src/components/watch/LanguagePickerModal.tsx` —
   `closeComboboxBeforeDialogEscape`.
3. `apps/web/src/components/watch/DownloadModal.tsx` and
   `apps/web/src/components/watch/CollectionDownloadModal.tsx` — footer rows.

## Grep These

- `closeComboboxBeforeDialogEscape`
- `wasOpenRef`
- `data-testid="watch-collection-download-actions"`

## What To Build

1. When a controlled `LanguageCombobox` closes and focus is on `<body>` (or
   nowhere), focus the trigger. Leave focus alone if it moved to a real
   element (outside click, another control).
2. `flex-wrap` on the Download and collection download footer rows.

## Constraints

- No change to analytics, download transport, language routing or the
  dialog's Escape ownership (Escape 2 still closes the dialog).
- No new strings.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/LanguagePickerModal.test.tsx`
  — "returns focus to the language trigger when Escape closes the open
  dropdown" fails with the focus effect disabled.
- Real browser, local fixture with the real modal, 320x640 and 1280x800,
  keyboard and pointer: Escape 1 → focus on `language-combobox-trigger`
  inside the dialog; Escape 2 → dialog closed, focus on the opener.
- Collection download fixture (mock Admin, local fake download responses):
  finished footer inside the viewport at 320/360/390/1280.

## Resolution

- Item 1: this ticket's PR (2026-10-20).
- Items 2 and 3: PR #2836.
