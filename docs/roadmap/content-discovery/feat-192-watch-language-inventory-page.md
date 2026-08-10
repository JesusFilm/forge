---
id: "feat-192"
title: "Watch Language Inventory Page"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 2
depends_on: []
blocks:
  - "feat-253"
  - "feat-335"
tags:
  - "web"
  - "watch"
  - "content-discovery"
  - "i18n"
---

## Problem

Regional leads and missionaries need one public Watch page that shows what is
available in a Watch language. The existing `/watch/videos` route is only a
placeholder, and localized language inventory URLs do not exist, so leaders
cannot scan all collections and videos with audio first and subtitle-only
content second.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/videos/page.tsx` - current `/videos`
   placeholder route and static metadata contract.
2. `apps/web/src/lib/routes.ts` - public Watch route builders; links must use
   public audio language slugs.
3. `apps/web/src/components/home/WatchHomeCard.tsx` and
   `apps/web/src/components/home/WatchHomeSection.tsx` - existing image-forward
   Watch card styling.
4. `apps/admin/src/graphql/types/video.ts` and
   `apps/admin/src/services/video.service.ts` - admin public video query surface
   and efficient raw SQL patterns.
5. `apps/admin/src/services/watch-route-manifest.service.ts` - existing SQL for
   language-aware playable audio coverage.

## Grep These

- `VideosPage` in `apps/web/messages/*.json` and the `/videos` route tests.
- `watchHomeVideos` and `VideoMapperCatalogItem` in admin GraphQL for
  objectRef/query patterns.
- `playable_video_audio` and `parent_video_audio` in admin services for
  language coverage SQL.
- `watchVideoPath`, `watchEpisodePath`, and `videosIndexPath` in web route
  helpers.

## What To Build

1. Add an admin public read model for language inventory.
   - Resolve one language by public language slug.
   - Return bounded, grouped rows for published Watch content with playable
     audio in that language.
   - Return subtitle-only rows where a published subtitle exists for that
     language and no playable dub exists for the same video.
   - Include collection/series rows separately from leaf video rows, plus enough
     display fields for Watch cards without fetching full dub graphs.
2. Replace the `/watch/videos` placeholder and add localized inventory pages.
   - Keep `/watch/videos` as the default index.
   - Add `/watch/{language}.html/videos` for language-specific inventories.
   - Use the public route language slug to drive the inventory language.
   - Put a language summary and promoted/new-in-language content first.
   - List collections and videos with audio before subtitle-only content.
   - Build every Watch link with public audio language slugs through route
     helpers.
3. Add focused coverage.
   - Admin service/query tests for audio rows, subtitle-only exclusion, grouping,
     and limits.
   - Web resolver/page tests for route language, empty/error states, canonical
     metadata, and section ordering.

## Constraints

- Do not fetch every dub for every video in Watch.
- Do not use internal UI locale keys such as `en` as public Watch URL segments.
- Do not change existing Watch video, episode, or home URL shapes.
- Do not hand-edit generated GraphQL env outputs; regenerate after schema
  changes.
- Keep `/watch/videos` canonical without a `.html` suffix.
- Keep language-specific inventory URLs shaped as
  `/watch/{language}.html/videos`, with `videos` remaining `.html`-free.

## Verification

- `pnpm --filter @forge/admin test -- src/services/video.service.test.ts src/graphql/schema.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/videos/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Helium browser smoke for `/watch/{language}.html/videos` with screenshot
  proof.

## Plan

Implementation plan:
`docs/plans/2026-06-16-001-feat-watch-language-inventory-plan.md`
