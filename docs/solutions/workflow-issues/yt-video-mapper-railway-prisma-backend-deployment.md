---
title: "YTM Railway Prisma backend deployment hardening"
date: "2026-06-09"
category: "workflow-issues"
module: "apps/yt-video-mapper-backend"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "high"
applies_when:
  - "Deploying a standalone Railway backend service from an app-local railway.toml"
  - "The service owns Prisma migrations and a custom generated Prisma client output"
  - "Uploaded files are stored before asynchronous job processing"
  - "Production auth/env behavior must fail closed without blocking future optional integrations"
related_components:
  - "database"
  - "authentication"
  - "tooling"
  - "documentation"
tags:
  - "yt-video-mapper"
  - "railway"
  - "prisma"
  - "postgres"
  - "deployment"
  - "persistent-storage"
  - "production-env"
  - "auth-smoke"
---

# YTM Railway Prisma backend deployment hardening

## Context

YTM-001 deployed `@forge/yt-video-mapper-backend` as a standalone Railway
service with its own Postgres database. The risky work was not creating the
service itself; it was proving the production contract that reviewers and
future operators would assume exists:

- Railway must honor the app-local `apps/yt-video-mapper-backend/railway.toml`.
- Prisma migrations must run against the Railway database before the server
  starts.
- The generated Prisma client must exist under `dist/` at runtime.
- Upload bytes must survive a service restart while a `Match Job` is queued.
- Production auth must fail closed without making future catalog-sync env vars
  mandatory too early.

The branch recorded the service/database shape and deployment verification in
`apps/yt-video-mapper-backend/docs/railway-deployment.md`, then the review pass
hardened the deployment contract around `NODE_ENV=production`, persistent
storage, generated-client packaging, and authenticated smoke coverage.

Session history search found no relevant prior sessions for this exact mapper
deployment, so this learning is based on the verified YTM-001 run and related
repo solution docs.

## Guidance

Treat Railway setup as a checked deployment contract, not a dashboard memory
exercise. For app-local Railway config, set the service's Config-as-code Path
to the exact file and verify the deployment record reports it:

```text
apps/yt-video-mapper-backend/railway.toml
configFile: /apps/yt-video-mapper-backend/railway.toml
```

The committed Railway config should own the build command, start command, watch
patterns, healthcheck path, healthcheck timeout, and restart policy:

```toml
[build]
buildCommand = "pnpm install --frozen-lockfile && pnpm --filter @forge/yt-video-mapper-backend build"

[deploy]
startCommand = "pnpm --filter @forge/yt-video-mapper-backend db:migrate:deploy && pnpm --filter @forge/yt-video-mapper-backend start"
healthcheckPath = "/health"
healthcheckTimeout = 60
```

Package the generated Prisma client into the runtime artifact. The mapper
schema outputs Prisma's client to `src/generated/prisma`, which is ignored by
git. TypeScript compilation alone does not make that generated output available
to `node dist/server.js`, so the build must regenerate and copy it:

```json
{
  "build": "rm -rf dist && pnpm run db:generate && tsc -p tsconfig.build.json && rm -rf dist/generated/prisma && mkdir -p dist/generated && cp -R src/generated/prisma dist/generated/prisma"
}
```

Keep required production env vars scoped to the runtime that exists today.
`DATABASE_URL`, `MAPPER_API_TOKEN`, and `NODE_ENV=production` are load-bearing.
`ADMIN_GRAPHQL_URL` and `ADMIN_SERVICE_BEARER_TOKEN` are prepared placeholders
for later catalog sync and must stay optional until that sync is implemented.
Add regression tests around that line so future placeholder vars do not brick a
deploy before their feature ships.

Use durable upload storage in production. The mapper creates a DB-backed job
that points at a stored upload key before processing. If Railway stores those
bytes under `/tmp`, a restart can leave a valid queued job pointing at a missing
file. Mount a persistent app volume at `/data` and set:

```text
UPLOAD_STORAGE_DIR=/data/yt-video-mapper/uploads
```

Smoke the deployed service beyond `/health`. A useful production smoke proves
reachability, missing-token rejection, invalid-token rejection, valid-token job
creation, and the process/poll path:

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

- `/health` returns `200` with the mapper service name.
- Missing and invalid bearer tokens return `401`.
- A valid bearer token returns `202` with a `jobId`.
- Processing and polling that job return `200`.

