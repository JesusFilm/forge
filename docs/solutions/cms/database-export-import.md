---
title: CMS Database Export/Import Pipeline
category: cms
date: 2026-03-23
tags:
  - database
  - backup
  - restore
  - pg_dump
  - railway-s3
  - github-actions
  - strapi-v5
---

# CMS Database Export/Import

## Problem

Non-production environments (dev/staging) need production content data without running the full gateway sync, which is slow, requires gateway API access, and duplicates production work.

## Root Cause

The gateway sync (`apps/cms/src/api/gateway-sync/`) pulls data via paginated GraphQL queries and upserts records one-by-one through Strapi's document service. This is correct for production but unnecessarily slow for seeding dev/staging — a full database clone is faster and more reliable.

## Solution

Two-sided backup/restore pipeline:

1. **Export** — GitHub Actions cron (`cms-db-export.yml`) runs `pg_dump` against production PostgreSQL nightly at 04:00 UTC, uploads gzipped SQL to Railway S3 at `backups/cms-backup.sql.gz`.

2. **Import** — `apps/cms/src/scripts/data-import.ts` downloads from S3, decompresses, preprocesses (strips replication/publication statements), and restores via `psql --single-transaction`.

### Architecture

```
GitHub Actions (daily cron at 04:00 UTC)
  ├─ pg_dump production Strapi DB (--inserts --no-owner)
  ├─ Exclude admin/system/upload/migration tables
  ├─ gzip
  └─ Upload to Railway S3: backups/cms-backup.sql.gz

Dev/Staging (manual: pnpm data-import)
  ├─ Download from Railway S3
  ├─ Decompress (createGunzip stream)
  ├─ Preprocess SQL:
  │   ├─ Prepend DROP SCHEMA + CREATE SCHEMA (inside transaction)
  │   ├─ Strip CREATE/ALTER PUBLICATION statements
  │   └─ Strip psql meta-commands (except \. and \copy)
  ├─ psql restore (--single-transaction, ON_ERROR_STOP=1)
  ├─ Record import timestamp
  └─ Cleanup temp files
```

### Key Files

| File                                             | Purpose                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| `.github/workflows/cms-db-export.yml`            | Nightly export cron + manual dispatch           |
| `apps/cms/src/scripts/data-import.ts`            | Import orchestrator (I/O, S3, psql)             |
| `apps/cms/src/scripts/data-import-utils.ts`      | Pure functions (parsing, filtering, formatting) |
| `apps/cms/src/scripts/data-import-utils.test.ts` | 31 unit tests                                   |

## Excluded Tables

Admin, auth, system, upload, and migration tables are excluded from the export because they are environment-specific or bootstrapped on startup:

- `admin_users`, `admin_roles`, `admin_permissions` (and junction tables `_lnk`)
- `strapi_api_tokens`, `strapi_api_token_permissions` (and junction tables)
- `strapi_transfer_tokens`, `strapi_transfer_token_permissions` (and junction tables)
- `strapi_webhooks`, `strapi_webhooks_events`
- `upload_files`, `upload_folders` (and junction tables `_lnk`, `_mph`)
- `strapi_migrations`, `strapi_migrations_internal`

**Known limitation:** Content types with media fields (e.g., `experience.ogImage`) will have dangling references to `upload_files` after import. Media must be re-uploaded on dev/staging if needed.

**Investigate:** `strapi_core_store_settings` and `strapi_database_schema` may also need exclusion to prevent schema sync drift between environments.

## Required GitHub Secrets

- `CMS_DATABASE_URL` — production PostgreSQL connection string (prefer read-only user)
- `RAILWAY_S3_ENDPOINT`, `RAILWAY_S3_REGION`, `RAILWAY_S3_BUCKET`
- `RAILWAY_S3_ACCESS_KEY_ID`, `RAILWAY_S3_SECRET_ACCESS_KEY`

## Usage

