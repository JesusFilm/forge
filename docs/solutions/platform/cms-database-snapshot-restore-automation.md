---
title: "CMS database snapshot restore automation"
category: "platform"
date: "2026-03-25"
severity: "medium"
tags:
  - strapi-v5
  - postgresql
  - s3
  - railway
  - turbo
  - data-import
  - idempotency
  - graceful-degradation
modules:
  - apps/cms
  - turbo.json
related_issues:
  - "PR #532"
---

# CMS Database Snapshot Restore Automation

## Problem

Non-production CMS environments (local dev, Railway staging) needed production content data. Running `core-sync` locally takes 4+ hours. The existing `pnpm data-import` script could restore a nightly snapshot, but developers had to remember to run it manually, and staging Railway environments started with empty databases on every deploy.

Automating this revealed several sub-problems:

- S3 presigned URLs are method-specific (GET URL rejects HEAD requests)
- `DROP SCHEMA public CASCADE` destroyed Strapi system tables alongside content data
- Railway's ephemeral filesystem loses file-based state markers between deploys
- Importing functions from a script file that calls `main()` at module scope triggers side effects
- Filtered pnpm Docker builds miss root-only devDependencies
- HTTP requests without timeouts block automation scripts indefinitely

## Root Cause

Each sub-problem had a distinct root cause:

1. **S3 presigned URLs** are signed for a specific HTTP method. A URL signed for `GetObject` cannot be used for `HeadObject` — the signature check fails with 403.
2. **Partial restores with full drops** — the snapshot only contains content tables, but the restore dropped the entire `public` schema including Strapi internals.
3. **Railway ephemeral filesystem** — containers don't persist filesystem state across deploys, so `imports/.last-import` vanished.
4. **Module-scope execution** — `main().catch(...)` at the bottom of `data-import.ts` runs when any other file imports from it, not just when run directly.
5. **pnpm filtered installs** — `pnpm install --filter @forge/cms...` only installs the app's own dependencies, not root `devDependencies`.
6. **Node.js fetch** has no default timeout — a down production endpoint blocks indefinitely.

## Solution

### 1. Snapshot key-based freshness (not S3 HEAD)

The download endpoint returns the S3 object key alongside the presigned URL. The import script compares this key against a PostgreSQL table instead of doing HTTP HEAD:

```typescript
// data-snapshot service (Strapi)
const latest = snapshots[snapshots.length - 1]
const url = await getSnapshotPresignedUrl(latest.key)
return { url, key: latest.key } // key e.g. "backups/cms-snapshot-2026-03-25.sql.gz"
```

### 2. Targeted table drops via glob-to-LIKE resolution

Content tables are defined in `snapshot-tables.ts` as exact names and glob patterns. At restore time, globs are resolved against the live database:

```typescript
const likePatterns = SNAPSHOT_TABLE_GLOBS.map((g) => g.replace(/\*/g, "%"))
const query = `SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND (${likeConditions.join(" OR ")})`
// Produces: DROP TABLE IF EXISTS "videos" CASCADE; (per content table)
// Strapi system tables (admin_users, strapi_api_tokens, etc.) are untouched
```

### 3. PostgreSQL-backed state tracking

Replaces file-based `.last-import` with a `_data_imports` table using `pg` directly (scripts run outside Strapi via `tsx`):

```typescript
await client.query(`
  CREATE TABLE IF NOT EXISTS _data_imports (
    id SERIAL PRIMARY KEY,
    snapshot_key TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )
`)
```

### 4. Entry point guard for dual-use modules

```typescript
// Bottom of data-import.ts
if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

Verified working with tsx's CommonJS mode — `true` when run directly, `false` when imported.

### 5. Graceful degradation

`data-import-check.ts` checks env vars early with informative skip messages, catches all errors at the top level, and always exits 0:

```typescript
if (
  !process.env["PROD_BASE_URL"] ||
  !process.env["PROD_DATA_SNAPSHOT_SECRET"]
) {
  console.log(
    `${TAG} PROD_BASE_URL or PROD_DATA_SNAPSHOT_SECRET not set, skipping`,
  )
  return
}
// ... top-level catch:
main().catch((err) => {
  console.warn(
    `${TAG} Import check failed (non-fatal):`,
    err instanceof Error ? err.message : err,
  )
  process.exit(0)
})
```

### 6. Turbo + Railway wiring

App-level `apps/cms/turbo.json` overrides `dev` to depend on the check task:

```json
{
  "extends": ["//"],
  "tasks": { "dev": { "dependsOn": ["data-import-check"] } }
}
```

Railway runs the check as a release command before the app starts:

```toml
[deploy]
startCommand = "pnpm start"
releaseCommand = "pnpm data-import-check"
```

### 7. tsx as cms devDependency

The Dockerfile uses `pnpm install --frozen-lockfile --filter @forge/cms...`. `tsx` must be in `apps/cms/package.json` devDependencies, not just root.

## Prevention

These patterns should be checked in future work:

| Pattern                   | Rule                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- |
| S3 presigned URLs         | Method-specific — never reuse GET URLs for HEAD. Test against actual provider.        |
| Partial database restores | Drop scope must match dump scope. Never `DROP SCHEMA CASCADE` for partial restores.   |
| CLI entry points          | Guard with `require.main === module` (CJS) or `import.meta.url` check (ESM).          |
| Filtered pnpm installs    | If `apps/X/package.json` scripts use a binary, it must be in that app's dependencies. |
| HTTP timeouts             | Always add `AbortSignal.timeout()` to fetch calls in automation scripts.              |
| Railway filesystem        | Ephemeral — use PostgreSQL for any state that must survive deploys.                   |

## Key Files

- `apps/cms/src/scripts/data-import-check.ts` — auto mode (always exits 0)
- `apps/cms/src/scripts/data-import.ts` — force mode + shared pipeline
- `apps/cms/src/scripts/import-state.ts` — PostgreSQL state tracking
- `apps/cms/src/scripts/data-import-utils.ts` — table drop SQL generation
- `apps/cms/src/api/data-snapshot/services/snapshot-tables.ts` — content table allowlist
- `apps/cms/turbo.json` — Turbo pre-task wiring
- `apps/cms/railway.toml` — Railway release command

## Related Documentation

- [Railway S3 local fallback](../platform/optional-railway-s3-local-fallback.md) — S3 client patterns, `forcePathStyle: true`
- [New app CI and deployment patterns](../platform/new-app-ci-and-deployment-patterns.md) — Railway deployment, Turbo pipeline conventions
- [Strapi enrichment job content type](../cms/strapi-enrichment-job-content-type.md) — precedent for file-based state to PostgreSQL migration
- [Strapi bootstrap webhook seeding](../cms/strapi-v5-bootstrap-webhook-seeding.md) — idempotent seeding patterns preserved by targeted drops
