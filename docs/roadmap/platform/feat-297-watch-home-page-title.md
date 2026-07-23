---
id: "feat-297"
title: "Set the Watch home page metadata copy"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
---

## Problem

The Watch homepage inherited its document and social metadata copy from the
builder-authored experience. The public page needs stable, seeker-focused copy
that describes its Jesus movies and Bible video offering while retaining the
organization brand.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` — canonical Watch home route
   and metadata entry point.
2. `apps/web/src/app/[locale]/[htmlLang]/page.test.tsx` — focused route coverage.
3. `apps/web/src/lib/experience-metadata.ts` — shared metadata generation for
   Watch home and inner routes.

## Grep These

- `generateMetadata`
- `getWatchPageMetadata`
- `WATCH_HOME_TITLE`

## What To Build

1. Set the canonical Watch home document title to
   `Watch Free Jesus Movies & Bible Videos | Jesus Film Project`.
2. Set the home meta description to the approved Jesus movies, Gospel films,
   Bible videos, Christian series, faith, prayer, hope, and language copy.
3. Set Open Graph and Twitter title and description to the approved social copy.
4. Preserve all other home metadata returned by the shared helper.
5. Keep video, series, and localized inner-route metadata unchanged.
6. Add focused regression coverage for the home document and social metadata.

## Constraints

- Do not change metadata for non-home Watch routes.
- Do not change canonical URLs, social images, locales, cards, or robots metadata.
- Do not add request-time dynamic APIs to the static home route.

## Verification

- `pnpm --filter @forge/web exec vitest run 'src/app/[locale]/[htmlLang]/page.test.tsx'`
- `pnpm --filter @forge/web exec eslint 'src/app/[locale]/[htmlLang]/page.tsx' 'src/app/[locale]/[htmlLang]/page.test.tsx'`
- `pnpm --filter @forge/web exec prettier --check 'src/app/[locale]/[htmlLang]/page.tsx' 'src/app/[locale]/[htmlLang]/page.test.tsx' 'docs/roadmap/platform/feat-297-watch-home-page-title.md'`
