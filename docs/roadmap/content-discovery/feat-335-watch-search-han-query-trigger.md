---
id: "feat-335"
title: "Remove Web Watch search frontend language detection"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
duration: 1
depends_on:
  - "feat-196"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "multilingual"
  - "i18n"
---

## Problem

The Web Watch search overlay had a client-side language detector that could
block the normal debounced search behind a "detected language" confirmation UI.
For Han-script queries such as `日本`, `潮州話`, `聖經`, `愛`, and `耶穌`, that
confirmation was more harmful than helpful because the same characters can be
valid across Japanese, Mandarin, Teochew, and other Chinese-language contexts.
The backend already receives the typed query plus explicit language signals, so
the frontend should not infer, relabel, or gate the search language.

## Entry Points

1. `apps/web/src/components/SearchOverlay.tsx`
2. `apps/web/src/components/FloatingSearchController.tsx`
3. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

## What Changed

- Removed the search overlay's client-side query-language confirmation UI.
- Removed the controller-side client detector used to populate local
  `detectedQueryLanguage` state.
- Deleted the unused `search-query-language` helper and its TinyLD tests.
- Removed the `tinyld` dependency from `@forge/web`.
- Kept explicit language combobox selection behavior intact; selected languages
  still send `targetLanguageSlug` with the search request.

## Verification

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx search-actions.test.ts`
