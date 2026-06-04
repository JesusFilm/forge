---
title: "Local admin CMS broke after pulling main — stale Prisma client + DB behind two migrations"
date: "2026-06-03"
category: "database-issues"
module: "apps/admin"
problem_type: "database_issue"
component: "database"
symptoms:
  - "Every GraphQL request 500s at schema build — `PothosSchemaError: Field 'language' not found in model 'VideoLocale'`"
  - "Full video query 500s at execution — `The column video_locale.language_id does not exist in the current database`"
  - 'Mobile app shows "Video Not Found" for all videos while the admin home feed loads'
root_cause: "incomplete_setup"
resolution_type: "migration"
severity: "high"
related_components:
  - "tooling"
tags:
  - "prisma"
  - "migration-drift"
  - "prisma-generate"
  - "migrate-deploy"
  - "pothos"
  - "admin-graphql"
  - "local-dev"
  - "database-url"
---

# Local admin CMS broke after pulling main — stale Prisma client + DB behind two migrations

## Problem

After teammate PR #1089 ("sync localized watch metadata") landed on `main`, the local admin CMS GraphQL (`apps/admin`, Next.js + Pothos + Prisma) failed to serve any video — the mobile app showed "Video Not Found" for every video — because the local environment had drifted from `main` in **two independent layers**: a stale generated Prisma client _and_ two un-applied DB migrations. Fixing one left the other broken.

## Symptoms

Three distinct, sequential failures — each only surfaced after the previous was fixed:

1. **Every GraphQL request 500s at schema build.** Pothos can't even assemble the schema:

   ```
   PothosSchemaError: Field 'language' not found in model 'VideoLocale'
   ```

   The home page won't load; no query runs.

2. **After the schema builds, the full video query 500s at execution time.** A minimal `videoBySlug(slug)` works, but selecting `locales` fails:

   ```
   The column video_locale.language_id does not exist in the current database
   ```

   In the consumer app this surfaces only as **"Video Not Found"** — the server-side column error is invisible from the mobile UI.

3. **`prisma migrate status` can't even reach the database** on the first attempt:
   ```
   Error: P1001: Can't reach database server at `db`:`5432`
   ```

## What Didn't Work

- **"Do I need to run a core sync again?"** (the first instinct) — No. A core/data sync writes DATA rows; it cannot create a column. Run against a DB missing `video_locale.language_id`, the sync's writes fail with the same `column ... does not exist` error. The schema migration must come first; sync is downstream of DDL.

- **`prisma migrate status` against the `.env` `DATABASE_URL`** — failed with `P1001 Can't reach database server at db:5432`. `apps/admin/.env` sets `DATABASE_URL="postgresql://forge:***@db:5432/forge_admin"` — `db` is a Docker-Compose service hostname, unresolvable from a plain host shell. The running server and the real database are at `127.0.0.1:5433/forge_admin` (from `apps/admin/.env.local`). Every Prisma CLI command must be pointed at that host-reachable URL.

- **`prisma generate` alone** — fixed the schema-build 500 (symptom 1) so the home page and a minimal `videoBySlug` worked, but did NOT fix the column-missing query error (symptom 2). These are two distinct drift layers; regenerating the client does not touch the database schema.

## Solution

Fix both drift layers, in order. (Passwords redacted as `***`.)

**1. Regenerate the Prisma client** — picks up `VideoLocale.language` from #1089, fixes the schema-build 500:

```bash
pnpm --filter @forge/admin exec prisma generate
# restart the admin dev server so it loads the regenerated client
```

After this, the home page loads and a minimal `videoBySlug(slug)` resolves.

**2. Apply the pending migrations** against the _actual running DB_ (the `127.0.0.1:5433` URL from `.env.local`, NOT the `db:5432` URL from `.env`):

```bash
DATABASE_URL="postgresql://forge:***@127.0.0.1:5433/forge_admin" \
  pnpm --filter @forge/admin exec prisma migrate deploy
```

This applies the two pending migrations non-destructively:

- `0026_video_locale_language_identity` — `ALTER TABLE "video_locale" ADD COLUMN "language_id" TEXT, ADD COLUMN "source" "SourceTier" NOT NULL DEFAULT 'core', ADD COLUMN "synced_at" TIMESTAMP(3), ADD COLUMN "deleted_at" TIMESTAMP(3);` followed by an **embedded backfill** that fills `language_id` from the existing `language` table (matching `language.bcp47` to `video_locale.locale`), plus the FK, `@@unique(video_id, language_id)`, and supporting indexes.
- `0027_video_localized_language_slug_identity` — adds `language_slug` / `language_core_id` and reshapes locale uniqueness.

Expected output:

```
All migrations have been successfully applied. Database schema is up to date!
```

**3. No admin restart needed after `migrate deploy`** — Prisma runs fresh SQL against the now-migrated DB. `videoBySlug.locales` then returns `{ status: PUBLISHED }`, and the mobile app loads `birth-of-jesus` (3:42) with subtitles rendering.

**4. Core sync is NOT required to fix the crash.** Migration `0026`'s embedded backfill already populates `language_id` from the existing `Language` relation, so videos load immediately with correct data. Run a core sync (e.g. `core-sync:backfill-video-localized-metadata`) only afterward, and only if you want to refresh the localized metadata DATA itself.

