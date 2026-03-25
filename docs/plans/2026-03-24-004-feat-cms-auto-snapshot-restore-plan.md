---
title: "feat: Auto-restore latest snapshot on CMS dev start and staging deploy"
type: feat
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-cms-auto-snapshot-restore-requirements.md
---

# feat: Auto-restore latest snapshot on CMS dev start and staging deploy

## Overview

Automate the existing `pnpm data-import` workflow so it runs before CMS startup in local dev (via Turbo pre-task) and on Railway staging deploys (via release command). Add idempotency by tracking applied snapshots in a PostgreSQL table and comparing against the latest available snapshot key before downloading.

## Problem Frame

The snapshot infrastructure exists: production creates nightly snapshots, and `pnpm data-import` restores them. But developers must remember to run it manually, and staging Railway environments start with empty databases on every deploy. The import should happen automatically and skip redundant imports when the latest snapshot is already applied.

(see origin: `docs/brainstorms/2026-03-24-cms-auto-snapshot-restore-requirements.md`)

## Requirements Trace

- R1. Auto-import on dev startup via Turbo pipeline pre-task
- R2. Auto-import on Railway staging deploy via release command
- R3. Freshness check — skip if latest snapshot already applied
- R4. Durable state in PostgreSQL `_data_imports` table (all non-prod environments)
- R5. Production never imports (existing `NODE_ENV=production` guard)
- R6. Graceful degradation — never block startup on failure

## Scope Boundaries

