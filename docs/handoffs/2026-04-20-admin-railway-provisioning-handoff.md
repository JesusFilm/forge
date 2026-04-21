# Handoff: Provision `apps/admin` on Railway, then continue the migration

**For:** a fresh Claude Code session (you) in the `JesusFilm/forge` repo,
with the Railway remote MCP loaded via `.mcp.json`.
**Written:** 2026-04-20, after PR #798 (R1 scene embeddings) and PR #801
(Railway MCP wiring) merged to main.

---

## Prompt to paste to yourself on first run

> You are continuing Nisal's admin migration work. PR #798 (R1 scene
> embeddings infrastructure) is merged. Admin is NOT yet deployed to
> Railway — no `@forge/admin` service exists in the `forge` project.
> Your job, in order:
>
> 1. Confirm the Railway MCP is loaded (try a tiny read-only call like
>    list-projects). OAuth-approve if prompted.
> 2. **File a roadmap ticket** for admin Railway provisioning before you
>    touch Railway. Place at
>    `docs/roadmap/platform/feat-NNN-admin-railway-provisioning.md`,
>    owner `nisal`, priority P0, depends_on `feat-086`, blocks the R2+
>    migration chain. Body should capture the full env var matrix + the
>    provisioning order (service → Postgres plugin → variables → wire
>    repo → first deploy). Treat the ticket as the durable handoff
>    to tatai for review BEFORE executing — even though you're about
>    to execute, the ticket is the shared trail.
> 3. **Provision admin on Railway** using the MCP tools (not raw GraphQL
>    curls). Execute the checklist below. Stop and ask the user (Nisal)
>    if any tool returns "Not Authorized" or if any decision needs
>    tatai's input (naming, Postgres plan tier).
> 4. **Smoke-test the first deploy**: migrations apply, server boots,
>    `/api/health` returns 200.
> 5. **Validate R1 operationally**: dump the coreId mapping from cms,
>    invoke `triggerSceneEmbeddingBackfill` mutation as ADMIN, confirm
>    `video_scene_locale` rows land with non-null embeddings.
> 6. **Stop at R1 smoke test.** Do NOT start R2 in this session — the R2
>    handoff doc lives on an unmerged branch (see below). Once PR #798
>    merges, a separate session picks up R2.
>
> Canonical docs to read before starting. **Note: the first three live
> on branch `feat/admin-scene-embeddings-r1` (PR #798, not yet merged
> to main).** If your checkout is on main, either pull the branch
> (`git fetch origin feat/admin-scene-embeddings-r1`) to read them, or
> proceed from the handoff + on-main docs alone — the handoff is
> self-contained for provisioning + R1 smoke.
>
> On branch `feat/admin-scene-embeddings-r1` only (PR #798):
>
> - `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
> - `docs/plans/2026-04-19-001-feat-admin-scene-embeddings-infra-plan.md`
> - `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
> - `docs/handoffs/2026-04-20-admin-migration-r2-handoff.md` (for the
>   follow-up R2 session after #798 merges)
>
> On main (always available):
>
> - `apps/admin/CLAUDE.md` (Scene embeddings section — only appears on
>   main after #798 merges; until then, same caveat as above)
> - `apps/admin/railway.toml` (build + start commands, healthcheck)
> - `apps/admin/prisma/migrations/0001_init/migration.sql` (CREATE EXTENSION
>   vector, all tables) — only after #798 merges; on pre-#798 main, the
>   schema doesn't yet include migration 0003 either, which is fine
>   for provisioning but blocks the R1 smoke test
>
> **Shortest path to unblock yourself**: if #798 hasn't merged by the
> time you start, check out the branch (`git checkout feat/admin-scene-embeddings-r1`)
> so you have the migration + mapping script + handoff docs available.
> You can still provision Railway from that branch — Railway picks up
> `main` automatically at deploy time.

---

## Context snapshot

- **PR #798** (R1 scene embeddings): merged; 7 commits. Adds
  `VideoScene` + `VideoSceneLocale` Prisma models + migration 0003,
  scene-embedding indexer service, useworkflow backfill, GraphQL
  mutation `triggerSceneEmbeddingBackfill`, cms `dump:core-id-mapping`
  script, 510 admin tests passing. Review-fix pass applied typed-error
  classification, Promise.allSettled, path-allowlist validation,
  transaction timeout, AbortController on fetch.
- **PR #801** (Railway MCP): merged. `.mcp.json` at repo root points
  Claude Code at `https://mcp.railway.com`. OAuth on first tool use.
- **Admin deployment status**: NOT deployed. `apps/admin/railway.toml`
  is authored and ready, but no service exists in the Railway `forge`
  project. All five existing services are cms/cms-db/manager/web/roadmap.
- **Railway project context** (already in
  `~/.claude/projects/-workspace/memory/railway_prod_credentials.md`):
  - Project: `forge` (id `98952497-a4d9-4714-8fe8-0cdbff3147c9`)
  - Production environment: `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`
  - Service IDs for existing services live in the memory file
- **Doppler** project `forge-admin` already exists per admin's
  `CLAUDE.md` line 28. Variables need to be populated (below).

## The roadmap ticket to file first

Path: `docs/roadmap/platform/feat-104-admin-railway-provisioning.md`
(feat-104 is the next unused number as of 2026-04-20 — highest existing
is feat-103. Confirm by checking `ls docs/roadmap/*/feat-104-*` returns
nothing before writing.)

Frontmatter:

```yaml
---
id: "feat-104"
title: "Provision apps/admin on Railway"
owner: "nisal"
priority: "P0"
status: "in-progress" # or "not-started" until you actually start
start_date: "2026-04-20"
duration: 1
depends_on:
  - "feat-086" # admin foundation
blocks: [] # Nothing formally depends on this yet. R2+ migration work
  # is tracked via docs/brainstorms/ + docs/handoffs/, not
  # roadmap tickets, so there's no blocks entry to add.
tags:
  - "platform"
  - "admin"
  - "railway"
  - "deployment"
---
```

Body should include: the env var matrix below, the provisioning order,
verification steps, and operational runbook for the first-deploy +
R1 backfill smoke test.

## Provisioning checklist (execute via Railway MCP tools)

### Step 1 — Create the Postgres plugin (`@forge/admin/db`)

Deploy Railway's managed Postgres template into the `forge` project,
production environment. Name: `@forge/admin/db` (match the
`@forge/cms/db` naming convention).

**Plan tier:** default to **Hobby** unless tatai specifies otherwise.
Rationale: admin has zero production traffic at R1; Hobby matches the
tier `@forge/cms/db` runs on; Railway lets you upgrade in-place later
without data migration, so this is reversible. If you want tatai's
sign-off before committing, ping him in Slack with a one-liner: _"About
to provision @forge/admin/db on Railway — Hobby plan OK to start,
upgrade later when real traffic lands?"_ Wait ~30 min for a reply;
otherwise proceed with Hobby and document the choice in the roadmap
ticket body (it's reversible).

**Why before the service:** the service needs `DATABASE_URL` wired as
a reference variable at creation time (or shortly after).

**Confirm after:** query the plugin's DATABASE_PUBLIC_URL and
DATABASE_URL reference. pgvector availability should be automatic on
Railway's managed Postgres — verify with a quick
`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'` once
the DB is reachable.

### Step 2 — Create the service (`@forge/admin`)

`serviceCreate` with:

- `projectId`: forge project id
- `name`: `@forge/admin`
- `source.repo`: `JesusFilm/forge`
- `branch`: `main`
- `environmentId`: production

Railway will NIXPACKS-build from the repo root; `apps/admin/railway.toml`
supplies `buildCommand` and `startCommand`.

### Step 3 — Set env vars on the service

Use the MCP `variable-set` / `variableCollectionUpsert` tool.
**Do not commit any of these to the repo.** Values come from Doppler
`forge-admin` or are generated fresh.

| Variable                                                               | Source / value                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                         | Railway reference to the Postgres plugin's `DATABASE_URL`                                                         |
| `DATABASE_URL_SYNC`                                                    | Same as `DATABASE_URL` with `?connection_limit=2` appended, OR reference to a second pooler — implementer decides |
| `OPENROUTER_API_KEY`                                                   | Copy from `@forge/cms` or `@forge/manager` service vars (project memory: these share the key since 2026-04-15)    |
| `BETTER_AUTH_SECRET`                                                   | Generate: `openssl rand -base64 48`                                                                               |
| `BETTER_AUTH_URL`                                                      | `https://admin.jesusfilm.org` (or whatever domain tatai picks)                                                    |
| `AUTH_COOKIE_DOMAIN`                                                   | `.jesusfilm.org`                                                                                                  |
| `AUTH_TRUSTED_ORIGINS`                                                 | `https://web.jesusfilm.org,https://manager.jesusfilm.org`                                                         |
| `CORS_ALLOWED_ORIGINS`                                                 | Same as `AUTH_TRUSTED_ORIGINS`                                                                                    |
| `WORKFLOW_HMAC_SECRET`                                                 | Generate: `openssl rand -hex 32`                                                                                  |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`                         | Optional for R1 (rate limiting). Wire when Redis plugin lands. Service tolerates missing.                         |
| `CORE_API_URL`                                                         | `https://api-gateway.central.jesusfilm.org/` (per memory)                                                         |
| `CORE_API_TOKEN`                                                       | Pull from Doppler `forge-admin` if set; otherwise empty — Core sync phase runners will skip when token absent     |
| `RAILWAY_S3_*`                                                         | Copy from `@forge/cms` or `@forge/manager` (all three apps share the bucket for artifacts)                        |
| `GRAPHQL_INTROSPECTION_ENABLED`                                        | Leave unset in production (defaults off)                                                                          |
| `HOSTNAME`                                                             | `0.0.0.0` (set in railway.toml startCommand already — no-op in env)                                               |
| `NODE_ENV`                                                             | `production`                                                                                                      |
| SSO client ids/secrets (`FACEBOOK_*`, `GOOGLE_*`, `APPLE_*`, `OKTA_*`) | Optional; skip for R1 smoke. Add when tatai provisions the OAuth apps                                             |
| `FIREBASE_*`                                                           | Optional; only needed for the Firebase email/password fallback migration path                                     |

**Add migrate-deploy to start command** — before the first deploy,
update `apps/admin/railway.toml` to prepend `prisma migrate deploy`:

```toml
startCommand = "pnpm --filter @forge/admin db:migrate:deploy && HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js"
```

This was PR #799 (closed) — re-introduce the change as part of the
provisioning PR. Nisal previously closed it pending discussion with
tatai; the discussion resolved to "fail-fast on migrate is the right
default; if it breaks, the deploy rolls back." If tatai wants it
elsewhere (build hook instead of start command), follow his guidance.

### Step 4 — Trigger the first deploy

`serviceInstanceDeployV2` on the service. Watch the build + start logs.

### Step 5 — Verify the deploy

- `/api/health` returns 200.
- Migration logs show `Applying migration '0001_init'`, `'0002_auth'`,
  `'0003_scene_embeddings'`.
- `SELECT * FROM pg_extension WHERE extname = 'vector'` returns a row.
  If not, `CREATE EXTENSION vector` as DB owner, redeploy.
- GraphQL endpoint responds: `curl https://admin.jesusfilm.org/api/graphql -d '{"query":"{__typename}"}'`

### Step 6 — Smoke-test R1

1. Refresh the coreId mapping into shared Railway S3:
   `pnpm --filter @forge/admin refresh:core-id-mapping`. The CLI dumps
   from cms and uploads to `admin-migrations/core-id-mapping.json`.
2. Authenticate as an ADMIN principal (Better Auth login as an admin
   user; seed one if none exists).
3. Invoke (mappingS3Key defaults to the canonical snapshot):
   ```graphql
   mutation {
     triggerSceneEmbeddingBackfill(coreIds: ["<pick one>"], locales: ["en"])
   }
   ```
4. Confirm:
   - Response JSON shows `succeeded: 1`, `failed: 0`.
   - `SELECT COUNT(*) FROM video_scene_locale WHERE embedding IS NOT NULL`
     matches the scene count from that video's artifact.
   - Logs show structured `workflow=scene-embedding-backfill` events.

If the smoke works, the full backfill is an ADMIN-invoked operator
action with `coreIds` / `locales` omitted.

## Move on to R2

After the smoke test passes, open the next handoff and execute R2:

**`docs/handoffs/2026-04-20-admin-migration-r2-handoff.md`**

R2 is transcript embeddings — rides on R1's foundation. Same Prisma
migration pattern, same mapping file, same useworkflow shape.
Critical difference: transcript vectors ARE cached in S3 (per
`apps/manager/src/services/embeddings.ts` `EmbeddingsResult` type),
so the R2 indexer re-indexes without regenerating embeddings.

## Watch-outs

- **Project-scoped Railway token sufficiency**: the existing token at
  `95b9b511-e42c-4b3c-89ab-63f91f8a15d7` is project-scoped. The
  Railway MCP uses OAuth instead, so the token's permission set
  matters less — but if you're forced back to raw GraphQL for any
  reason, this token's ability to `serviceCreate` and
  `templateDeployV2` is UNTESTED. Probe with a dry-run before relying
  on it.
- **Schema drift between admin and cms**: the one-shot coreId mapping
  snapshot is stale as soon as a new video is added to cms. Re-dump
  between backfills. No alerting path today — document this in the
  operational runbook you write.
- **Admin-only mutation auth**: `triggerSceneEmbeddingBackfill`
  requires ADMIN. If no admin user exists yet, seed one via Better
  Auth's account table directly or sign up + role-promote via
  `UPDATE user SET role = 'ADMIN' WHERE email = '...'`.
- **R1 `artifact_missing` regex fix** (from review-fix pass):
  classification now branches on `error instanceof
ManagerArtifactError && error.code === 'artifact_missing'`, not
  regex. If you see unexpected "skipped" or "failed" classifications,
  inspect the error class, not the message.
- **tatai's editor UI work (feat-100, feat-103)** is in flight against
  `apps/admin`. Avoid stepping on it: your provisioning PR should NOT
  modify app code, only `railway.toml` + docs + roadmap ticket.
- **CREATE EXTENSION privilege**: Railway's managed Postgres ships
  pgvector enabled. If the first-deploy migrations fail on CREATE
  EXTENSION (unlikely), follow the 0001_init header comment: run
  `CREATE EXTENSION vector` once as the Railway DB owner, then
  redeploy.

## Success criteria for this handoff

- Roadmap ticket filed with the full env var matrix + checklist.
- Admin service + Postgres plugin live in Railway `forge` project,
  production environment.
- First deploy green; `/api/health` returns 200; 0001/0002/0003
  migrations all applied.
- R1 smoke test: `triggerSceneEmbeddingBackfill` against a single
  coreId produces non-null embeddings in `video_scene_locale`.
- R2 handoff picked up and in progress.

Good luck.
