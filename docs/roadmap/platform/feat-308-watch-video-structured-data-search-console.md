---
id: "feat-308"
title: "Fix Watch video structured data Search Console issues"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks:
  - "feat-309"
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "structured-data"
---

## Problem

Google Search Console reported Watch video structured data issues on
jesusfilm.org: missing `uploadDate`, missing `description`, and missing
`contentUrl` or `embedUrl`. This ticket fixes the metadata fallbacks for
`uploadDate` and `description` while preserving the existing rule that Watch
pages only emit `VideoObject` JSON-LD when the page can provide complete,
honest media metadata. The remaining media URL sample audit is tracked in
`feat-309`.

## Entry Points - Read These First

1. `apps/web/src/lib/experience-metadata.ts` - builds Watch page SEO and
   structured-data metadata models.
2. `apps/web/src/lib/watch-structured-data.ts` - serializes `VideoObject`
   JSON-LD.
3. `apps/web/src/lib/experience-metadata.test.ts` - metadata model coverage.
4. `apps/web/src/lib/watch-structured-data.test.ts` - structured data coverage.
5. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   - route-level Watch JSON-LD smoke coverage.
6. `apps/admin/src/services/video.service.ts` - Watch route snapshot DTO source
   for localized metadata.
7. `apps/admin/src/graphql/types/video.ts` - Pothos field exposure for Watch
   route snapshot locale data.

## Grep These

- `WatchRouteSnapshotLocale`
- `watchVideoLocalizedCopyFragment`
- `structuredDataDescription`
- `localePublishedAt`
- `watchVideoStructuredDataJson`

## What To Build

1. Provide a usable fallback description for structured data when authored
   description/snippet copy is absent.
2. Provide a valid upload date fallback from durable video data.
3. Keep `contentUrl` restricted to crawlable HTTPS media URLs; do not replace it
   with the Watch page URL.
4. Preserve noindex and incomplete-media suppression so invalid VideoObjects are
   not emitted.
5. Track `contentUrl` / `embedUrl` sample investigation as follow-up work
   instead of faking media URLs.

## Constraints

- Do not use the public Watch page URL as `contentUrl` or `embedUrl`.
- Do not broaden page metadata or social metadata fallbacks; keep the
  description fallback structured-data-only.
- Regenerate Admin schema and admin GraphQL client artifacts when exposing
  localized `publishedAt`.
- Preserve noindex suppression and strict media URL eligibility.

## Verification

- Focused metadata and structured-data tests cover missing description,
  missing published date fallback, and missing media suppression.
- `pnpm --filter @forge/web test -- src/lib/experience-metadata.test.ts src/lib/watch-structured-data.test.ts`
- `pnpm --filter @forge/web test -- 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
