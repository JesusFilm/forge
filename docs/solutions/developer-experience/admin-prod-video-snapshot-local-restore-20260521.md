---
title: "Admin production video snapshot local restore"
date: 2026-05-21
category: developer-experience
module: apps/admin
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Running Forge web watch pages locally against production-like admin video data"
  - "Restoring the reviewed admin video/content slice with `restore:video-db:latest`"
  - "Debugging local restore failures from PostgreSQL client or server version mismatches"
tags: [admin, video-db-backup, local-dev, postgres, snapshot, watch-page]
---

# Admin production video snapshot local restore

## Context

Watch pages in `apps/web` now read video content from `apps/admin` through
admin GraphQL. A local web server can boot successfully while still showing
empty or missing watch-page content if the local admin database has migrations
but no production-like video rows.

The admin app already has a supported snapshot path:

```bash
pnpm --filter @forge/admin restore:video-db:latest -- --target-env=development
```

That command is intentionally narrow. It restores the reviewed video/content
slice defined in `apps/admin/src/scripts/video-db-backup-core.ts`, not admin
users and not a full production database clone.

The default `video-core` profile restores catalog data without embedding
tables. To restore the stored transcript/scene vectors as well, explicitly use
the independently published `video-search` profile:

```bash
pnpm --filter @forge/admin restore:video-db:latest -- \
  --profile=video-search \
  --target-env=development
```

This copies vectors already present in the production snapshot. It does not
run `run-embeds`, call an embedding provider, or check embedding readiness.

Before any target data is changed, restore preflight requires PostgreSQL 18 or
newer `pg_restore` and `psql` clients, matches the custom archive's `TABLE DATA`
entries exactly to the selected profile, decodes the selected payload to
`/dev/null`, and verifies the target server major, reviewed public tables,
pgvector extension, `public.vector` type, and migration
`0047_video_locale_search_social_metadata`. A wrong-profile, truncated, or
structurally incompatible archive stops before truncate. Use `--dry-run` to
inspect this ordered plan; database credentials are redacted. The latest
command rejects `--in`, keeping the verified downloaded object identical to
the destructive restore input.

## Guidance

Start by fetching admin secrets, because the latest-backup downloader needs the
restore-client bearer from `apps/admin/.env`.

```bash
pnpm --filter @forge/admin fetch-secrets
```

For a simple local restore, target a local admin database and let the script
download the latest production backup through the production presign endpoint:

```bash
TARGET_DATABASE_URL='postgresql://forge:forge@localhost:5432/forge_admin' \
pnpm --dir apps/admin exec tsx \
  --env-file=/absolute/path/to/forge/apps/admin/.env \
  src/scripts/restore-latest-video-db.ts \
  --target-env=development
```

Use a libpq-compatible URL for `TARGET_DATABASE_URL`. Prisma query parameters
such as `connection_limit=10` and `pool_timeout=20` are valid for Prisma but
`psql` rejects them:

```text
psql: error: invalid URI query parameter: "connection_limit"
```

The restore tool removes those reviewed Prisma-only options from a derived
native-client URL. It does not modify `DATABASE_URL` or `DATABASE_URL_SYNC`.
Keep their pool settings intact: transcript embedding backfills deliberately
cap concurrency at 5 against the documented main `connection_limit=10` pool,
and Core Sync relies on its separately sized pool and longer timeout.
The filter preserves the raw libpq URI outside those exact keys, including
comma-separated failover hosts and percent-encoded supported option values.

Scheduled exports require bucket configuration before native work starts. The
profile intentionally excludes editorial media assets and Admin users, so
source preflight also refuses a non-null
`video_locale.social_image_asset_id`; that produces an explicit failed profile
instead of a dump that would violate the pristine target's foreign key. If the
snapshot contract later needs social-image identity, add a reviewed sanitized
dependency closure rather than broadening it to Admin users.

