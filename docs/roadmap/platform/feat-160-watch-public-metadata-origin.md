---
id: "feat-160"
title: "Watch public metadata origin"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-05"
duration: 1
depends_on:
  - "feat-159"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
---

## Problem

The Forge watch app can be deployed on `watch.jesusfilm.org` or run locally,
but public SEO and sharing metadata for indexed watch pages should point at the
canonical public web host: `https://www.jesusfilm.org/watch`. After the modern
watch home merge, production emitted `http://localhost:3000/watch` in canonical
and Open Graph URLs when the canonical-origin environment value was not set for
the deployment.

## Entry Points - Read These First

1. `apps/web/src/lib/experience-metadata.ts` - shared metadata generation for
   watch home, video, and series routes.
2. `apps/web/src/lib/routes.ts` - environment-driven route/share URL builders.
3. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` - watch home metadata entry.
4. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - inner watch route
   metadata entry.
5. `apps/web/src/app/[locale]/[htmlLang]/videos/page.tsx` - all-videos metadata.

## Grep These

- `WATCH_CANONICAL_ORIGIN`
- `getWatchPageMetadata`
- `generateSeriesMetadata`
- `alternates?.canonical`
- `openGraph?.url`

## What To Build

1. Keep user-facing route/share builders environment-aware, but make SEO
   metadata emit `https://www.jesusfilm.org/watch` as the absolute public
   origin.
2. Ensure home metadata uses `https://www.jesusfilm.org/watch`.
3. Ensure video and series metadata keep the full public `.html` watch path,
   e.g. `https://www.jesusfilm.org/watch/jesus.html/english.html`.
4. Add focused route/helper tests for canonical and Open Graph URLs.

## Constraints

- Do not change public `/watch` path shapes or proxy canonicalization.
- Do not change Share modal copy/embed behavior in this ticket.
- Do not introduce request-time dynamic APIs into static watch routes.
- Do not add new environment variables for this fix.

## Verification

- `pnpm --filter @forge/web test -- src/lib/__tests__/experience-metadata-series.test.ts src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx src/app/[locale]/[htmlLang]/videos/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser or live fetch smoke of `/watch` confirms canonical and OG URLs point
  at `https://www.jesusfilm.org/watch`.
