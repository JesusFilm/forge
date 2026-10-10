---
id: "feat-169"
title: "Watch language picker search ranking"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "localization"
---

## Problem

The watch language picker filters search results by substring while preserving
the full alphabetical option order. A query like `russi` therefore shows
incidental substring matches such as Belorussian before the direct Russian
match, which feels backwards for users trying to select a specific language.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguageCombobox.tsx` - shared searchable
   audio/subtitle language selector.
2. `apps/web/src/components/watch/LanguagePickerModal.tsx` - builds the watch
   language and subtitle option lists.
3. `apps/web/src/lib/language-display.ts` - derives display and native labels
   used by the picker.
4. `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx` -
   focused combobox behavior tests.

## Grep These

- `LanguageCombobox`
- `nativeNameForOption`
- `language-combobox-search`
- `LanguagePickerModal`

## What To Build

1. Keep empty-query language lists in their existing caller-provided order.
2. For non-empty search queries, rank display-label prefix matches first, then
   word-prefix matches, then other substring matches.
3. Preserve alphabetical stability inside each match tier by keeping the
   existing caller-provided order within each tier.
4. Apply the same ranking rule to native-name matches already supported by the
   combobox.
5. Keep selected-language highlighting independent from ranking; the selected
   row should not be pinned above a stronger search match.

## Constraints

- Do not add fuzzy matching or typo tolerance.
- Do not change language display-name derivation, flag selection, source data,
  route navigation, or subtitle selection state.
- Do not change broader Forge content/search ranking behavior.
- Keep the change local to the shared watch language combobox unless current
  tests reveal a tighter boundary is needed.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguageCombobox.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke with the watch language picker open: searching `russi` should
  put Russian ahead of incidental substring matches while preserving selected
  row highlighting.
