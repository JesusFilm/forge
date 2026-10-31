---
id: "feat-761"
title: "Make the Watch download quality picker keyboard-operable"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
  - "accessibility"
---

## Problem

The single-video Watch download modal opens with the largest file selected
("Highest", 5,521,959,728 bytes for JESUS). On production
(2026-10-20 round-03 audit), a keyboard user could open the quality list with
Enter, but ArrowUp/ArrowDown did nothing and Tab skipped the options: the list
is portaled to `document.body`, outside the dialog's focus trap, and the inline
dropdown had no keyboard model. Keyboard-only viewers could not choose "High"
or "Low".

The collection download modal already uses the shared `TierListbox`, which has
the keyboard model (APG select-only combobox with `aria-activedescendant`).
`todos/025-pending-p3-download-modal-migrate-to-tier-listbox.md` recorded the
same gap.

## Entry Points — Read These First

1. `apps/web/src/components/watch/DownloadModal.tsx` — the file-size block.
2. `apps/web/src/components/watch/TierListbox.tsx` — shared picker.
3. `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx` — modal
   safeguards suite and the keyboard scenarios.
4. `docs/solutions/ui-bugs/watch-download-modal-safeguards-can-regress-independently.md`.

## Grep These

- `watch-download-modal-size`
- `TierListbox`
- `data-size-bytes`

## What To Build

Replace the inline dropdown state, document listeners, and portaled
`role="listbox"` in `DownloadModal` with
`<TierListbox testIdPrefix="watch-download-modal-size" … />`, labelled by the
visible "Select a file size" text. Keep: Highest default, localized tier names,
no size copy, no size `HEAD` probes, Terms gate, Escape closes only the list.
The unused per-option `data-size-bytes` attribute is dropped.

## Constraints

- Do not show file sizes (feat-310 decision stands).
- Do not change the default tier.
- Keep the Terms and account-gate safeguards unchanged.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/DownloadModal.test.tsx src/components/watch/__tests__/TierListbox.test.tsx`
- Keyboard scenarios fail when `TierListbox`'s trigger `onKeyDown` is removed.
- Real browser: open the actual modal, ArrowDown to Low, Enter, Escape keeps
  the dialog open, focus stays on the trigger.

## Resolution

Delivered 2026-10-20 (round-03 accessibility audit). See the PR linked from
the round-03 report.