- Not changing snapshot creation flow (nightly pg_dump + S3 upload unchanged)
- Not adding new Strapi content types or GraphQL schema changes
- Manual `pnpm data-import` still works (updated to use same DB state tracking)
- Production is the snapshot source and never runs imports

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/scripts/data-import.ts` — existing import script, currently file-based state at `imports/.last-import`
- `apps/cms/src/scripts/data-import-utils.ts` — `parseConnectionString()`, `shouldKeepLine()`, `formatBytes()`
- `apps/cms/src/api/data-snapshot/controllers/data-snapshot.ts` — download handler returns `{ url }` from presigned URL
- `apps/cms/src/api/data-snapshot/services/data-snapshot.ts` — `getLatestDownloadUrl()` uses `listSnapshots()` which already has the S3 key
- `apps/cms/src/api/data-snapshot/services/s3-client.ts` — lazy singleton S3 client, `listSnapshots()` returns `{ key, lastModified }[]`
- `apps/cms/src/bootstrap/internal-api-token.ts` — advisory lock pattern for concurrent-safe bootstrap operations
- `turbo.json` — root-level Turbo v2 `tasks` format, no app-specific turbo.json files exist yet
- `apps/cms/package.json` — `@forge/cms` workspace, `pg` already a dependency

### Institutional Learnings

- File-based state is lost on every Railway deploy/restart — use PostgreSQL for durable state (`docs/solutions/cms/strapi-enrichment-job-content-type.md`)
- Railway S3 requires `forcePathStyle: true` (`docs/solutions/platform/optional-railway-s3-local-fallback.md`)
- Lazy SDK initialization is the standard graceful degradation pattern (`docs/solutions/platform/new-app-ci-and-deployment-patterns.md`)

## Key Technical Decisions

- **Snapshot key as freshness marker (not S3 HEAD):** S3 presigned URLs are method-specific — a GET presigned URL does not support HEAD requests. Instead, enrich the existing download endpoint response to include the snapshot `key` (e.g., `backups/cms-snapshot-2026-03-24.sql.gz`). The import script compares this key against `_data_imports` to determine freshness. This is simpler, more reliable, and requires no new endpoints.

- **PostgreSQL `_data_imports` table (not file-based):** Replaces `imports/.last-import` file tracker. Survives Railway ephemeral filesystem. Used by all non-prod environments. Created via `CREATE TABLE IF NOT EXISTS` on first run — no Strapi content type or migration needed. Underscore prefix signals internal tooling table.

- **App-level `turbo.json` for CMS:** Create `apps/cms/turbo.json` with `extends: ["//"]` to override the `dev` task with a `dependsOn` on a new `data-import-check` task. This scopes the pre-task to the CMS app only without affecting other apps.

- **Railway release command via `railway.toml`:** Create `apps/cms/railway.toml` with a `[deploy]` section specifying the import check as the release command. This runs once before the service starts, separate from the main process.

- **Separate `data-import-check` script:** A thin wrapper around the import logic that adds the freshness check and graceful degradation. The existing `data-import` script is refactored to share core logic but `data-import` always imports (force mode) while `data-import-check` skips if fresh.

- **Targeted table restore (not DROP SCHEMA CASCADE):** The current `data-import.ts` prepends `DROP SCHEMA public CASCADE` before restoring, which destroys all Strapi system tables (admin users, permissions, roles, API tokens). Since the snapshot only contains content tables, the restore should only drop/truncate the content tables listed in `snapshot-tables.ts`. This preserves Strapi system state on staging and avoids requiring a full Strapi bootstrap to recreate system tables after every import.

## Open Questions

### Resolved During Planning

- **Can we use S3 HEAD on presigned URLs?** No — presigned URLs are method-specific. Resolved by including the snapshot key in the download endpoint response and comparing keys instead.
- **How to scope Turbo pre-task to CMS only?** Use an app-level `apps/cms/turbo.json` with `extends: ["//"]` — this is the Turborepo v2 recommended pattern for workspace-specific task overrides.
- **`_data_imports` table schema:** `id SERIAL PRIMARY KEY, snapshot_key TEXT NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW()`. Single row updated on each import. Simple, sufficient.

### Deferred to Implementation

- **Railway release command environment variables:** Verify that Railway release commands inherit the same env vars as the main service (DATABASE_URL, PROD_BASE_URL, PROD_DATA_SNAPSHOT_SECRET). If not, they may need explicit configuration.
- **First-run bootstrapping:** On a completely fresh database, the `_data_imports` table won't exist yet. The `CREATE TABLE IF NOT EXISTS` handles this. Since the restore now uses targeted content table drops (not `DROP SCHEMA CASCADE`), the `_data_imports` table survives the restore and state can be recorded directly after import.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
data-import-check flow:
  1. assertNotProduction()
  2. CREATE TABLE IF NOT EXISTS _data_imports (...)
  3. GET /api/data-snapshot/download → { url, key }
  4. SELECT snapshot_key FROM _data_imports ORDER BY applied_at DESC LIMIT 1
  5. IF key == last_applied_key → log "up to date", exit 0
  6. Download, decompress, preprocess (targeted table drops, not DROP SCHEMA), restore
  7. INSERT into _data_imports (snapshot_key, applied_at)
     (_data_imports survives since only content tables are dropped)
  8. exit 0

On any error in steps 2-7 → log warning, exit 0 (graceful degradation)

preprocess SQL changes:
  OLD: DROP SCHEMA public CASCADE; CREATE SCHEMA public;
  NEW: DROP TABLE IF EXISTS videos CASCADE;
       DROP TABLE IF EXISTS video_variants CASCADE;
       ... (for each content table + resolved glob tables)

Turbo pipeline:
  apps/cms/turbo.json → dev dependsOn [data-import-check]
  data-import-check → { cache: false }

Railway:
  apps/cms/railway.toml → [deploy] releaseCommand = "pnpm data-import-check"
```

## Implementation Units

