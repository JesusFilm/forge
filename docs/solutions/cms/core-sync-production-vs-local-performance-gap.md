---
title: "Core Sync Production vs Local Performance Gap"
category: cms
date: 2026-03-30
severity: high
tags:
  - core-sync
  - performance
  - railway
  - strapi-v5
  - upsertByCoreId
modules:
  - apps/cms
related_issues:
  - "PR #558"
  - "PR #560"
  - "PR #562"
---

# Core Sync Production vs Local Performance Gap

## Problem

The video sync phase completed in 48.8 seconds locally but was stuck for 20+ minutes on production (Railway) for the same 1,056 records. The video variant sync showed similar patterns — 60+ minutes on production for 207K records with zero progress visibility.

## Symptoms

- Production sync status stuck at `processed=0/1056` for 20+ minutes on videos phase
- Locally the same phase completed in 48.8 seconds
- Languages/countries/keywords (which use `bulkUpsertByCoreId`) completed fast on both local and production
- Only phases using `upsertByCoreId` (Strapi document service, one-at-a-time) were slow on production

## Root Cause

**`upsertByCoreId` (Strapi document service) is dramatically slower on Railway than local dev.**

Each `upsertByCoreId` call does:

1. `findFirst` with filters (through Strapi ORM → SQL query)
2. Either `create` or `update` (through Strapi ORM → SQL query)

On local dev, the app and PostgreSQL are on the same Docker network (~0.1ms latency). On Railway, the app container and PostgreSQL container communicate over Railway's internal network with higher latency (~1-5ms per query). With 2 queries per upsert and hundreds of origins/editions per page, this compounds massively.

The `bulkUpsertByCoreId` path bypasses Strapi's document service entirely, using raw knex SQL with batch operations. This is consistently fast on both local and production because it minimizes round-trips.

## Solution

Applied across all sync phases (PRs #558, #560, #562):

1. **Replace `upsertByCoreId` with `bulkUpsertByCoreId`** for all entity types:
   - Video origins and editions (sync-videos.ts)
   - Video editions and mux videos (sync-video-variants.ts)
   - Bible books (sync-videos.ts)

2. **Per-page upsert** instead of collect-all-then-upsert:
   - Fetch page → bulk upsert → next page
   - Immediate progress visibility
   - Reduced memory usage

3. **Prefetch next page** while upserting current one

4. **Incremental doc maps** (targeted `whereIn` queries) instead of full table scans via `buildCoreIdMap`

### Performance comparison (videos phase, 1,056 records)

| Approach                            | Local | Production    |
| ----------------------------------- | ----- | ------------- |
| Old (collect-all + upsertByCoreId)  | ~45s  | 20+ min       |
| New (per-page + bulkUpsertByCoreId) | ~49s  | TBD (PR #562) |

### Per-page timing breakdown (local, 500 records/page)

| Component                   | Time   | Notes                                         |
| --------------------------- | ------ | --------------------------------------------- |
| Core API fetch              | 2-28s  | Gateway response, varies with payload size    |
| Origin/edition bulk upsert  | ~64ms  | Was 2+ seconds with upsertByCoreId            |
| Video bulk upsert           | ~76ms  | Fast — temp table + UPDATE FROM               |
| Sub-entity resolve + upsert | ~1-2s  | Images, subtitles, study questions, citations |
| **Page total**              | ~5-30s | Dominated by API fetch                        |

## Gotchas

### Strapi document service vs raw SQL on Railway

Never use `upsertByCoreId` (Strapi document service) in a loop for bulk operations on Railway. Each call incurs 2+ network round-trips through the ORM. Use `bulkUpsertByCoreId` (raw knex SQL) instead, which batches operations and minimizes round-trips.

Local dev masks this because the DB latency is near-zero.

### The controller incremental bug

The controller at `controllers/core-sync.ts` had `ctx.request.body?.incremental === true` which sent `false` (not `undefined`) to `runSync` when the body omitted the field. This overrode the `?? true` default in `runSync`, causing production to always run full syncs. Fixed by sending `undefined` when not specified in the body.

### Core API gateway returns all records with updatedAt filter

When testing incremental, we found the Core API returned all 1,056 videos even with `updatedAt: { gte: <recent_timestamp> }`. Investigation revealed the videos watermark was from March 27 (3 days old) because the video phase hadn't completed successfully since then. All videos had genuinely been updated since March 27.

The incremental system works correctly — it just needs a successful full sync to set a recent watermark. Subsequent syncs with a recent watermark correctly return 0 records.

## Prevention

| Pattern                          | Rule                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strapi document service in loops | Never use `upsertByCoreId` in a loop on Railway. Always use `bulkUpsertByCoreId` for batch operations.                                             |
| Local vs production parity       | Test sync performance on Railway, not just local. Network latency between containers amplifies per-query overhead.                                 |
| Controller defaults              | When a controller passes options to a service, use `undefined` (not `false`) for unspecified optional booleans to let the service's default apply. |
| Progress visibility              | Always show progress during long operations. The collect-all pattern gives zero visibility for the entire fetch duration.                          |

## Key Files

- `apps/cms/src/api/core-sync/services/sync-videos.ts` — video sync (PR #562)
- `apps/cms/src/api/core-sync/services/sync-video-variants.ts` — variant sync (PR #560)
- `apps/cms/src/api/core-sync/services/bulk-upsert.ts` — batch upsert engine (PR #558)
- `apps/cms/src/api/core-sync/controllers/core-sync.ts` — controller incremental fix (PR #560)

## Related Documentation

- [Core sync bulk UPDATE temp table pattern](./core-sync-bulk-update-temp-table-pattern.md)
- [Core sync per-page upsert pattern](./core-sync-per-page-upsert-pattern.md)
- [Core sync incremental delta sync](./core-sync-incremental-delta-sync.md)
