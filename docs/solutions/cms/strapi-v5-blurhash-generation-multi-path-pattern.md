---
title: "Strapi v5 Blurhash Generation — Multi-Path Pattern for Raw SQL + Document Service Writes"
category: cms
date: 2026-04-03
severity: medium
tags:
  - strapi
  - cms
  - blurhash
  - image-processing
  - lifecycle-hooks
  - core-sync
  - batch-processing
  - ssrf
  - security
modules_affected:
  - apps/cms
---

## Problem

Video image records (`video_images`) in the Strapi v5 CMS had no blurhash (compact placeholder) data unless synced from the core API. Images created via the admin panel, GraphQL mutations, or the manager app never received a blurhash. Additionally, core sync could overwrite CMS-generated blurhash values with `null` on every run.

## Root Cause

The CMS has two write paths to `video_images`:

1. **Core sync** — uses raw knex SQL via `bulkUpsertByCoreId()` for performance. This bypasses Strapi's Document Service entirely, meaning lifecycle hooks never fire.
2. **Admin/GraphQL** — uses Strapi's Document Service, which does fire lifecycle hooks.

Blurhash was only populated by core sync passing it through from the upstream API. There was no local generation, so any image not from core (or where core returned null) had no blurhash.

## Solution: Multi-Path Blurhash Generation

Three complementary paths ensure complete coverage:

### 1. Lifecycle Hook (Admin/GraphQL Writes)

**File:** `apps/cms/src/api/video-image/content-types/video-image/lifecycles.ts`

First lifecycle hook in this project. Generates blurhash in `beforeCreate`/`beforeUpdate` when URL is present and blurhash is null. Key design choices:

- `beforeUpdate` regenerates on any URL change (not just when blurhash is null)
- Errors are caught and logged — never blocks the save
- A comment documents that this only fires for Document Service writes, not core sync

### 2. Post-Sync Hook (Core Sync Writes)

**File:** `apps/cms/src/api/core-sync/services/post-sync-blurhash.ts`

Runs after `analyzeModifiedTables()` in core-sync when the `videos` phase is in scope. Calls the shared `processMissingBlurhashes()` utility. Wrapped in `.catch()` to prevent blurhash failures from failing the sync.

### 3. Backfill Endpoint (Existing Records)

**Files:** `apps/cms/src/api/blurhash-backfill/{routes,controllers,services}/`

Fire-and-forget REST endpoint following the established pattern:

- `POST /blurhash-backfill/trigger` — returns 202, processes async
- `GET /blurhash-backfill/status` — returns progress
- `POST /blurhash-backfill/cancel` — graceful cancellation
- Concurrency guard prevents duplicate runs (409 if already running)
- Protected by `global::api-token-auth` middleware

### Core Utility: `generate-blurhash.ts`

**File:** `apps/cms/src/utils/generate-blurhash.ts`

Central function with security hardening:

- **SSRF protection**: HTTPS only + domain allowlist (`imagedelivery.net`)
- **Fetch timeout**: 10s via `AbortSignal.timeout()`
- **Size limit**: 10MB max response, Content-Type must be `image/*`
- **Cloudflare handling**: Auto-appends `/public` to bare Image Delivery URLs
- **Process**: Fetch → resize to 32px with sharp → extract RGBA → encode with blurhash (4x3)

### Shared Processing: `process-missing-blurhashes.ts`

**File:** `apps/cms/src/utils/process-missing-blurhashes.ts`

Reusable batch processor called by both post-sync and backfill:

- **Deduplicates draft+published**: Groups by `core_id`, queries draft rows only
- **Updates both rows**: Single `WHERE core_id = ?` update covers draft + published
- **Configurable concurrency** (default 5)
- **Cancellation support** via `isCancelled()` callback
- **Progress callbacks** for status tracking

### URL Change Detection in Core Sync

**File:** `apps/cms/src/api/core-sync/services/sync-videos.ts`

Pre-loads existing image URLs per sync page. When a URL changes, writes `{ blurhash: null }` in the upsert payload. When URL hasn't changed, omits `blurhash` entirely (preserving CMS-generated values). The nullified rows are then picked up by the post-sync step.

## Investigation Steps

1. Identified that `bulkUpsertByCoreId` bypasses lifecycle hooks (uses raw knex)
2. Found that `blurhash: img.blurhash ?? null` in sync payload overwrites local values
3. Discovered URL changes would leave stale blurhash — added URL comparison per page
4. Code review identified SSRF (unrestricted URL fetch), missing timeout, duplicated logic
5. Review also caught draft+published double-processing via Strapi v5 dual-row model

## Prevention Checklist

### For new URL-fetching utilities in the CMS:

- [ ] HTTPS only + domain allowlist (no arbitrary URL fetching)
- [ ] `AbortSignal.timeout()` on every fetch call
- [ ] Response size limit + Content-Type validation
- [ ] `formatError()` for consistent logging (not raw `${error}`)

### For Strapi v5 lifecycle hooks:

- [ ] Document which write paths trigger hooks and which don't (raw SQL bypasses them)
- [ ] Use `try/catch` — never let a hook failure block the parent write
- [ ] Handle both `beforeCreate` and `beforeUpdate` for derived fields

### For batch processing with dual-row model:

- [ ] Group by `core_id` or `document_id` to avoid double-processing
- [ ] Query `whereNull("published_at")` for draft rows as canonical source
- [ ] Update by `core_id` to cover both rows in one statement

## Related Documentation

- `docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md` — fire-and-forget endpoint pattern
- `docs/solutions/cms/core-sync-per-page-upsert-pattern.md` — batch processing pattern
- `docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md` — dual-row SQL handling
- `docs/solutions/performance-issues/strapi-language-cache-raw-sql-bypass-cms-manager-20260403.md` — custom REST endpoint checklist
- `docs/solutions/cms/strapi-enrichment-job-content-type.md` — durable job state alternative
