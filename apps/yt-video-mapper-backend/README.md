# yt-video-mapper-backend

Backend workspace app and early product notes for a video-to-source mapper.

This app lives in the Forge monorepo at `apps/yt-video-mapper-backend`.

## Goal

Accept an uploaded video file from an external re-upload and map it back to the
official Jesus Film catalog item, returning both the canonical `coreId` and the
matched `videoVariantId` where possible.

## Commands

From the Forge repo root:

```sh
pnpm --filter @forge/yt-video-mapper-backend dev
pnpm --filter @forge/yt-video-mapper-backend sync:catalog
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
```

## Catalog Sync

`sync:catalog` reads Admin's `videoMapperCatalog(first, after)` GraphQL
projection and upserts mapper-owned `CatalogVideo`, `CatalogVariant`, and
`CatalogSyncRun` rows. It requires:

- `ADMIN_GRAPHQL_URL`
- `ADMIN_SERVICE_BEARER_TOKEN`

Admin remains the catalog source of truth. The mapper tables are a local
projection for matching and indexing.

## Current Artifacts

- `docs/brainstorms/video-source-mapper-requirements.md`
- `docs/handoffs/forge-agent-prompt.md`
- `/docs/prototypes/yt-video-mapper/tickets/README.md`
