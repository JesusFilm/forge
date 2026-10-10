---
id: "feat-633"
title: "Show Watch search's inferred language for completed queries"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "multilingual"
---

## Goal

When Admin infers a search language from the query, show that authoritative language beside the completed results if the viewer did not manually choose a search language. This keeps Cyrillic queries from silently looking like English searches.

## Entry points

- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `apps/admin/src/services/search-language-resolution.ts`

## Constraints

- Use Admin's `targetLanguageSlug`; do not add client-side script detection.
- Preserve a viewer's manually selected search language.
- Keep the result context and language control aligned with the completed result set.

## Verification

- Regression test: a Cyrillic query submitted with the default English selection, with Admin returning `targetLanguageSlug: "russian"`, shows Russian as the completed search language.
- Focused Web search overlay tests, typecheck, and lint.

## Tracking

- Linear: FGE-5
