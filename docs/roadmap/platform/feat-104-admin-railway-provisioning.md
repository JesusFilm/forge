---
id: "feat-104"
title: "Provision apps/admin on Railway"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-04-20"
duration: 1
depends_on:
  - "feat-086"
blocks: []
tags:
  - "platform"
  - "admin"
  - "railway"
  - "deployment"
---

## Problem

`apps/admin` is feature-complete through Unit 13 and PR #798 (R1 scene
embeddings infrastructure) is merged to main, but no `@forge/admin`
service exists in the Railway `forge` project. Without a deployed admin
instance, the R1 backfill mutation (`triggerSceneEmbeddingBackfill`)
cannot be smoke-tested against production data, which gates the R2+
migration chain (transcript embeddings, core-sync hardening, and all
admin-driven editorial operations). This ticket captures the
provisioning sequence so tatai can review the env var matrix, Postgres
tier choice, and startCommand migrate-deploy change before the first
deploy lands in production.

## Entry Points — Read These First

1. `docs/handoffs/2026-04-20-admin-railway-provisioning-handoff.md` — canonical handoff that this ticket operationalizes; contains the full checklist, env var rationale, and watch-outs.
2. `apps/admin/CLAUDE.md` — app stack, Doppler project name (`forge-admin`), deployment caveats.
3. `apps/admin/railway.toml` — build + start commands, healthcheck config; startCommand must be updated to prepend `prisma migrate deploy` during this work.
4. `apps/admin/prisma/migrations/0001_init/migration.sql` — first migration; enables `CREATE EXTENSION vector`.
5. `apps/admin/prisma/migrations/0003_scene_embeddings/` — R1 migration; lands `video_scene` + `video_scene_locale` tables with HNSW index.
6. `apps/cms/src/api/scene-embedding/services/indexer.ts` — reference `toPgArray` helper; same PG 18 caveat applies to admin's raw SQL paths.
7. `~/.claude/projects/-workspace/memory/railway_prod_credentials.md` — project/service/environment IDs for the Railway `forge` project.

## Grep These

- `@forge/admin` in repo root (`railway.toml`, `package.json` workspaces)
- `DATABASE_URL|DATABASE_URL_SYNC|BETTER_AUTH_|AUTH_COOKIE_DOMAIN|AUTH_TRUSTED_ORIGINS|WORKFLOW_HMAC_SECRET|OPENROUTER_API_KEY|CORE_API_URL|CORE_API_TOKEN|RAILWAY_S3_` in `apps/admin/src/config/env.ts`
- `pgvector|CREATE EXTENSION` in `apps/admin/prisma/`
- `triggerSceneEmbeddingBackfill` in `apps/admin/src/graphql/`
- `dump:core-id-mapping` in `apps/cms/`

## What To Build

### Provisioning order (DO NOT reorder)

1. **Postgres plugin `@forge/admin/db`** — deploy Railway managed
   Postgres template into `forge` / production. Plan: **Hobby** (match
   `@forge/cms/db`; upgrade in place later, reversible). pgvector ships
   enabled; verify via `SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`.
2. **Service `@forge/admin`** — `serviceCreate` against
   `JesusFilm/forge` main branch in `forge` / production. NIXPACKS
   builder honors `apps/admin/railway.toml`.
3. **Env vars** — set via MCP `variable-set`. Matrix below. Do NOT
   commit values to the repo.