When `DATABASE_URL` points at Railway's private network host, verify migrations
from inside Railway or from deployment logs. A local shell cannot assume the
private `*.railway.internal` host will resolve. For YTM-001, the successful
deployment logs showed `prisma migrate deploy`, one migration present, and no
pending migrations.

## Why This Matters

A dead `railway.toml` is worse than no config because the repository looks
authoritative while Railway quietly runs dashboard defaults. In a Prisma
service, that can skip `migrate deploy` and leave code and database schema out
of sync.

Generated Prisma clients are another production-only trap. Local development
often has `src/generated/prisma` from a previous command, while a clean Railway
build only has what the build command creates and copies. If `dist/generated`
is missing, TypeScript can pass and production can still fail at module import.

Env validation has two opposite risks. If production allows a missing
`MAPPER_API_TOKEN`, routes can become unauthenticated unless `NODE_ENV` is set
correctly. If production requires future admin-sync vars too early, the service
fails to boot for work intentionally scoped to later YTM tickets. The right
contract is fail closed for current runtime requirements and optional for future
integrations.

Persistent upload storage matters because the database and file system are two
halves of the same `Match Job`. A restart-safe DB row is not useful if the
container file it references vanished with the old instance.

## When to Apply

- A Forge app is deployed as its own Railway backend service.
- The service owns Prisma migrations and uses an app-local `railway.toml`.
- Prisma's generated client is emitted outside `node_modules`.
- The service stores uploaded files before async processing.
- Bearer auth is required in production but allowed to be lighter in local
  development.
- Future integration env vars need to be staged without becoming boot-time
  requirements.

## Examples

Good deployment documentation includes both the desired config and the observed
Railway reality:

```text
Config-as-code Path: apps/yt-video-mapper-backend/railway.toml
Deployment configFile: /apps/yt-video-mapper-backend/railway.toml
Start command: pnpm --filter @forge/yt-video-mapper-backend db:migrate:deploy && pnpm --filter @forge/yt-video-mapper-backend start
Healthcheck: /health
Upload storage: /data/yt-video-mapper/uploads on a persistent app volume
```

Good env tests exercise the production boundary directly:

```typescript
await loadEnv({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://forge:forge@localhost:5432/mapper",
  MAPPER_API_TOKEN: "a".repeat(32),
  ADMIN_GRAPHQL_URL: "",
  ADMIN_SERVICE_BEARER_TOKEN: "",
})

expect(assertRuntimeEnv).not.toThrow()
```

Avoid these shortcuts:

- Stopping verification at `/health`.
- Trusting a committed app-local `railway.toml` without checking `configFile`.
- Storing queued job uploads under `/tmp` in production.
- Requiring opt-in future integration vars at schema load.
- Assuming `prisma generate` during install means the generated client exists
  under `dist/` after TypeScript compilation.

## Related

- [Railway dashboard config silently shadows per-service `apps/<svc>/railway.toml`](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md) - same config-as-code pitfall; YTM-001 is the positive case where `configFile` was verified.
- [New App CI & Deployment Patterns](../platform/new-app-ci-and-deployment-patterns.md) - broader new-app deployment checklist; YTM-001 adds a Node/Prisma backend variant.
- [yt-video-mapper backend app durable match job upload poll process pattern](../platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md) - same module's async job and upload contract.
- [Local admin CMS broke after pulling main - stale Prisma client + DB behind two migrations](../database-issues/admin-prisma-client-and-db-migration-drift-after-pull-20260603.md) - related two-layer Prisma drift: generated client and database schema both matter.
- [Required Zod env var without default broke Railway deploy of opt-in scaffolding](../runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md) - why future opt-in env vars should stay optional.
- [Railway remote MCP config edits need `accept-deploy` to flush](../platform/railway-mcp-staged-config-never-commits-20260420.md) - relevant when Railway settings are changed through MCP tools.
- [Verify infra writes via an independent read path](../best-practices/verify-infra-writes-via-independent-read-path-20260420.md) - the meta-pattern behind checking deployment records, logs, and live endpoints.
- [Optional Railway S3 with local fallback storage](../platform/optional-railway-s3-local-fallback.md) - storage-path discipline adjacent to the mapper's Railway volume.
