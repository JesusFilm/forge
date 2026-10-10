---
title: "fix: Watch Public Metadata Origin"
type: "fix"
status: "completed"
date: "2026-06-05"
roadmap: "docs/roadmap/platform/feat-160-watch-public-metadata-origin.md"
---

# fix: Watch Public Metadata Origin

## Summary

Make watch-route SEO metadata use the public indexed host,
`https://www.jesusfilm.org/watch`, independent of the environment-specific
share/link origin. This fixes the production symptom where canonical and Open
Graph URLs could render as `http://localhost:3000/watch`.

## Problem Frame

`apps/web/src/lib/routes.ts` exposes `WATCH_CANONICAL_ORIGIN` from
`NEXT_PUBLIC_CANONICAL_ORIGIN`. That value is intentionally useful for local
development and Share modal behavior, but it is too deployment-sensitive for
public SEO metadata. The home route and inner watch routes need stable absolute
metadata URLs that match the public website host crawlers should index.

## Requirements

- R1. `/watch` home metadata emits canonical and `openGraph.url` as
  `https://www.jesusfilm.org/watch`.
- R2. Inner video metadata emits canonical and `openGraph.url` with the full
  public watch path, e.g.
  `https://www.jesusfilm.org/watch/jesus.html/english.html`.
- R3. Series/episode metadata uses the same public origin and existing `.html`
  route shapes.
- R4. Share/copy/embed link builders continue to use existing
  environment-driven route helpers.
- R5. Static watch routes remain cacheable and do not read request headers.

## Implementation Units

### Unit 1: Metadata Origin Helper

Files:

- `apps/web/src/lib/experience-metadata.ts`
- `apps/web/src/app/[locale]/[htmlLang]/videos/page.tsx`

Introduce a metadata-only public origin constant or helper near the metadata
builder. Replace metadata canonical/OG URL construction so it combines
`https://www.jesusfilm.org` with `WATCH_BASE_PATH` and the existing watch path
builders. Avoid changing `WATCH_CANONICAL_ORIGIN` in `apps/web/src/lib/routes.ts`
so Share modal and environment-specific absolute route helpers retain their
current behavior.

Test scenarios:

- Home metadata with no slug/path locale returns
  `https://www.jesusfilm.org/watch`.
- Video metadata with slug and public language slug returns
  `https://www.jesusfilm.org/watch/{slug}.html/{language}.html`.
- Series metadata with path locale uses the same public origin.
- `/videos` metadata remains `.html`-free and uses the public origin.

### Unit 2: Focused Regression Tests

Files:

- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- `apps/web/src/lib/__tests__/experience-metadata-series.test.ts`
- `apps/web/src/app/[locale]/[htmlLang]/videos/page.test.tsx`

Update existing localhost expectations to the public `www.jesusfilm.org`
contract and add `openGraph.url` assertions where canonical-only coverage would
miss the reported OG bug.

## Risks

- Changing `WATCH_CANONICAL_ORIGIN` globally would alter Share modal behavior
  and local copy-link tests, so keep the SEO origin isolated to metadata.
- Fallback metadata for malformed slugs must remain non-throwing; preserve the
  current defensive string-building behavior.

## Verification

- `pnpm --filter @forge/web test -- src/lib/__tests__/experience-metadata-series.test.ts src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx src/app/[locale]/[htmlLang]/videos/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Fetch or browser-smoke `/watch` and confirm `canonical`/`og:url` point to
  `https://www.jesusfilm.org/watch`.