4. **Update `apps/admin/railway.toml`** — prepend migrate-deploy to
   startCommand (re-introduction of PR #799; see below).
5. **First deploy** — `serviceInstanceDeployV2`.
6. **Verify + smoke-test** — see Verification section.

### Env var matrix

| Variable                                            | Source / value                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                      | Railway reference to `@forge/admin/db` `DATABASE_URL`                                                    |
| `DATABASE_URL_SYNC`                                 | `DATABASE_URL` with `?connection_limit=2` appended (OR second pooler)                                    |
| `OPENROUTER_API_KEY`                                | Copy from `@forge/cms` or `@forge/manager` service vars (shared key since 2026-04-15 per project memory) |
| `BETTER_AUTH_SECRET`                                | Generate: `openssl rand -base64 48`                                                                      |
| `BETTER_AUTH_URL`                                   | `https://admin.jesusfilm.org` (pending tatai's final domain pick)                                        |
| `AUTH_COOKIE_DOMAIN`                                | `.jesusfilm.org`                                                                                         |
| `AUTH_TRUSTED_ORIGINS`                              | `https://web.jesusfilm.org,https://manager.jesusfilm.org`                                                |
| `CORS_ALLOWED_ORIGINS`                              | Same as `AUTH_TRUSTED_ORIGINS`                                                                           |
| `WORKFLOW_HMAC_SECRET`                              | Generate: `openssl rand -hex 32`                                                                         |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`      | Optional for R1; wire when Redis plugin lands                                                            |
| `CORE_API_URL`                                      | `https://api-gateway.central.jesusfilm.org/`                                                             |
| `CORE_API_TOKEN`                                    | Pull from Doppler `forge-admin` if present; skip otherwise                                               |
| `RAILWAY_S3_*`                                      | Copy from `@forge/cms` or `@forge/manager` (shared bucket)                                               |
| `GRAPHQL_INTROSPECTION_ENABLED`                     | Leave unset in production (defaults off)                                                                 |
| `NODE_ENV`                                          | `production`                                                                                             |
| `HOSTNAME`                                          | Set to `0.0.0.0` in railway.toml startCommand — no env var needed                                        |
| SSO (`FACEBOOK_*`, `GOOGLE_*`, `APPLE_*`, `OKTA_*`) | Optional; skip for R1 smoke                                                                              |
| `FIREBASE_*`                                        | Optional; only needed for Firebase fallback migration path                                               |

### railway.toml change (re-introduce PR #799)

```toml
startCommand = "pnpm --filter @forge/admin db:migrate:deploy && HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js"
```

Rationale: fail-fast on migrate is the right default; if it breaks, the
deploy rolls back. If tatai wants it moved to a build hook, follow his
guidance.

## Constraints

- **Use the Railway MCP tools, not raw GraphQL curls.** OAuth is already
  approved for this session.
- **Do NOT modify admin app code** in the provisioning PR — only
  `railway.toml` + docs + this roadmap ticket. tatai's editor UI work
  (feat-100, feat-103) is in flight against `apps/admin`.
- **Never commit secrets.** All env var values live in Railway / Doppler.
- **Stop and ask Nisal** if any MCP tool returns `Not Authorized`, or if
  any decision needs tatai's input (naming, Postgres tier, domain).
- **Do NOT start R2 in this session.** Stop after the R1 smoke test
  passes. R2 is its own handoff.

## Verification

### Completion evidence

Verified 2026-05-19 via Railway GraphQL project token and live production
endpoints:

- Railway `forge` / `production` has service `@forge/admin`
  (`bdb15048-1ca9-4217-ae01-ef7cc19ca6f4`).
- Latest deployment `5e8d4569-bb61-4037-ba86-3a239f6f6a71` is `SUCCESS`.
- Custom domain `admin.jesusfilm.org` and Railway service domain
  `forgeadmin-production-f4d1.up.railway.app` are attached.
- Service start command runs `pnpm --filter @forge/admin db:migrate:deploy`
  before starting the standalone Next.js server.
- `https://admin.jesusfilm.org/api/health` returns HTTP 200.
- `https://admin.jesusfilm.org/api/graphql` responds to `{ __typename }`
  with `{"data":{"__typename":"Query"}}`.

### Deploy health

- `/api/health` returns 200.
- Build logs show `Applying migration '0001_init'`, `'0002_auth'`, `'0003_scene_embeddings'`.
- `SELECT extname FROM pg_extension WHERE extname = 'vector'` returns one row.
- `curl https://<admin-url>/api/graphql -d '{"query":"{__typename}"}'` responds with `{"data":{"__typename":"Query"}}`.

### R1 smoke test

1. Refresh the coreId mapping into the shared Railway S3 bucket:
   ```
   pnpm --filter @forge/admin refresh:core-id-mapping
   ```
   The CLI dumps from cms and uploads the snapshot to
   `admin-migrations/core-id-mapping.json`.
2. Authenticate as an ADMIN principal (Better Auth login; seed via
   `UPDATE user SET role = 'ADMIN' WHERE email = '...'` if no admin
   exists).
3. Invoke (mappingS3Key defaults to the canonical snapshot — omit unless
   running a dry run with an alt snapshot):
   ```graphql
   mutation {
     triggerSceneEmbeddingBackfill(coreIds: ["<pick one>"], locales: ["en"])
   }
   ```
4. Confirm:
   - Response shows `succeeded: 1`, `failed: 0`.
   - `SELECT COUNT(*) FROM video_scene_locale WHERE embedding IS NOT NULL`
     equals the scene count from that video's artifact.
   - Logs show structured `workflow=scene-embedding-backfill` events.

## Watch-outs

- **pgvector CREATE EXTENSION privilege**: Railway managed Postgres ships
  pgvector available. If migrations fail on `CREATE EXTENSION`, run it
  once as the DB owner and redeploy.
- **Schema drift**: the coreId mapping snapshot goes stale as soon as a
  new video lands in cms. Re-dump between backfills. No alerting today.
- **Admin-only mutation auth**: `triggerSceneEmbeddingBackfill` requires
  ADMIN. Seed one if none exists.
- **Project-scoped token fallback**: existing token
  `95b9b511-e42c-4b3c-89ab-63f91f8a15d7` is project-scoped; its ability
  to `serviceCreate` / `templateDeployV2` is UNTESTED. MCP uses OAuth so
  this rarely matters, but probe before relying on the token.
- **R2+ migration chain**: tracked via `docs/brainstorms/` +
  `docs/handoffs/`, not roadmap tickets — `blocks: []` is correct even
  though downstream work depends on this completing.
