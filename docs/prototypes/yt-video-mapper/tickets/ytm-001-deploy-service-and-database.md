---
id: YTM-001
title: "Deploy yt-video-mapper-backend service and database"
status: complete
priority: P1
depends_on: []
---

# YTM-001: Deploy yt-video-mapper-backend service and database

## Goal

Run `apps/yt-video-mapper-backend` as its own backend service with a Postgres
database and production-safe environment variables.

## Scope

- Provision a Railway service for `@forge/yt-video-mapper-backend`.
- Provision or attach Postgres for mapper-owned tables.
- Set `DATABASE_URL`, `MAPPER_API_TOKEN`, `UPLOAD_STORAGE_DIR`,
  `MAX_UPLOAD_BYTES`, `MATCH_RESULT_LIMIT`, `JOB_RESULT_RETENTION_HOURS`, and
  `JOB_RUNNING_STALE_MINUTES`.
- Leave `ADMIN_GRAPHQL_URL` and `ADMIN_SERVICE_BEARER_TOKEN` ready for catalog
  sync work, but do not hard-code them.
- Run Prisma migrations against the service database.
- Verify `GET /health` and authenticated match-job routes from the deployed
  service.

## Acceptance Criteria

- The service boots with `pnpm --filter @forge/yt-video-mapper-backend start`.
- Prisma migrations have been applied to the attached database.
- `GET /health` returns `{ ok: true, service: "yt-video-mapper-backend" }`.
- `POST /match-jobs` rejects missing/invalid bearer tokens in production.
- Deployment notes document whether Railway config lives in dashboard settings
  or a config-as-code path.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend db:migrate:deploy
pnpm --filter @forge/yt-video-mapper-backend build
```