- [ ] **Unit 1: Enrich download endpoint response with snapshot key**

  **Goal:** Return the S3 object key alongside the presigned URL so consumers can identify which snapshot is latest without downloading.

  **Requirements:** R3

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/api/data-snapshot/services/data-snapshot.ts`
  - Modify: `apps/cms/src/api/data-snapshot/controllers/data-snapshot.ts`

  **Approach:**
  - Change `getLatestDownloadUrl` to return `{ url, key }` instead of just a URL string. The `listSnapshots()` call already has the key.
  - Update the download controller to pass the key through: `ctx.body = { url, key }`.
  - This is a backwards-compatible additive change to the response shape.

  **Patterns to follow:**
  - Existing `listSnapshots()` return type in `s3-client.ts`

  **Test scenarios:**
  - Download endpoint returns both `url` and `key` fields
  - When no snapshots exist, still returns 404

  **Verification:**
  - Calling `GET /api/data-snapshot/download` returns a JSON body with `url` (string) and `key` (string matching `backups/cms-snapshot-*.sql.gz`)

- [ ] **Unit 2: Replace DROP SCHEMA CASCADE with targeted content table cleanup**

  **Goal:** Change the SQL preprocessing step to drop only snapshot content tables instead of the entire schema. This preserves Strapi system tables (admin users, permissions, API tokens, roles) across imports.

  **Requirements:** R2 (staging must preserve system state), R6 (non-destructive to Strapi internals)

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/scripts/data-import.ts` — change `preprocessSql` to generate targeted DROP/TRUNCATE
  - Modify: `apps/cms/src/scripts/data-import-utils.ts` — add a function to generate table cleanup SQL from the snapshot table list
  - Read: `apps/cms/src/api/data-snapshot/services/snapshot-tables.ts` — import the table list

  **Approach:**
  - Import `SNAPSHOT_TABLES` and `SNAPSHOT_TABLE_GLOBS` from `snapshot-tables.ts`.
  - Replace the `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` lines in `preprocessSql` with targeted statements for each content table.
  - For explicit tables: `DROP TABLE IF EXISTS <table> CASCADE;` for each table in `SNAPSHOT_TABLES`.
  - For glob patterns (e.g., `videos_*_lnk`): these can't be directly used in SQL. Two options: (a) query `information_schema.tables` at runtime to resolve glob patterns to actual table names, or (b) rely on the pg_dump output's own `CREATE TABLE` statements with `IF NOT EXISTS` and just truncate known tables. Option (a) is more robust — run a quick query to discover matching tables before generating DROP statements.
  - The pg_dump output includes `CREATE TABLE` statements for each content table, so after dropping them the restore will recreate them with the correct schema and data.

  **Patterns to follow:**
  - Existing `SNAPSHOT_TABLES` / `SNAPSHOT_TABLE_GLOBS` in `snapshot-tables.ts`
  - Existing `preprocessSql` streaming approach in `data-import.ts`

  **Test scenarios:**
  - After import, content tables are fully restored from snapshot
  - After import, Strapi system tables (admin_users, strapi_api_tokens, etc.) are untouched
  - Import works on a fresh database where content tables don't exist yet (DROP IF EXISTS handles this)
  - Glob patterns correctly resolve to actual link/component tables

  **Verification:**
  - Run import on a staging-like database with existing admin users. After import, admin users still exist and content data matches the snapshot.

- [ ] **Unit 3: Add PostgreSQL state tracking utilities**

  **Goal:** Create utilities for managing the `_data_imports` table — ensuring it exists, reading the last applied snapshot key, and recording a new import.

  **Requirements:** R4

  **Dependencies:** None

  **Files:**
  - Create: `apps/cms/src/scripts/import-state.ts`
  - Create: `apps/cms/src/scripts/import-state.test.ts`

  **Approach:**
  - Use the `pg` package directly (already a CMS dependency) since the import script runs outside Strapi via `tsx`.
  - Accept a `DATABASE_URL` or `DbConfig` and create a short-lived `pg.Client` connection for state operations.
  - `ensureImportTable()` — `CREATE TABLE IF NOT EXISTS _data_imports (id SERIAL PRIMARY KEY, snapshot_key TEXT NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())`
  - `getLastAppliedKey(client)` — returns the most recent `snapshot_key` or null
  - `recordImport(client, snapshotKey)` — inserts a new row (not upsert — keep history for debugging, but only the latest row matters for freshness checks)
  - All operations should be safe to call when the table doesn't exist yet (ensureImportTable first).

  **Patterns to follow:**
  - `parseConnectionString()` from `data-import-utils.ts` for DB config
  - Lazy singleton pattern from `s3-client.ts`

  **Test scenarios:**
  - `ensureImportTable` is idempotent (safe to call multiple times)
  - `getLastAppliedKey` returns null on empty table
  - `getLastAppliedKey` returns the most recent key after `recordImport`
  - State operations work with a fresh database (no pre-existing table)

  **Verification:**
  - Unit tests pass with a test PostgreSQL database

