---
id: YTM-003
title: "Sync Admin catalog projection into mapper tables"
status: complete
priority: P1
depends_on:
  - YTM-002
---

# YTM-003: Sync Admin catalog projection into mapper tables

## Goal

Populate mapper-owned `CatalogVideo` and `CatalogVariant` rows from Admin so the
matcher has a broad catalog with a lightweight `coreId + title` map.

## Scope

- Add an Admin GraphQL client using `ADMIN_GRAPHQL_URL` and
  `ADMIN_SERVICE_BEARER_TOKEN`.
- Implement full sync from the flat projection created in YTM-002.
- Upsert `CatalogVideo` by `coreId`, including title and title locale.
- Upsert `CatalogVariant` by `coreId + videoVariantId`, including language,
  edition, duration, media source type, and media source URL.
- Mark missing or deleted variants as not indexable instead of hard-deleting by
  default.
- Record `CatalogSyncRun` status, counters, cursor, and failure summary.

## Acceptance Criteria

- A sync can run repeatedly without duplicating catalog rows.
- The sync records how many videos, variants, and indexable variants were seen.
- Failed pages or malformed variants are captured in a safe failure summary.
- The mapper database contains a queryable `coreId + title` map.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
```
