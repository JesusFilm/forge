---
id: "feat-281"
title: "Watch series parent variant language canonicalization"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "i18n"
---

## Problem

Series pages can have optional parent/trailer media variants, but the public
series language route should be driven by the requested audio slug and the
series child language inventory. A parent series record with only one playable
variant can currently redirect a valid child-language route to the parent
variant language, e.g. `how-did-we-get-here-episode-1/spanish-castilian` to
Hindi.

## Entry Points

1. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
2. `apps/web/src/lib/content.ts`
3. `apps/web/src/components/watch/SeriesPageClient.tsx`
4. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

## Verification

- Add focused route coverage proving the series branch does not redirect when
  the requested URL language differs from the optional parent selected variant.
- Run the focused page-routing test suite.

## Completion Evidence

- Removed the series-branch URL sync redirect that canonicalized the public
  route language from the optional parent selected variant.
- Added regression coverage for a Spanish-Castilian series URL with a Hindi
  parent selected variant.
- Passed the route language slug into the series hero so language switcher
  chrome stays aligned with the page language even when trailer media falls
  back to another language.
- `pnpm --filter @forge/web test -- 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`
  `'src/components/watch/__tests__/SeriesPageClient.test.tsx'`
  `'src/components/watch/__tests__/HeroPlayer.test.tsx'` passes: 191 tests,
  2 todo.
