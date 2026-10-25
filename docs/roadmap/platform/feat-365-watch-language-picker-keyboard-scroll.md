---
id: "feat-365"
title: "Watch language picker keyboard scrolling"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-18"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "accessibility"
---

## Problem

After filtering the shared Watch language combobox, Arrow Up and Arrow Down
change the active option but do not keep it visible when the remaining result
set is below the virtualization threshold and still taller than the listbox.
Keyboard users can therefore lose sight of their current selection.

## Entry Points — Read These First

1. `apps/web/src/components/watch/LanguageCombobox.tsx` — active-option state,
   keyboard navigation, listbox scrolling, and virtualization threshold.
2. `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx` — focused
   keyboard, ARIA, and virtualization regression coverage.
3. `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
   — existing language-combobox keyboard and virtualization constraints.

## Grep These

- `scrollActiveOptionIntoView`
- `VIRTUALIZATION_THRESHOLD`
- `aria-activedescendant`
- `handleSearchKeyDown`
- `language-combobox-search`

## What To Build

1. Keep the keyboard-active option visible for both virtualized and
   non-virtualized overflowing result lists.
2. Continue updating React scroll state only when it is needed to calculate a
   virtualized window.
3. Add a focused regression test for a filtered result set below the
   virtualization threshold that still exceeds the listbox height.

## Constraints

- Do not change language filtering, ranking, aliases, availability, selection,
  routing, or visible copy.
- Do not change IME composition behavior or add a dependency.
- Preserve virtualized-list performance and ARIA active-descendant behavior.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguageCombobox.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke with filtered Chinese and non-Chinese result sets confirms the
  keyboard-active option remains visible while moving down and back up.
