---
id: "feat-186"
title: "Watch videoBySlug cold-path fanout reduction"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
duration: 1
depends_on:
  - "feat-177"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
  - "graphql"
---

## Problem

Production Watch routes can still spend several Admin GraphQL
`videoBySlug` root-field calls on a cold render. The earlier Watch
performance split removed heavy Dub/download/subtitle payloads from the bulk
path, but shell lookup, localized-copy fallback, carousel mux IDs, series
fallback, and metadata/page render can still fan out under the same Consumer
Bearer rate-limit identity.

During crawler-like bursts across first-seen Watch routes, that root-field
fanout can exhaust the Admin `videoBySlug` budget and surface as 500s on
otherwise valid public Watch URLs.

## Entry Points - Read These First

1. `docs/plans/2026-06-12-004-fix-watch-video-by-slug-fanout-plan.md` -
   implementation plan for this follow-up.
2. `apps/web/src/lib/content.ts` - Watch video, series, episode, and
   Experience fallback resolvers.
3. `apps/web/src/lib/fragments/watch-video.ts` - Admin GraphQL projections
   for Watch video reads.
4. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - catch-all Watch
   route rendering and metadata precedence.
5. `apps/web/src/lib/experience-metadata.ts` - Watch metadata helpers and
   current `getWatchPageMetadata` fallback.

## Grep These

- `resolveWatchVideoBySlug`
- `resolveSeriesBySlug`
- `fetchWatchVideoRecord`
- `GetWatchVideoShellBySlug`
- `GetWatchVideoLocalizedCopyBySlug`
- `GetWatchVideoCarouselMuxPlaybackIds`
- `getWatchPageMetadata`
- `childDubLanguages`

## What To Build

1. Collapse the Watch video cold resolver to one root `videoBySlug` snapshot
   call for shell, localized fallback copy, and carousel mux IDs.
2. Keep selected heavy Dub fields behind the existing `videoDub(id)` detail
   query.
3. Keep `childDubLanguages` out of the base snapshot and fetch it only after a
   route is confirmed series.
4. Make metadata and page render use the same video/series/none route model.
5. Prevent metadata error fallback from re-entering `resolveWatchPage` during
   upstream GraphQL failures.

## Constraints

- Do not change public Watch URL shapes.
- Do not change canonical, Open Graph, or Twitter URL ownership.
- Do not change Admin GraphQL schema or generated introspection outputs.
- Do not increase Admin GraphQL rate limits in this slice.
- Do not fold downloads, subtitles, or every series child language into the
  base route snapshot.

## Verification

- Focused Web resolver and route tests prove the reduced root-field call
  pattern and metadata fallback behavior.
- `@forge/web` typecheck and lint pass for the touched scope.
- Helium browser smoke confirms the affected Watch route still renders video
  or series content.
- Production-style probes/log review confirm the route no longer emits
  `videoBySlug` rate-limit errors for the cold-path scenario.

## Plan

Implementation plan:
`docs/plans/2026-06-12-004-fix-watch-video-by-slug-fanout-plan.md`
