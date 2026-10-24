---
id: "feat-400"
title: "Watch language search consistency"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "i18n"
---

## Problem

Watch has one reviewed exact-slug alias table for familiar Chinese language
search terms, but the shared language combobox requires every caller to opt in.
Only the global, playable-audio, and subtitle pickers currently opt in. Five
other combobox consumers and the custom language-index browser therefore use
different search behavior, and future consumers can repeat the omission.

## Entry Points - Read These First

1. `apps/web/src/lib/watch-language-search-aliases.ts` - reviewed aliases keyed
   by exact public language slug.
2. `apps/web/src/components/watch/LanguageCombobox.tsx` - shared filtering,
   ranking, keyboard behavior, and virtualization.
3. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx` - custom
   language-directory filtering and country ranking.
4. `docs/solutions/ui-bugs/watch-language-picker-chinese-search-aliases.md` -
   existing identity and availability boundaries.

## Grep These

- `LanguageCombobox`
- `searchAliasAuthority`
- `searchMatchTierForOption`
- `languageMatchesQuery`
- `WATCH_LANGUAGE_SEARCH_ALIASES`

## What To Build

1. Extract one client-safe Watch language query matcher and ranking policy that
   combines display name, native name, public slug, and reviewed exact-slug
   aliases.
2. Make the shared `LanguageCombobox` use that policy by default so every
   current and future consumer inherits alias behavior without caller opt-in.
3. Reuse the same matcher in the custom Watch language-index browser while
   preserving its existing country, region, and speaker-count ranking.
4. Keep each caller's supplied options as the only availability boundary.
5. Add focused regression coverage for all shared consumers, the custom index,
   non-Chinese search, keyboard scrolling, and existing ordering guarantees.

## Constraints

- Bind aliases by exact public language slug; do not infer language identity
  from BCP-47 families, script, geography, or locale prefixes.
- Do not change the reviewed alias vocabulary, language availability, routing,
  playback, subtitle selection, downloads, visible copy, or message catalogs.
- Do not add a popularity override. Existing direct-match ranking and caller or
  backend order remain authoritative for equal-tier results.
- Preserve `LanguageCombobox` virtualization and keyboard scrolling behavior.

## Verification

- Seventeen focused test files pass with 215 tests covering language aliases,
  the shared combobox, recovery, series, downloads, inventory, search overlay,
  and the language index.
- English and Russian direct/native-name search behavior remains unchanged.
- `pnpm --filter @forge/web typecheck` passes.
- `pnpm --filter @forge/web lint` passes.
- `pnpm --filter @forge/web build` passes. The sitemap emits its existing
  dynamic-render warning while the production build still completes.
- Browser smoke passes for the global picker, playback audio and subtitle
  pickers, recovery page, search language control, language inventory switcher,
  and language index.
- Production-load smoke passes: the matcher adds no network request, a cached
  `/watch` response completes in about 13-14 ms locally, and a query over 2,259
  options renders its result within about 131 ms including browser-control
  round-trip overhead.
