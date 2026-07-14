---
id: "feat-196"
title: "Watch language index"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "languages"
  - "content-discovery"
---

## Problem

The Watch app has localized video URLs such as
`/watch/spanish-latin-american.html/videos`, but the public catalog entry point
does not list the available languages. Users need a scannable language index at
`/watch/languages` that adapts the Manager language browser pattern and sends
each language to its language-scoped videos URL.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/languages/page.tsx` - current `/watch/languages` route.
2. `apps/manager/src/features/coverage/LanguageGeoSelector.tsx` - region browser and language list pattern to adapt.
3. `apps/web/src/lib/search-language-actions.ts` - existing public Admin reference-data query shape for languages and countries.
4. `apps/web/src/proxy.ts` and `apps/web/src/lib/url-canonicalize.ts` - public Watch URL admission and canonicalization.

## Grep These

- `LanguageGeoSelector`
- `languages(limit:`
- `languagesIndexPath`
- `parseWatchPath`
- `spanish-latin-american.html/videos`

## What To Build

- Replace the `/watch/videos` placeholder with a `/watch/languages` language index page.
- Build a Web-owned data mapper from Admin `languages` and `countries` reference data.
- Adapt the Manager language browser layout and region artwork without cross-app imports.
- Emit language links as `/{public-language-slug}.html/videos`.
- Admit and canonicalize the new language-scoped videos URL shape.

## Constraints

- Keep the implementation inside `apps/web`; do not import Manager internals.
- Use public audio language slugs, not message-catalog locale keys.
- Do not hand-edit generated GraphQL outputs.
- Keep `/watch/languages` canonical without a `.html` suffix.
- Redirect legacy `/watch/videos` to `/watch/languages`.

## Verification

- `pnpm --filter @forge/web test -- src/lib/language-index.test.ts src/lib/routes.test.ts src/lib/url-canonicalize.test.ts src/proxy.test.ts src/app/[locale]/[htmlLang]/languages/page.test.tsx src/app/[locale]/[htmlLang]/[language]/videos/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke on `/watch/languages`, legacy `/watch/videos`, and `/watch/spanish-latin-american.html/videos`.
