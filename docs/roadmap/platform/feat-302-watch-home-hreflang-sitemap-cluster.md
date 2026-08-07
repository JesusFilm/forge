---
id: "feat-302"
title: "Watch homepage hreflang sitemap cluster"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
completed_date: "2026-07-23"
duration: 1
depends_on:
  - "feat-184"
blocks:
  - "feat-341"
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
  - "i18n"
---

## Problem

> Superseded on 2026-08-07 by `feat-341`. The two-home cluster below records
> the shipped historical decision; Forge now consolidates English homepage
> aliases because the ministry does not publish distinct regional English
> homepage content.

The default Watch homepage and the English-British homepage are indexable and
self-canonical, but the Watch sitemap does not connect them with reciprocal
`hreflang` signals. The English-British route also renders the generic
three-letter `eng` language tag instead of the regional `en-GB` identity.

## Entry Points — Read These First

1. `apps/web/src/lib/watch-sitemap.ts` — sitemap entry and alternate rendering.
2. `apps/web/src/lib/locale.ts` — public language-slug to HTML language identity.
3. `apps/web/src/lib/watch-sitemap.test.ts` — sitemap graph regression coverage.
4. `apps/web/src/lib/locale.test.ts` — locale identity regression coverage.
5. `docs/solutions/performance-issues/watch-hreflang-sitemap-manifest-20260612.md`
   — sitemap-only hreflang ownership decision.

## Grep These

- `createWatchSitemapEntries`
- `createWatchSitemapGroups`
- `HTML_LANG_OVERRIDES`
- `resolveWatchLocaleIdentity`
- `english-british`
- `x-default`

## What To Build

1. Add a sitemap-only homepage alternate cluster containing the canonical
   `/watch` English default and `/watch/english-british.html` as `en-GB`.
2. Include self references plus an `x-default` reference to `/watch` without
   creating a duplicate sitemap `<loc>`.
3. Resolve the English-British route to `<html lang="en-GB">`.
4. Preserve self-canonical homepage URLs and the existing rule that Watch
   page HTML emits no page-head `hreflang`.

## Constraints

- Do not add page-head `hreflang`; Watch sitemap XML remains the sole owner.
- Do not redirect the English-British homepage while it represents a distinct
  public audio-language home.
- Do not change video or episode URL shapes.
- Do not emit `watch.jesusfilm.org` URLs in sitemap or metadata.

## Verification

- `pnpm --filter @forge/web test -- src/lib/watch-sitemap.test.ts src/lib/locale.test.ts src/proxy.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Rendered sitemap XML contains reciprocal `en`, `en-GB`, and `x-default`
  alternates for the two homepage URLs.
- The English-British route rewrites with `htmlLang: en-GB` and retains its
  canonical `www.jesusfilm.org` URL.
