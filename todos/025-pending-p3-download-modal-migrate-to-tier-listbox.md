---
status: pending
priority: p3
issue_id: "025"
title: Migrate DownloadModal's inline quality dropdown onto the shared TierListbox so the popup mechanics have one owner
labels:
  - web
  - watch
  - download-modal
  - accessibility
created_at: 2026-08-29
---

# Problem

`apps/web/src/components/watch/TierListbox.tsx` (added for the collection
download modal, plan
`docs/plans/2026-08-29-1542-fix-collection-download-quality-listbox-plan.md`)
lifted the portaled dark listbox mechanics from
`apps/web/src/components/watch/DownloadModal.tsx` — body portal, fixed
positioning under the trigger, capture-phase Escape and outside-pointerdown
close, resize/scroll repositioning, mount/unmount animation window — and added
the keyboard model the inline copy never had (ArrowUp/Down, Home/End,
Enter/Space, `aria-activedescendant`, focus returning to the trigger on every
close path).

`DownloadModal.tsx` still carries its own inline copy of the ~120 lines of popup
mechanics, so:

- two copies of the same behaviour now coexist and will drift;
- the single-video quality picker remains keyboard-inoperable (no arrow-key
  handling; Tab cycles around the body-portaled option buttons inside the modal
  focus trap) while the collection picker is not.

# Why it was deferred

`DownloadModal` carries a safeguard regression suite
(`docs/solutions/ui-bugs/watch-download-modal-safeguards-can-regress-independently.md`)
and per-option `data-size-bytes` attributes plus the `fileSizeLabel` trigger
copy, so adopting the shared component is a separate, test-heavy refactor that
did not belong in the collection-modal bug fix.

# Suggested shape

1. Extend `TierListbox` only where `DownloadModal` needs it — an optional
   per-option render slot or `optionAttributes(tier)` hook for
   `data-size-bytes`, and the existing `placeholder` prop for `fileSizeLabel`.
2. Replace the inline `dropdownOpen` / `dropdownMounted` / `dropdownRect`
   state, `updateDropdownRect`, `closeDropdown`, the document listeners, and
   the `createPortal(<ul role="listbox">…)` block in `DownloadModal.tsx` with
   `<TierListbox testIdPrefix="watch-download-modal-size" …>` so the existing
   `watch-download-modal-size-trigger` / `-list` / `-option` test ids keep
   resolving (the shared component derives `${prefix}` for the trigger; either
   accept a trigger-suffix option or update the suite's selectors).
3. Keep every scenario in
   `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx` green and
   add the keyboard scenarios from
   `apps/web/src/components/watch/__tests__/TierListbox.test.tsx` at the modal
   level.
4. Real-browser check inside the single-video modal (poster + terms dialog
   present): option click and Escape must not dismiss the outer dialog.
