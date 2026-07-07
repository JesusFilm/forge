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
pnpm --filter @forge/yt-video-mapper-backend index:media
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

## Media Indexing

`index:media` indexes official media signatures from local `CatalogVariant`
projection rows where Admin marked the variant indexable. It records an
`IndexRun`, writes versioned `MediaSignature` rows, skips variants already
indexed for the same algorithm version, and captures per-variant failures
without stopping the whole run.

Optional runtime settings:

- `MEDIA_SIGNATURE_ALGORITHM_VERSION` defaults to
  `official-media-signature-v1`
- `MEDIA_INDEX_PAGE_SIZE` defaults to `100`
- `MEDIA_INDEX_MAX_FETCH_BYTES` defaults to `262144`
- `MEDIA_INDEX_FETCH_TIMEOUT_MS` defaults to `15000`
- `MEDIA_INDEX_ALLOWED_HOSTS` optionally restricts official media fetches to
  comma-separated exact hostnames
- `MEDIA_INDEX_RESUME_AFTER_VARIANT_ID` resumes after a stored
  `CatalogVariant.id` cursor

## Matching

`/match-jobs` accepts either raw media bytes or a `multipart/form-data` upload
with a file/media part. It uses local mapper state only. The default server
extracts deterministic uploaded-video signals, retrieves against
`MediaSignature` rows for the configured `MEDIA_SIGNATURE_ALGORITHM_VERSION`,
joins active `CatalogVariant` metadata, and returns public candidates with:

- `coreId`
- `videoVariantId`
- `confidence`
- `matchStrength`

Completed jobs are terminal even when no candidates match. Polling returns an
explicit envelope:

```json
{ "jobId": "job-id", "status": "complete", "candidates": [] }
```

The first matcher uses deterministic structural byte-sample evidence as the
source-video anchor, plus duration and optional text/audio evidence when real
source data exists. It does not synthesize audio fingerprints.

The server starts a bounded Match Job worker by default. The worker claims the
oldest queued or stale-running job, processes one job at a time, then polls for
more work. Set `MATCH_JOB_WORKER_ENABLED=false` to disable the loop for an
operator session, and tune `MATCH_JOB_WORKER_POLL_INTERVAL_MS` only when the
default 1 second idle poll is too chatty or too slow.

The server also starts a Match Job Cleaner. It runs every minute, expires
queued jobs that have remained unclaimed for 30 minutes, deletes their raw
uploads, and keeps the lightweight job row pollable as:

```json
{ "jobId": "job-id", "status": "expired", "errorCode": "job_expired" }
```

Running jobs are not expired by the cleaner; stale running jobs remain owned by
the worker reclaim path. The manual process endpoint can still rescue an
overdue queued job until the cleaner marks it `expired`.

Before production smoke tests can return non-empty candidates, run:

```sh
pnpm --filter @forge/yt-video-mapper-backend db:migrate:deploy
pnpm --filter @forge/yt-video-mapper-backend sync:catalog
pnpm --filter @forge/yt-video-mapper-backend index:media
```

## Current Artifacts

- `docs/brainstorms/video-source-mapper-requirements.md`
- `docs/handoffs/forge-agent-prompt.md`
- `/docs/prototypes/yt-video-mapper/tickets/README.md`
