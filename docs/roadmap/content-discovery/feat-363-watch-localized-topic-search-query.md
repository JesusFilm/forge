---
id: "feat-363"
title: "Submit localized Watch topic search queries"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "search"
  - "i18n"
  - "web"
---

## Problem

The Watch search overlay translates its browse-topic labels but still submits
the categories' English structural keys. A Chinese user can click
`圣经故事` and see `bible stories` placed in the search field, even though
submitting `圣经故事` directly returns relevant results.

## Entry Points - Read These First

1. `apps/web/src/components/SearchOverlay.tsx` - category rendering and click handling.
2. `apps/web/src/lib/search-categories.ts` - stable category identifiers.
3. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` - Watch search interaction coverage.
4. `apps/web/messages/{ar,en,ru,zh-Hans}.json` - representative localized category labels.
5. GitHub issue `#1897` - reproduction, impact, and root-cause evidence.

## Grep These

- `CATEGORY_TITLE_KEYS`
- `handleCategoryClick`
- `search-overlay-category-`
- `cat.searchTerm`

## What To Build

1. Keep `searchTerm` as the category's stable React key, icon key, and test identifier.
2. Submit the localized topic label as the user-facing search query.
3. Add regression coverage across Arabic, English, Russian, and Simplified Chinese.

## Constraints

- Do not change Admin search, query-language resolution, result ranking, Watch routes, or the language picker.
- Do not add per-locale query maps or duplicate catalog text in TypeScript.
- Keep the change limited to GitHub issue `#1897`.

## Verification

- A Chinese `圣经故事` card click places and submits `圣经故事`, not `bible stories`.
- An English Bible Stories card click continues to submit `Bible Stories`.
- Arabic and Russian topic clicks submit their localized visible labels.
- Each topic click sends exactly one search request.
- The focused Watch search interaction test, Web typecheck, lint, and formatting checks pass.
- The change adds no request, dependency, route, hydration, or page-loading work.
