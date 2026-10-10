---
id: "feat-322"
title: "Language-picker ARIA combobox"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-28"
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

The shared Watch language picker supports keyboard filtering and selection, but
its trigger, search field, listbox, and active option do not yet form a complete
ARIA combobox relationship for assistive technology.

## Entry Points — Read These First

1. `apps/web/src/components/watch/LanguageCombobox.tsx` — shared picker markup,
   keyboard navigation, filtered option state, and virtualization.
2. `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx` — focused
   regression coverage for picker interactions and semantic attributes.
3. `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
   — existing picker interaction and accessibility constraints.

## Grep These

- `aria-activedescendant`
- `aria-expanded`
- `role="listbox"`
- `role="option"`
- `language-combobox-search`

## What To Build

1. Give the searchable input the ARIA combobox role and its required expanded,
   popup, and listbox-control relationships.
2. Give the listbox a stable ID and preserve the active option ID used by
   `aria-activedescendant`.
3. Keep keyboard navigation, selection, filtering, disabled options, portal
   placement, and virtualized option metadata unchanged.
4. Add focused tests for the open combobox/listbox relationship and for active
   descendant updates during keyboard navigation.

## Constraints

- Do not change language data, filtering/ranking, navigation, or selected-value
  behavior.
- Do not replace the current trigger-plus-search interaction model or add a
  dependency.
- Keep the option IDs stable across filtering and virtualization.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguageCombobox.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