```bash
# Run import on dev/staging
cd apps/cms
pnpm data-import
```

## Safety Guards

- **Production safeguard:** The import script refuses to run when `NODE_ENV=production`.
- **Atomic restore:** `DROP SCHEMA CASCADE` and the restore SQL are both inside `--single-transaction`. If the restore fails, the DROP rolls back too — the database is left unchanged.
- **Concurrency control:** The export workflow uses `cancel-in-progress: false` to prevent overlapping exports.
- **Secret validation:** The workflow validates all secrets before proceeding (unattended cron failures would otherwise be silent).

## Key Decisions

- Railway S3 chosen over Cloudflare R2 because the bucket is already provisioned and configured across the monorepo.
- GitHub Actions cron chosen over Railway cron to avoid consuming Railway compute for a batch job.
- `--inserts` format used instead of `COPY` for portability across PostgreSQL versions. May need revisiting if restore times exceed 10 minutes at scale.
- Preprocessing strips `CREATE PUBLICATION` and psql meta-commands that fail in non-production environments.
- Pure logic extracted to `data-import-utils.ts` for testability — side-effectful code stays in `data-import.ts`.

## Learnings

### Critical: psql `-c` runs outside `--single-transaction` when combined with `-f`

When psql receives both `-c "DROP SCHEMA..."` and `-f restore.sql`, the `-c` command runs as a separate operation **before** the `-f` file's transaction begins. If the restore fails, the DROP has already committed and the database is empty with no rollback.

**Fix:** Prepend the `DROP SCHEMA` / `CREATE SCHEMA` statements into the processed SQL file itself during preprocessing. This way, `--single-transaction` wraps everything atomically.

### Node `URL` class does not auto-decode credentials

`URL.password` and `URL.username` return percent-encoded strings (e.g., `p%40ss` instead of `p@ss`). Must wrap with `decodeURIComponent()` when parsing PostgreSQL connection strings. Caught by tests.

### Vitest version must match Vite major

Vitest 4.x requires Vite 6+. This repo pins Vite 5.x, so use `vitest@^2` for compatibility. Vitest 2.1.9 confirmed working with `vite@5`.

### Railway S3 requires `forcePathStyle: true`

Same pattern as `apps/manager/src/services/storage.ts`. Without this, the AWS SDK constructs virtual-hosted-style URLs that Railway's S3-compatible storage doesn't support.

### Strapi v5 junction table naming

Follows the pattern `{table}_{relation}_lnk` — these must be excluded alongside their parent tables in the pg_dump, or the restore will fail with FK constraint errors. Upload-related morphic tables use `_mph` suffix.

### GitHub Actions cron needs explicit secret validation

Cron workflows run unattended at night. A missing secret would cause a silent failure. Always validate secrets as the first step before doing any work.

### Always add production safeguards to destructive scripts

Any script that runs `DROP SCHEMA CASCADE` must check `NODE_ENV` and refuse to run in production. A single `DATABASE_URL` misconfiguration would be catastrophic.

## Prevention

- Run `pnpm test` in `apps/cms` to verify preprocessing and parsing logic (31 unit tests).
- After first deploy, manually trigger the workflow via `gh workflow run cms-db-export.yml` and verify the backup in S3 before waiting for the cron.
- Monitor the GitHub Actions workflow for failures — consider adding Slack notifications for cron job failures.

## Cross-References

- `apps/cms/src/api/gateway-sync/` — Production-only sync (GraphQL pull from upstream gateway)
- `apps/manager/src/services/storage.ts` — Established Railway S3 pattern
- `docs/solutions/platform/optional-railway-s3-local-fallback.md` — S3 toggle convention
- `docs/solutions/cms/strapi-v5-bootstrap-webhook-seeding.md` — Confirms webhooks are bootstrapped (correctly excluded from export)
- `docs/solutions/cms/strapi-v5-populate-role-sanitization.md` — Confirms API tokens are environment-specific (correctly excluded)
