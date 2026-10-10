---
id: "feat-230"
title: "Restore Watch route snapshot publishedAt contract"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-07-02"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "graphql"
  - "cms"
---

## Problem

Production `/watch/a-day-and-a-night-with-creator-sets-free.html/english.html`
returned HTTP 500 after Web deployed SEO metadata that queried
`WatchRouteSnapshot.publishedAt`. Admin's committed schema did not expose that
field, so the public Watch render failed during Admin GraphQL validation.

## Entry Points - Read These First

1. `apps/web/src/lib/fragments/watch-video.ts` - route snapshot query selects
   `publishedAt` for Watch video SEO upload metadata.
2. `apps/admin/src/services/video.service.ts` - `getWatchRouteSnapshotBySlug`
   builds the route-shaped snapshot returned to Web.
3. `apps/admin/src/graphql/types/video.ts` - Pothos
   `WatchRouteSnapshot` GraphQL exposure.
4. `apps/admin/schema.graphql` and
   `packages/admin-graphql/src/admin-graphql-env.d.ts` - generated contract
   artifacts that must be regenerated with schema changes.

## Grep These

- `getWatchVideoRouteSnapshotBySlugOperation`
- `watchVideoRouteSnapshotBySlug`
- `WatchRouteSnapshot`
- `publishedAt`
- `watch_metadata.video.fallback`

## What To Build

- Expose `publishedAt: String` on the root `WatchRouteSnapshot` type.
- Populate it from the root `Video.publishedAt` in
  `getWatchRouteSnapshotBySlug`.
- Regenerate the admin SDL and `@forge/admin-graphql` introspection output.
- Keep the existing web route snapshot query intact so SEO metadata can keep
  using the upload date.

## Constraints

- Do not add `publishedAt` to nested parent or child snapshot types unless a
  consumer starts querying those fields.
- Do not remove `publishedAt` from Web's route snapshot query as the primary
  fix; that backs out part of the SEO metadata feature.
- Never hand-edit generated GraphQL artifacts.

## Verification

1. `DATABASE_URL='postgresql://forge:forge@localhost:5432/forge?schema=public' ADMIN_SESSION_SECRET='0123456789abcdef0123456789abcdef' AUTH_ISSUER_URL='http://localhost:3004' AUTH_ADMIN_CLIENT_ID='admin-local' pnpm --filter @forge/admin schema:print`
2. `pnpm --filter @forge/admin-graphql generate`
3. `pnpm --filter @forge/admin test src/graphql/schema.test.ts src/services/video.service.test.ts`
4. `pnpm --filter @forge/web test src/lib/fragments/__tests__/watch-video.test.ts`
5. `pnpm --filter @forge/admin typecheck`
6. `pnpm --filter @forge/admin-graphql typecheck`
7. `pnpm --filter @forge/web typecheck`