- [ ] **Unit 4: Refactor data-import into shared core + two entry points**

  **Goal:** Extract the download-decompress-preprocess-restore pipeline into shared functions. Create two entry points: `data-import` (force mode, always imports) and `data-import-check` (auto mode, skips if fresh).

  **Requirements:** R1, R2, R3, R4, R6

  **Dependencies:** Unit 1, Unit 2, Unit 3

  **Files:**
  - Modify: `apps/cms/src/scripts/data-import.ts` — extract core pipeline, keep as force-mode entry point
  - Create: `apps/cms/src/scripts/data-import-check.ts` — auto mode with freshness check and graceful degradation
  - Modify: `apps/cms/src/scripts/data-import-utils.ts` — if any shared utilities need to move here
  - Modify: `apps/cms/package.json` — add `"data-import-check"` script

  **Approach:**
  - Extract the download/decompress/preprocess/restore pipeline steps from `data-import.ts` into importable functions (they currently live in `main()`). Keep them in the same file or a new `data-import-core.ts` — whichever is cleaner.
  - `data-import-check.ts` flow:
    1. `assertNotProduction()`
    2. Call the download endpoint to get `{ url, key }`
    3. `ensureImportTable()` then `getLastAppliedKey()`
    4. If key matches → log "Snapshot already applied", exit 0
    5. If different → run the full import pipeline (targeted table drops, not DROP SCHEMA)
    6. After restore: `recordImport(key)` — `_data_imports` survives since only content tables are dropped
    7. Wrap everything in try/catch → on any error, log warning and exit 0 (R6 graceful degradation)
  - `data-import.ts` continues to work as before but updated to use shared functions and record state in `_data_imports` instead of the file.
  - Remove file-based `imports/.last-import` tracking from both scripts.

  **Patterns to follow:**
  - Existing `main()` structure in `data-import.ts`
  - Graceful degradation: lazy SDK initialization pattern from institutional learnings

  **Test scenarios:**
  - `data-import-check` skips import when snapshot key matches last applied
  - `data-import-check` imports when snapshot key differs
  - `data-import-check` imports on first run (no `_data_imports` table yet)
  - `data-import-check` exits 0 on network failure (graceful degradation)
  - `data-import-check` exits 0 on missing env vars (graceful degradation)
  - `data-import` (force mode) always imports regardless of state
  - After `DROP SCHEMA CASCADE` + restore, the `_data_imports` table is re-created and state recorded

  **Verification:**
  - Running `pnpm data-import-check` twice with the same snapshot: first run imports, second run skips
  - Running `pnpm data-import-check` with missing `PROD_BASE_URL`: logs warning, exits 0

- [ ] **Unit 5: Wire Turbo pipeline pre-task for CMS dev**

  **Goal:** Make `data-import-check` run automatically before `strapi develop` when running `pnpm dev` for the CMS app.

  **Requirements:** R1

  **Dependencies:** Unit 4

  **Files:**
  - Create: `apps/cms/turbo.json`
  - Modify: `turbo.json` (root) — add `data-import-check` task definition

  **Approach:**
  - Root `turbo.json`: add `"data-import-check": { "cache": false }` to the tasks object. This defines the task globally but it only runs for workspaces that have the script.
  - Create `apps/cms/turbo.json`:
    ```json
    {
      "extends": ["//"],
      "tasks": {
        "dev": {
          "dependsOn": ["data-import-check"],
          "cache": false,
          "persistent": true
        }
      }
    }
    ```
  - This overrides the root `dev` task for `@forge/cms` only, adding the `data-import-check` dependency. Other apps' `dev` tasks are unaffected.

  **Patterns to follow:**
  - Turborepo v2 workspace configuration pattern with `extends`
  - Existing root `turbo.json` task structure

  **Test scenarios:**
  - Running `pnpm --filter @forge/cms dev` executes `data-import-check` before `strapi develop`
  - Running `pnpm --filter @forge/web dev` does NOT run `data-import-check`
  - If `data-import-check` fails (exits non-zero), Turbo should still... actually, `data-import-check` always exits 0 due to graceful degradation (Unit 3), so Turbo always proceeds.

  **Verification:**
  - `turbo run dev --filter=@forge/cms --dry-run` shows `data-import-check` in the task graph before `dev`
  - Running full `pnpm dev` from root: CMS app runs data-import-check, other apps start normally