Latest discovery reads every object-listing page and classifies the selected
artifact against a 36-hour threshold. A stale latest artifact stops before
download. Only use `--allow-stale` after confirming that its reported key and
timestamp are the intended restore source.

If the dump downloads but restore fails with a dump-format error, check the
client version:

```bash
pg_restore --version
```

PostgreSQL 16 `pg_restore` cannot read dumps produced by newer servers:

```text
pg_restore: error: unsupported version (1.16) in file header
```

Use the installed PostgreSQL 18 client tools when restoring a PG18-format dump:

```bash
PATH='/opt/homebrew/Cellar/postgresql@18/18.3/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
TARGET_DATABASE_URL='postgresql://forge:forge@localhost:5432/forge_admin' \
pnpm --dir apps/admin exec tsx src/scripts/restore-video-db.ts \
  --target-env=development \
  --in=/absolute/path/to/apps/admin/.tmp/db-backups/video-db-video-core-latest.dump
```

If that reaches the server but fails on `transaction_timeout`, the client can
read the dump but the local PostgreSQL server is too old:

```text
pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"
Command was: SET transaction_timeout = 0;
```

Use a temporary PostgreSQL 18 server on a separate port instead of forcing the
PG18 dump into a PostgreSQL 16 server:

```bash
/opt/homebrew/Cellar/postgresql@18/18.3/bin/initdb \
  -D /private/tmp/forge-admin-pg18-cb8d \
  --auth=trust \
  --no-locale

/opt/homebrew/Cellar/postgresql@18/18.3/bin/pg_ctl \
  -D /private/tmp/forge-admin-pg18-cb8d \
  -l /private/tmp/forge-admin-pg18-cb8d.log \
  -o '-p 55432 -k /private/tmp' \
  start

/opt/homebrew/Cellar/postgresql@18/18.3/bin/createuser \
  -h localhost -p 55432 forge

/opt/homebrew/Cellar/postgresql@18/18.3/bin/psql \
  -h localhost -p 55432 -d postgres \
  -c 'ALTER ROLE forge WITH SUPERUSER;'

/opt/homebrew/Cellar/postgresql@18/18.3/bin/createdb \
  -h localhost -p 55432 -O forge forge_admin
```

The superuser grant is only for this throwaway local cluster. Admin migrations
create the `vector` extension, and a normal role can fail with:

```text
ERROR: permission denied to create extension "vector"
HINT: Must be superuser to create this extension.
```

Apply migrations and restore the downloaded dump into the PG18 database:

```bash
DATABASE_URL='postgresql://forge@localhost:55432/forge_admin?schema=public' \
pnpm --filter @forge/admin exec prisma migrate deploy

PATH='/opt/homebrew/Cellar/postgresql@18/18.3/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
TARGET_DATABASE_URL='postgresql://forge@localhost:55432/forge_admin' \
pnpm --dir apps/admin exec tsx src/scripts/restore-video-db.ts \
  --target-env=development \
  --in=/absolute/path/to/apps/admin/.tmp/db-backups/video-db-video-core-latest.dump
```

Verify the import before wiring web to it:

```bash
/opt/homebrew/Cellar/postgresql@18/18.3/bin/psql \
  'postgresql://forge@localhost:55432/forge_admin' \
  -Atqc "
    select 'videos=' || count(*) from video;
    select 'languages=' || count(*) from language;
    select 'target_video=' || count(*) from video where slug='bp-plot-episode-5';
    select 'target_language=' || count(*) from language where slug='bangla-2';
    select 'target_dubs=' || count(*)
    from video_dub vd
    join video v on v.id = vd.video_id
    join language l on l.id = vd.language_id
    where v.slug='bp-plot-episode-5'
      and l.slug='bangla-2';
  "
```

Then start admin on a non-conflicting port and point web at it:

```bash
set -a
source /absolute/path/to/forge/apps/admin/.env
set +a

DATABASE_URL='postgresql://forge@localhost:55432/forge_admin?schema=public' \
DATABASE_URL_SYNC='postgresql://forge@localhost:55432/forge_admin?schema=public' \
ADMIN_BASE_URL='http://localhost:4911' \
pnpm --dir apps/admin exec next dev --hostname 0.0.0.0 --port 4911
```

