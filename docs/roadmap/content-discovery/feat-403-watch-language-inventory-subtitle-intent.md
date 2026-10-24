---
id: "feat-403"
title: "Watch language inventory subtitle intent"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-20"
completed_date: "2026-08-20"
duration: 1
depends_on:
  - "feat-192"
  - "feat-346"
blocks:
  - "feat-404"
tags:
  - "web"
  - "watch"
  - "content-discovery"
  - "subtitles"
  - "i18n"
---

## Problem

Language inventory cards classified as subtitle-only link to their playable
fallback audio but omit the inventory language's one-shot subtitle intent.
First-time viewers can therefore reach the correct playable route without the
subtitle language they selected in the inventory.

## Entry Points - Read These First

1. `apps/web/src/lib/watch-language-inventory.ts` - normalizes inventory rows
   and builds each card href.
2. `apps/web/src/lib/routes.ts` - serializes `subtitleLanguage` as the
   `subtitles` one-shot query parameter.
3. `apps/web/src/components/search/VideoCard.tsx` - existing subtitle-only
   search routing precedent from feat-346.

## Grep These

- `buildInventoryHref|normalizeCard|subtitleOnlyVideos` in
  `apps/web/src/lib/watch-language-inventory.ts`.
- `subtitleLanguage|SUBTITLE_INTENT_PARAM` in `apps/web/src`.

## What To Build

- Pass the resolved inventory language into inventory-card normalization.
- For `SUBTITLE_ONLY` rows, keep `watchLanguageSlug` as the audio route and add
  the resolved inventory language as one-shot subtitle intent.
- Keep audio and collection links unchanged.
- Add resolver-level regression coverage for standalone and episode routes,
  including a non-Chinese subtitle language.

## Constraints

- Do not infer relationships between audio and subtitle language slugs.
- Do not change Admin GraphQL, the inventory read model, or URL path shapes.
- Do not rely on a previously stored subtitle preference.

## Verification

- Run the focused Watch language inventory tests.
- Run Web typecheck and the relevant route/component tests.
- Browser-smoke a subtitle-only inventory card and a fully dubbed card.

## Outcome

- Subtitle-only inventory cards retain the playable fallback-audio path and
  carry the resolved inventory language as one-shot subtitle intent.
- Fully dubbed inventory URLs remain unchanged.
- Resolver coverage includes Simplified Chinese and Russian, standalone and
  episode routes.