Prefer `prisma migrate deploy` (applies pending migrations, non-destructive) over `prisma migrate dev` (which can prompt or reset on drift) whenever migrations are cleanly pending — this is also the forward-only invocation admin uses in deployed environments.

## Why This Works

The two failures are two layers of the same root drift, and each needs its own fix:

- **Layer 1 — stale generated client.** Pothos builds the GraphQL schema by reflecting over the _generated_ Prisma client's DMMF. PR #1089 added the `VideoLocale.language` relation in `schema.prisma` and a `t.relation("language", ...)` on the Pothos `VideoLocale` type in `src/graphql/types/video.ts`. With a stale client, `language` isn't in the DMMF, so `builder.toSchema()` throws `PothosSchemaError: Field 'language' not found in model 'VideoLocale'` before any request runs. `prisma generate` rebuilds the DMMF from the current `schema.prisma`, so the relation exists and the schema assembles.

- **Layer 2 — un-applied migrations.** Regenerating the client makes the schema _build_, but the resolver still issues SQL against a database that physically lacks the column. The `videoBySlug` → `getBySlug` path selects the `locales` relation, which (via `languageId`) reads `video_locale.language_id`. With migration `0026` un-applied, that column doesn't exist and Postgres rejects the SELECT at query time. `migrate deploy` runs the `ADD COLUMN` DDL so the column exists, and `0026`'s embedded backfill fills it from the already-present `Language` relation — which is exactly why videos load correctly with no separate sync step.

The ordering is the load-bearing insight: **a column must exist (DDL/migration) before any data can be written to it (sync).** Putting the backfill _inside_ `0026` collapses "create the column" and "populate it" into one non-destructive step.

## Prevention

**Diagnostic ladder — after pulling `main`, if local admin GraphQL fails, suspect two-layer drift:**

1. `PothosSchemaError: Field '<x>' not found in model '<Model>'` / 500 on every request, including the home page → stale generated Prisma CLIENT. Fix: `pnpm --filter @forge/admin exec prisma generate`, then restart the dev server.
2. A minimal query succeeds but a relation-bearing query 500s with `column <table>.<col> does not exist in the current database` → un-applied DB MIGRATION. The split (minimal `videoBySlug(slug)` works, full query with `locales` fails) isolates the issue to a specific column/relation and rules out auth/network. Fix: `prisma migrate status` then `prisma migrate deploy`.
3. Run BOTH steps after any pull that touches Prisma. Fixing one drift layer does not fix the other — `generate` and `migrate deploy` are independent.

**Database-URL gotcha (the `P1001` trap):**

- `apps/admin/.env` uses the Docker-Compose hostname `db:5432` — unresolvable from a plain host shell, producing `P1001 Can't reach database server at db:5432`.
- `apps/admin/.env.local` has the host-reachable `127.0.0.1:5433/forge_admin` — point all CLI `DATABASE_URL` overrides here.
- Thematically related: for local admin, prefer `127.0.0.1` over `localhost` to dodge the auth-host proxy quirk (see Related Issues).

**Concrete recovery commands:**

```bash
# 1. Always regenerate the client after a pull that may touch the schema
pnpm --filter @forge/admin exec prisma generate

# 2. Check for pending migrations against the ACTUAL running DB (.env.local URL)
DATABASE_URL="postgresql://forge:***@127.0.0.1:5433/forge_admin" \
  pnpm --filter @forge/admin exec prisma migrate status

# 3. Apply them non-destructively (forward-only; never `migrate dev` on shared DBs)
DATABASE_URL="postgresql://forge:***@127.0.0.1:5433/forge_admin" \
  pnpm --filter @forge/admin exec prisma migrate deploy
```

**Two durable rules:**

- **Schema migration BEFORE any data/core sync** — never reach for a sync to fix a missing column.
- **"Video Not Found" (or any empty/not-found state) in the mobile or web app can be a server-side column-missing error in disguise** — check the admin GraphQL response directly, not just the app UI, before concluding it's missing data.

## Related Issues

- `docs/solutions/runtime-errors/pothos-turbopack-hmr-duplicate-typename-crash-20260515.md` — sibling `PothosSchemaError` family + the same "inspect admin's dev terminal, `/api/health` 200 is misleading" diagnostic. That doc covers the `Duplicate typename` variant; this one covers the `Field 'X' not found in model 'Y'` (stale generated client) variant.
- `docs/solutions/developer-experience/admin-prod-video-snapshot-local-restore-20260521.md` — "local admin boots but shows empty/missing watch content," covers `prisma migrate deploy` against a target DB URL. The missing-rows cousin of this missing-column problem.
- `docs/solutions/developer-experience/local-admin-dev-auth-flow-impractical-20260514.md` — the `127.0.0.1` (not `localhost`) workaround and that CLI scripts gate on `DATABASE_URL`. Reinforces "target the running DB URL, not `.env`'s Docker-host."
- `docs/solutions/database-issues/first-drop-column-forward-only-migration-playbook-20260517.md` — admin Prisma migration discipline (`migrate deploy`, forward-only, co-version code with schema).
- `docs/solutions/integration-issues/mastra-eval-workflow-local-dev-contracts.md` — documents the `db:5432` Docker-host `DATABASE_URL` form that is exactly the wrong target here.
- Trigger: PR #1089 "sync localized watch metadata" (added migrations `0026`/`0027` and the `video_locale.language_id` column).