- [ ] **Unit 6: Add Railway release command for staging**

  **Goal:** Configure Railway to run the snapshot import check before starting Strapi on staging deploys.

  **Requirements:** R2, R5

  **Dependencies:** Unit 4

  **Files:**
  - Create: `apps/cms/railway.toml`

  **Approach:**
  - Create `railway.toml` with a `[deploy]` section specifying the release command.
  - The release command runs `pnpm data-import-check` which handles the freshness check and graceful degradation.
  - The `NODE_ENV=production` guard (R5) ensures this never runs in production even if the railway.toml is present. Production would use `NODE_ENV=production` which causes `data-import-check` to skip (exit 0) immediately.
  - Start command remains `pnpm start` (runs `strapi start`).

  **Patterns to follow:**
  - Railway deployment patterns from `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`

  **Test scenarios:**
  - Railway staging deploy runs the release command and imports latest snapshot
  - Railway production deploy runs the release command but skips due to `NODE_ENV=production`
  - Railway deploy succeeds even if the snapshot endpoint is unreachable (graceful degradation)

  **Verification:**
  - `railway.toml` is syntactically valid
  - Staging deploy logs show data-import-check output

## System-Wide Impact

- **Interaction graph:** The download endpoint response shape changes (additive: new `key` field). No existing consumers parse this response except `data-import.ts`, which is updated in the same change.
- **Error propagation:** All import failures are caught and logged as warnings. The `data-import-check` script always exits 0. Strapi startup is never blocked.
- **State lifecycle risks:** The restore now uses targeted content table drops, so `_data_imports` and Strapi system tables survive. No re-creation needed after restore.
- **API surface parity:** The admin-authenticated download route (`/data-snapshot/admin/download`) returns the same enriched response since it uses the same controller handler.

## Risks & Dependencies

- **Railway release command env vars:** If Railway release commands don't inherit service env vars, the import check will fail gracefully (exit 0) but won't actually import. This needs verification during implementation.
- **Presigned URL expiry:** The current presigned URL TTL is 900s (15 min). The import script should download promptly after receiving the URL. This is already the case in the existing implementation.
- **Concurrent imports:** If multiple staging instances deploy simultaneously, they may both import. This is harmless since the import is idempotent (DROP + restore in a transaction).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-24-cms-auto-snapshot-restore-requirements.md](docs/brainstorms/2026-03-24-cms-auto-snapshot-restore-requirements.md)
- Related completed plan: [docs/plans/2026-03-24-002-feat-cms-dev-data-snapshot-plan.md](docs/plans/2026-03-24-002-feat-cms-dev-data-snapshot-plan.md)
- Institutional learning: [docs/solutions/cms/strapi-enrichment-job-content-type.md](docs/solutions/cms/strapi-enrichment-job-content-type.md) — file-based state lost on Railway deploys
- Institutional learning: [docs/solutions/platform/new-app-ci-and-deployment-patterns.md](docs/solutions/platform/new-app-ci-and-deployment-patterns.md) — Railway deployment and Turbo patterns
- Turborepo v2 workspace configuration: workspace-level `turbo.json` with `extends: ["//"]`