In another shell:

```bash
set -a
source /absolute/path/to/forge/apps/admin/.env
set +a

ADMIN_GRAPHQL_URL='http://localhost:4911/api/graphql' \
REVALIDATION_SECRET='ci-placeholder' \
STRAPI_PREVIEW_SECRET='ci-placeholder' \
pnpm --dir apps/web dev -p 4910
```

The web server reads the first `WEB_ADMIN_API_KEYS` value from the sourced
admin env, so do not paste or commit the actual bearer in docs, shell history
snippets, or PR descriptions.

## Why This Matters

There are several easy false paths:

- Running the restore through Railway stage can look in the stage bucket, which
  may be empty even when production has valid backups.
- Having the dump locally does not guarantee restore compatibility; the
  `pg_restore` client and target server both need to be compatible with the
  producing PostgreSQL version.
- Prisma URLs are not always valid `psql` URLs.
- A migrated-but-empty admin database can make the watch route boot while still
  failing to render production-like content.

The reliable path is: fetch admin secrets, download through the production
presign-backed restore command, restore with PostgreSQL 18 tooling into a
PostgreSQL 18 target when needed, verify rows in SQL, then point local admin and
web at that database.

Scheduled workflow results and structured logs provide the measurements needed
to judge the added cost: compressed dump bytes, export duration, upload
duration, exact object key, and restore duration. Snapshot publication does not
generate embeddings, so there is no embedding-provider charge. The recurring
increase is worker CPU/RAM during export/upload, service egress for the upload,
and accumulated bucket storage. Bucket downloads, presigned delivery, and S3
operations are free. At the published Railway rates, a daily artifact of `S`
billed GB adds about `$1.50 × S` monthly upload egress; with no retention,
first-month average storage adds about `$0.2325 × S` and month-twelve storage
adds about `$5.1825 × S`. Railway rounds fractional bucket GB-month usage up,
so replace `S` and runtime assumptions with ledger/object measurements before
making a retention or cadence decision.

The destructive phase is intentionally unchanged and is **not failure-atomic**.
The script first runs `TRUNCATE ... RESTART IDENTITY CASCADE` through `psql`,
then invokes `pg_restore --single-transaction`. Those are separate processes
and separate transactions: `--single-transaction` protects only the import. If
the import fails, its writes roll back, but the earlier committed truncate does
not. Re-run preflight and restore against a disposable or recoverable local
target; do not treat this workflow as an atomic slice swap.

## When to Apply

- A local watch route returns `200` but content is empty, missing, or unlike
  production because admin has no video rows.
- `restore:video-db:latest` downloads a dump but restore fails with PostgreSQL
  client or server compatibility errors.
- Another worktree already owns admin port `3003`, so this worktree needs its
  own admin port and database.
- You need production-like video data locally without importing production
  admin users.

## Examples

For the watch URL:

```text
http://localhost:4910/watch/bp-plot-episode-5/bangla-2?t=43.897444
```

the verified local restore contained:

```text
videos=1094
languages=2303
target_video=1
target_language=1
target_dubs=1
```

Admin GraphQL also returned a published `bangla-2` HLS dub for
`bp-plot-episode-5`.

To shut down the temporary database after testing:

```bash
/opt/homebrew/Cellar/postgresql@18/18.3/bin/pg_ctl \
  -D /private/tmp/forge-admin-pg18-cb8d \
  stop
```

## Related

- `apps/admin/AGENTS.md` lists the local-dev restore scripts.
- `apps/admin/CLAUDE.md` documents the video DB backup prefix and presigned
  restore flow.
- `apps/admin/src/scripts/video-db-backup-core.ts` is the source of truth for
  reviewed profiles and plans; `video-db-backup.ts` owns native execution and
  latest download orchestration.
