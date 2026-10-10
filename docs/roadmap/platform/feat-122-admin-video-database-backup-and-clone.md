---
id: "feat-122"
title: "Admin video database backup and clone tooling"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-05-13"
duration: 5
depends_on:
  - "feat-086"
blocks: []
tags:
  - "admin"
  - "infrastructure"
  - "database"
---

## Problem

Operators need an automated way to back up production Postgres data for the
admin video catalog and a repeatable CLI path to clone that slice into staging
or local development.
Today the admin app has local operational scripts for Core sync, embeddings,
and CMS dumps, but no reviewed table manifest or restore guardrails for
production video data. Ad hoc dumps risk omitting dependent tables, restoring
into the wrong database, or accidentally pulling far more data than a focused
video workflow needs.

## Entry Points — Read These First

1. `apps/admin/prisma/schema.prisma` — canonical table names and dependencies
   for `Video`, `VideoLocale`, `VideoDub`, `VideoSubtitle`, `VideoScene`,
   `VideoTranscript`, and reference tables.
2. `apps/admin/src/scripts/refresh-core-id-mapping.ts` — operator CLI pattern
   with child-process timeout, clean stderr, and direct `process.env` reads.
3. `apps/admin/src/scripts/pull-mapping-from-prod.ts` — production-read,
   local-write script shape.
4. `apps/admin/src/workflows/` — useworkflow jobs compiled by the SDK plugin.
5. `apps/admin/package.json` — add discoverable restore script only.
6. `apps/admin/CLAUDE.md` — admin operational script inventory.

## Grep These

```bash
rg -n "^model (Video|VideoLocale|VideoDub|VideoSubtitle|VideoScene|VideoTranscript|Language|Country|Keyword|BibleBook|VideoEdition|MuxVideo)" apps/admin/prisma/schema.prisma
rg -n "spawn\\(|execFile\\(|process.env.DATABASE_URL" apps/admin/src/scripts apps/admin/src/services
rg -n "use workflow|dispatchCoreSync|createWorkflowRunLog" apps/admin/src/workflows apps/admin/src/services
```

## What To Build

1. Add an admin-local table manifest for video backup profiles:
   - `video-core`: reference tables plus video catalog tables required for
     browsing, playback metadata, relations, dubs, subtitles, images, Bible
     citations, and study questions.
   - `video-search`: `video-core` plus scene and transcript embedding tables.
   - `video-full`: alias for the largest reviewed video slice.
2. Add a scheduled-only video DB backup job:
   - Source URL from `SOURCE_DATABASE_URL` first, then `DATABASE_URL`.
   - Output path defaults to a timestamped file under
     `apps/admin/.tmp/db-backups/`.
   - Uses `pg_dump --format=custom --data-only --no-owner --no-acl` with the
     reviewed table manifest.
   - Uploads to the normal Railway S3 bucket when `RAILWAY_S3_BUCKET` is
     configured.
   - Does not expose an operator `backup:video-db` CLI script.
   - A dedicated admin worker service with `WORKFLOW_RUNNER_ENABLED=true`
     starts Postgres World and ensures one durable
     `src/workflows/videoDbBackup.ts` scheduler workflow is running. The admin
     web service leaves that flag unset or `false`.
   - The scheduler workflow performs one immediate backup when first created,
     then sleeps until the next daily UTC run, performs the dump/upload work as
     a workflow step, records status in the generic `workflow_run` ledger, and
     loops.
3. Add `restore:video-db`:
   - Target URL from `TARGET_DATABASE_URL` first, then `DATABASE_URL`.
   - Requires `--in=...`.
   - Requires `--target-env=development` or `--target-env=staging` by default;
     rejects production targets unless `--allow-production-target` is present.
   - Truncates the selected manifest tables with `RESTART IDENTITY CASCADE`
     before `pg_restore --data-only`.
   - Supports `--dry-run`.
4. Add PostgreSQL 18 client tools through the admin service's Railpack variables
   so Railway scheduled runs have `pg_dump`, `pg_restore`, and `psql` available
   without changing other monorepo services. Configure the `@forge/admin`
   Railway services with `RAILPACK_PACKAGES=postgres@18.1` and
   `RAILPACK_BUILD_APT_PACKAGES=bison flex`; do not place a root `railpack.json`
   for this feature.
5. Add focused unit tests for profile expansion, command arguments, env guards,
   and restore safety behavior. Do not connect to a database in unit tests.

## Constraints

- Do not read `@/config/env` from the scripts; backup tooling must run with only
  the database URL it needs.
- Do not add a production restore path that can run by accident. Production
  restore must require an explicit override flag and should not be the normal
  documented path.
- Do not dump auth/session/user tables, workflow runtime tables, media asset
  editorial upload tables, or experience content in this first slice.
- Use the normal Railway S3 env vars already managed through Doppler/Railway.
  Do not add backup-specific env vars in this slice.
- Backup is automated only. Do not add a package script that lets operators run
  production backup manually from the CLI.
- Use PostgreSQL 18 client tooling in the admin Railway container through
  `RAILPACK_PACKAGES=postgres@18.1`. A `pg_dump` client older than the server
  major version refuses to dump.
- Verify the deployment details show the admin Railpack package setting was
  applied.
- Verify the production admin service starts the video backup scheduler workflow
  after Postgres World starts, and that scheduled backup rows appear in
  `/dashboard/workflows`.
- Do not hand-edit generated Prisma client output.
- Keep `pg_dump` and `pg_restore` invocation argument-array based; do not shell
  interpolate database URLs.

## Verification

1. `pnpm --filter @forge/admin test src/scripts/video-db-backup.test.ts`
2. `pnpm --filter @forge/admin typecheck`
3. `pnpm --filter @forge/admin lint`
4. `pnpm --filter @forge/admin exec tsx src/scripts/video-db-backup.ts` exits
   non-zero and says backup is scheduled-only.
5. `TARGET_DATABASE_URL=postgresql://forge:forge@localhost:5433/forge_admin pnpm --filter @forge/admin restore:video-db -- --dry-run --target-env=development --in=.tmp/db-backups/example.dump`
