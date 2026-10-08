---
id: "feat-631"
title: "Route Watch collections to an available audio language"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
  - "routing"
---

## Problem

Collection pages return 404 when a card opens a language that has no published
audio option for the collection. The series route already resolves a published
language fallback, but previously discarded it with `notFound()`. Linear:
FGE-277.

## Entry Points

1. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
3. `apps/web/src/lib/series-language.ts`
4. `apps/web/src/lib/watch-route-manifest.ts`

## Grep These

- `resolveSeriesLanguageIdentity`
- `seriesLanguage.slug !== rawLocale`
- `childDubLanguages`
- `getWatchNestedContainerAudioLanguageSlugs`

## What To Build

- Redirect an unavailable collection language to the exact published audio
  language selected from the collection's direct options and manifest-admitted
  nested options. Prefer the collection's primary language, then English, then
  the first published option.
- Retain 404 behavior when there is no published audio language or a safe
  canonical URL cannot be built.
- Preserve neighboring valid-language routes.

## Constraints

- Use published Admin language records and exact route-manifest entries as
  availability proof; do not infer availability from the UI language catalog.
- Do not add per-language aliases, edit content restrictions, or change video
  route fallback behavior.

## Verification

- A series route with no option for the requested locale redirects to one of
  the published language options.
- A route whose requested language is published continues to render without a
  redirect.
- No-language and inconclusive route cases retain their existing failure path.
- Run focused route tests, Web typecheck, lint, and formatting.
