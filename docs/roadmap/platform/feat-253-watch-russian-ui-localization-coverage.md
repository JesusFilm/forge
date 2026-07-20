---
id: "feat-253"
title: "Watch Russian UI localization coverage"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on: []
blocks:
  - "feat-254"
  - "feat-255"
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "i18n"
  - "localization"
---

## Problem

The Russian language-inventory route renders localized catalog content inside
English app-owned UI. The same bypass pattern appears on newer Watch home,
language-index, history, account, error, and not-found surfaces. In addition,
recent search keys in the authored Russian catalog still contain English source
copy, producing mixed-language pages even where components already use
`next-intl`.

## Entry Points - Read These First

1. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   - hard-coded inventory headings, descriptions, labels, counts, and CTAs.
2. `apps/web/src/components/home/WatchHomeSection.tsx` and
   `apps/web/src/components/home/WatchHomeCard.tsx` - shared Watch CTA and media
   labels used on the home and language-inventory pages.
3. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx` - language
   discovery copy, search controls, and count formatting.
4. `apps/web/messages/en.json` and `apps/web/messages/ru.json` - source and
   authored Russian message catalogs.
5. `apps/web/src/i18n/__tests__/messages-parity.test.ts` - catalog structure and
   Russian source-copy regression coverage.

## Grep These

- `Free Christian videos for`
- `Language collection`
- `Open collection`
- `Watch Now`
- `Choose a language`
- `Search language`
- `Next Episode`
- `useTranslations`

## What To Build

1. Route app-owned copy through contextual `next-intl` namespaces instead of
   rendering English JSX or string constants directly.
2. Reuse `VideoLabels` for media-kind labels and localize counts with ICU
   plural messages instead of English-only helpers.
3. Add complete Russian copy for the audited Watch surfaces, including recent
   search-language keys that still match English.
4. Keep Admin-authored titles and descriptions separate from UI catalog copy;
   localized content remains owned by the existing Admin/Core metadata path.
5. Add focused rendering and catalog tests that prove Russian UI does not
   regress to the English source strings.

## Constraints

- Do not change public Watch URL shapes or audio-language selection.
- Do not translate Admin-authored video titles, collection descriptions,
  transcripts, subtitles, or audio in the UI catalog.
- Preserve the provisional-catalog policy: unreviewed locales remain explicit
  English-seeded catalogs until their copy is reviewed.
- Preserve ICU placeholders and structural key parity across every catalog.

## Verification

- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx src/components/watch/WatchLanguageIndexBrowser.test.tsx src/components/home/__tests__/WatchHomePage.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on `/watch/russian.html/videos`, `/watch/russian.html`, and a
  Russian video route verifies localized visible copy and no English UI leaks.

## Completion Notes

- Routed the language inventory, language index, home controls and sections,
  account/history, player and language-picker states, footer/promo, errors, and
  not-found surfaces through contextual `next-intl` namespaces.
- Completed the reviewed Russian copy, including the previously English search
  strings, media-kind labels, ICU plurals, accessibility labels, and metadata.
- Added a Russian source-copy regression gate alongside structural parity for
  all 225 non-source catalogs; the provisional policy remains unchanged.
- Web typecheck, lint, both locale generators, provisional-catalog validation,
  and the full 1,727-test suite passed (with two existing todos).
- Local browser proof against an isolated 1,101-video snapshot returned 200 for
  `/watch/russian.html/videos`; the visible Russian page contained none of the
  audited legacy English UI labels and added no fetch, dependency, hydration
  controller, or rendering initialization.
- The review pass also removed English global feedback/search chrome, localized
  semantic carousel/card labels, made static section localization exhaustive,
  made promo emphasis reorderable with a rich message, hid unknown upstream
  errors behind localized copy, and verified Russian ICU plural categories and
  metadata selection.
- Page-load proof compared eight alternating warm requests against the exact
  base commit: both returned 200, median TTFB moved from 1.65s to 1.76s within
  overlapping dev-server ranges, and HTML grew 36,897 bytes (0.72%). No new
  request, dependency, or client initialization path was added.
- The browser audit separately identified incomplete Admin-authored Russian
  titles/descriptions and unreviewed copy in other authored UI catalogs. Those
  are tracked in `feat-254` and `feat-255` rather than hidden by UI fallbacks.
