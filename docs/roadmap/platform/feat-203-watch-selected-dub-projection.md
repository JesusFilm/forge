---
id: "feat-203"
title: "Watch selected dub projection"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-24"
duration: 1
depends_on:
  - "feat-186"
blocks: []
tags:
  - "platform"
  - "web"
  - "admin"
  - "watch-page"
  - "performance"
  - "graphql"
---

## Problem

The Watch single-video page now collapses several web-side Admin GraphQL calls
into one route snapshot, but that snapshot still projects `Video.dubs` for the
target video. Large catalog videos can have thousands of playable dubs, so the
cold page render still asks Admin and Postgres for far more rows than the page
needs before choosing the selected playback language.

## Entry Points - Read These First

1. `apps/admin/src/graphql/types/video.ts` - `Video` fields and root
   `videoBySlug` resolver.
2. `apps/admin/src/services/video.service.ts` - service-owned VideoDub lookup
   helpers.
3. `apps/web/src/lib/fragments/watch-video.ts` - Watch route snapshot
   operation.
4. `apps/web/src/lib/content.ts` - selected variant resolution, language
   picker lazy load, and hero playable-language count.

## Grep These

- `variants: dubs`
- `preferredPlayableDub`
- `playableDubLanguageCount`
- `resolveWatchLanguagePickerVariants`
- `buildHeroBlock`

## What To Build

- Add an Admin GraphQL field that returns one preferred playable `VideoDub`
  for a `Video` and requested watch language.
- Add an Admin GraphQL field that returns the distinct playable language count
  for a `Video`.
- Make the web Watch route snapshot consume the preferred dub plus count
  instead of projecting every dub in the cold render.
- Keep the full dub list available only in the lazy language-picker lookup.

## Constraints

- Do not change public Watch URL shapes.
- Do not remove the lazy language picker options path.
- Do not hand-edit generated GraphQL introspection outputs; regenerate them
  after the Admin SDL change.
- Keep downloads, subtitles, and Mux detail behind the selected `videoDub(id)`
  detail fetch.

## Verification

- Focused Admin service/schema tests cover preferred-dub fallback and language
  count behavior.
- Focused Web fragment/resolver tests prove route snapshots do not project all
  dubs and language-picker lookups still can.
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/web test -- src/lib/fragments/__tests__/watch-video.test.ts src/lib/content.test.ts`
- `pnpm --filter @forge/web probe:watch-video-snapshot --slug <heavy-video-slug> --language-slug english --locale en --runs 9 --json /tmp/watch-video-snapshot.json`
- Typecheck/lint for touched Admin/Web scope.

## Completion Notes

- Added `Video.preferredPlayableDub(languageSlug:)` and
  `Video.playableDubLanguageCount` to Admin GraphQL.
- Updated the Watch route snapshot to request one selected playable dub plus a
  language count instead of the full `Video.dubs` relation.
- Kept the full dub list isolated to the lazy language-picker operation.
- Regenerated `apps/admin/schema.graphql` and
  `packages/admin-graphql/src/admin-graphql-env.d.ts`.
- Added `apps/web/scripts/probe-watch-video-snapshot.ts` so the old full-dub
  snapshot and new selected-dub projection can be compared against the same
  Admin endpoint for bytes and latency before claiming production impact.
