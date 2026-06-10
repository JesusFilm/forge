# Railway Deployment

`apps/yt-video-mapper-backend` deploys as a standalone Railway backend service
for the yt-video-mapper prototype.

## Service Shape

- Service name: `@forge/yt-video-mapper-backend`
- Railway service ID: `b120d4c6-ed62-4b86-a491-87de0dd4a00f`
- Railway database service: `@forge/yt-video-mapper-backend/db`
- Railway database service ID: `2e6958c3-2949-45ba-a923-1e7452e4d0eb`
- Railway project: `forge`
- Railway environment: `production`
- App path: `apps/yt-video-mapper-backend`
- Healthcheck path: `/health`
- Local port: `3010`
- Railway service domain:
  `https://forgeyt-video-mapper-backend-production.up.railway.app`

## Build And Start

This service is intended to use config-as-code. Set the Railway service's
Config-as-code Path to `apps/yt-video-mapper-backend/railway.toml`.

The committed config declares:

- Build command:
  `pnpm install --frozen-lockfile && pnpm --filter @forge/yt-video-mapper-backend build`
- Start command:
  `pnpm --filter @forge/yt-video-mapper-backend db:migrate:deploy && pnpm --filter @forge/yt-video-mapper-backend start`
- Healthcheck path:
  `/health`
- Healthcheck timeout:
  `60s`

If Railway dashboard settings are used instead, mirror those values exactly and
document the dashboard as canonical. Do not rely on the app-local
`railway.toml` unless the deployment record shows it was honored.

## Env Vars

Required for production:

- `DATABASE_URL=<Railway Postgres DATABASE_URL reference>`
- `MAPPER_API_TOKEN=<runtime secret, at least 32 characters>`
- `NODE_ENV=production`
- `UPLOAD_STORAGE_DIR=/data/yt-video-mapper/uploads`
- `MAX_UPLOAD_BYTES=100000000`
- `MATCH_RESULT_LIMIT=3`
- `JOB_RESULT_RETENTION_HOURS=168`
- `JOB_RUNNING_STALE_MINUTES=30`

Required when running catalog sync:

- `ADMIN_GRAPHQL_URL=<admin GraphQL URL>`
- `ADMIN_SERVICE_BEARER_TOKEN=<admin service bearer token>`

Do not hard-code any secret values in the repo.

## Initial Verification

After the Railway service and database are provisioned:

```bash
pnpm --filter @forge/yt-video-mapper-backend db:migrate:deploy
pnpm --filter @forge/yt-video-mapper-backend build
```

Then verify the deployed service:

```bash
MAPPER_BASE_URL="https://forgeyt-video-mapper-backend-production.up.railway.app"

curl "$MAPPER_BASE_URL/health"
curl -i -X POST "$MAPPER_BASE_URL/match-jobs"
curl -i -X POST "$MAPPER_BASE_URL/match-jobs" \
  -H "Authorization: Bearer invalid"
curl -i -X POST "$MAPPER_BASE_URL/match-jobs" \
  -H "Authorization: Bearer $MAPPER_API_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "smoke-video"
```

Expected results:

- `GET /health` returns `{ "ok": true, "service": "yt-video-mapper-backend" }`.
- `POST /match-jobs` without a bearer token returns `401`.
- `POST /match-jobs` with an invalid bearer token returns `401`.
- `POST /match-jobs` with the valid mapper token returns `202` and a `jobId`.

## Catalog Sync

Run one Admin-to-mapper catalog projection sync with:

```bash
pnpm --filter @forge/yt-video-mapper-backend sync:catalog
```

The command uses Admin GraphQL only. It writes mapper-owned `CatalogVideo`,
`CatalogVariant`, and `CatalogSyncRun` rows, prints safe counters, and exits
non-zero if the sync run records a failed status.

## 2026-06-09 Provisioning Notes

- Railway config is intended to be config-as-code via
  `apps/yt-video-mapper-backend/railway.toml`.
- Railway production is configured as config-as-code. Deployment
  `f15835f6-2447-4a99-b336-ddabea796ccd` recorded
  `configFile: /apps/yt-video-mapper-backend/railway.toml`; the build command,
  start command, and `/health` healthcheck came from that file.
- Created Postgres service `@forge/yt-video-mapper-backend/db` from Railway's
  SSL-enabled Postgres 18 image with a persistent volume mounted at
  `/var/lib/postgresql/data` in `us-west2`.
- Created a persistent app volume mounted at `/data` in `us-west2` and set
  `UPLOAD_STORAGE_DIR=/data/yt-video-mapper/uploads` so queued uploads survive
  service restarts until a worker processes them.
- Set app service env vars for `DATABASE_URL`, `MAPPER_API_TOKEN`,
  `UPLOAD_STORAGE_DIR`, `MAX_UPLOAD_BYTES`, `MATCH_RESULT_LIMIT`,
  `JOB_RESULT_RETENTION_HOURS`, and `JOB_RUNNING_STALE_MINUTES`.
- Added empty Railway placeholders for `ADMIN_GRAPHQL_URL` and
  `ADMIN_SERVICE_BEARER_TOKEN`; catalog sync can populate them later without
  code changes.
- Startup ran `pnpm --filter @forge/yt-video-mapper-backend db:migrate:deploy`
  against the Railway private Postgres URL. The successful deployment logs show
  one migration present and no pending migrations.
- Verified public `GET /health` returns
  `{ "ok": true, "service": "yt-video-mapper-backend" }`.
- Verified public `POST /match-jobs` returns `401` for both missing and invalid
  bearer tokens.
- Verified public authenticated `POST /match-jobs` returns `202`, creates a
  durable queued job, and the explicit process/poll path returns `200`.
