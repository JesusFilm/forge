---
date: 2026-03-24
topic: cms-auto-snapshot-restore
---

# CMS Automated Snapshot Restore

## Problem Frame

The CMS snapshot system (R1-R6 from `cms-dev-data-snapshot`) is fully implemented: production creates nightly snapshots, and `pnpm data-import` lets developers manually restore them. However, developers must remember to run the import, and staging Railway environments start with empty databases on every deploy. We need the import to run automatically on dev startup and Railway deploys, but skip redundant imports when the latest snapshot has already been applied.

## Requirements

- R1. **Auto-import on dev startup** — When running `pnpm dev` for the cms app, a Turbo pipeline pre-task checks for a newer snapshot and imports it before Strapi starts. If the latest snapshot is already applied, it skips silently.
- R2. **Auto-import on Railway staging deploy** — Railway's release command runs the import check before the Strapi service starts. Skips if the latest snapshot is already applied.
- R3. **Freshness check via snapshot key** — The download endpoint returns the S3 object key (e.g., `backups/cms-snapshot-2026-03-24.sql.gz`) alongside the presigned URL. The import script compares this key against the last-applied key in the `_data_imports` table. If they match, the import is skipped. (Originally proposed as S3 HEAD, but presigned URLs are method-specific so key comparison is simpler and more reliable.)
- R4. **Durable state in PostgreSQL** — All non-prod environments store the last-applied snapshot key in a `_data_imports` table in the local PostgreSQL database. This replaces the file-based `imports/.last-import` tracker, solving Railway's ephemeral filesystem problem and unifying the approach across environments.
- R5. **Production never imports** — The existing `NODE_ENV=production` safety guard remains. Production is the snapshot source, never a consumer.
- R6. **Graceful degradation** — If the snapshot endpoint is unreachable, the `_data_imports` table doesn't exist yet (first run), or any other transient failure occurs, the import logs a warning and allows Strapi to start normally. It must never block startup.

## Success Criteria

- Running `pnpm dev` on a fresh local database automatically imports the latest snapshot without manual intervention.
- Running `pnpm dev` a second time (without a new snapshot) skips the import in under 2 seconds.
- Deploying to staging on Railway auto-imports the latest snapshot via release command.
- Re-deploying staging with the same snapshot skips the import (state persisted in DB survives redeploy).

## Scope Boundaries

- **Not for production** — Production is the snapshot source and never runs imports.
- **Not changing the snapshot creation flow** — The existing nightly pg_dump + S3 upload is unchanged.
- **Manual `pnpm data-import` still works** — The existing manual command remains available and is updated to use the same DB-based state tracking.

## Key Decisions

- **Snapshot key for freshness (not S3 HEAD)** — S3 presigned URLs are method-specific, so HEAD requests don't work on GET presigned URLs. Instead, the download endpoint returns the snapshot S3 key alongside the URL. The import script compares this key against the `_data_imports` table. Simpler, more reliable, no new endpoints needed.
- **PostgreSQL `_data_imports` table for state** — Solves Railway ephemeral filesystem. Same approach for local dev and staging. The table is created automatically on first run (CREATE TABLE IF NOT EXISTS). Underscore prefix signals it's an internal/tooling table, not a Strapi content type.
- **Turbo pipeline pre-task for dev** — Fits naturally into the existing monorepo workflow. The import runs as a dependsOn task before cms dev starts.
- **Railway release command for staging** — Runs once before the service starts, separate from the main process. Clean separation of concerns.

## Dependencies / Assumptions

- Railway release commands have access to the same environment variables as the main service.
- The PostgreSQL database is available before Strapi starts (true for Railway managed Postgres).

## Resolved Questions

- **S3 HEAD on presigned URLs?** No — presigned URLs are method-specific. Resolved by comparing snapshot keys instead.
- **`_data_imports` table schema:** `id SERIAL PRIMARY KEY, snapshot_key TEXT NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW()`.
- **Turbo pre-task scoping:** App-level `apps/cms/turbo.json` with `extends: ["//"]` overrides `dev` to depend on `data-import-check`.

## Next Steps

→ Implemented in PR #532.
