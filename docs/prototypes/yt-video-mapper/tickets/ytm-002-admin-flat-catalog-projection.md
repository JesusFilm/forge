---
id: YTM-002
title: "Add Admin flat catalog projection for mapper sync"
status: complete
priority: P1
depends_on: []
---

# YTM-002: Add Admin flat catalog projection for mapper sync

## Goal

Expose a bounded Admin GraphQL projection that lets the mapper page through
indexable video variants without nested all-video/all-dub fan-out.

## Scope

- Add an Admin GraphQL query intended for mapper catalog sync.
- Page by `VideoDub` or the closest Admin variant-level entity.
- Include Core-facing identity fields:
  - source video `Video.coreId`
  - source title for the lightweight `coreId + title` map
  - dub/variant `VideoDub.coreId` as `videoVariantId`
  - Admin video and dub IDs for debugging
  - language, locale, edition, duration, and media source URLs
- Include enough published/deleted/indexable state for the mapper to skip bad
  variants.
- Generate Admin GraphQL types after schema changes.

## Acceptance Criteria

- Query is cursor-paginated and safe for broad catalog sync.
- Query does not load every nested relation for every video.
- Tests cover pagination and fields needed by the mapper.
- Generated `apps/admin/schema.graphql` and `packages/admin-graphql` outputs are
  updated if the Admin schema changes.

## Verification

```sh
pnpm --filter @forge/admin test video-mapper-catalog
DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' VIDEO_MAPPER_CATALOG_DB_TEST=1 pnpm --filter @forge/admin test video-mapper-catalog.db
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/admin-graphql typecheck
```
