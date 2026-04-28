---
title: "Core Sync Per-Page Upsert Pattern"
category: cms
date: 2026-03-29
last_updated: 2026-04-28
severity: high
tags:
  - core-sync
  - performance
  - postgresql
  - strapi-v5
  - bulk-upsert
modules:
  - apps/cms
related_issues:
  - "PR #558"
  - "PR #560"
  - "PR #846"
---

# Core Sync Per-Page Upsert Pattern

## Problem

The video variant sync collected ALL records from the Core API into memory (207K+ records) before writing anything to the database. This caused:

1. Zero progress visibility for 60+ minutes (status showed `processed=0`)
2. High memory usage (~207K objects × 2 arrays = variants + downloads)
3. No resumability — if the process crashed during fetch, all progress was lost
4. The fetch phase alone took 60+ minutes at 100 records/page (2,073 sequential API calls)

## Symptoms

- Sync status stuck at `processed=0/207313` for over an hour
- Zero `video_variants` rows in DB during the entire fetch phase
- `mux_videos` count growing (indicating fetch progress) but no variant writes
- Railway monitoring showed sync running without any DB write activity

## Solution

Refactored `sync-video-variants.ts` from collect-all-then-upsert to per-page upsert:

**Before:** Fetch all pages → collect into `allVariantRecords[]` → bulk upsert once
**After:** For each page: fetch → bulk upsert variants → resolve download links → bulk upsert downloads → next page

Also bumped default page size from 100 to 500 (5x fewer API round-trips).

### Key Implementation Detail: Incremental Variant Map

Downloads need to link to their parent variant's `documentId`. Originally this was resolved by calling `buildCoreIdMap` once after all variants were inserted. With per-page upsert, we maintain a **running map** that queries only the just-upserted page's coreIds after each bulk upsert:

```typescript
// Running map accumulated across pages
const variantDocMap = new Map<string, string>()

// Inside the per-page loop, after variant bulk upsert:
const pageCoreIds = pageVariantRecords.map((r) => r.coreId)
const variantRows = await knex("video_variants")
  .select("core_id", "document_id")
  .whereIn("core_id", pageCoreIds)
  .where("locale", "")
  .groupBy("core_id", "document_id")
for (const row of variantRows) {
  variantDocMap.set(row.core_id, row.document_id)
}
```

## Why This Works

- **Immediate progress**: DB writes happen per page, so the status endpoint shows real progress
- **Reduced memory**: Only one page of records in memory at a time (plus the running sets/maps)
- **Fewer API calls**: 500/page = ~415 requests instead of 2,073 at 100/page
- **Better resumability**: If the process crashes, only the current page's work is lost

## Gotchas

### Do NOT call buildCoreIdMap inside a per-page loop

During code review, we caught that `buildCoreIdMap` was initially placed inside the loop. This function does a full paginated table scan (1000 rows at a time through Strapi's document service). With 415 pages, that's 415 full scans of an increasingly large table — O(pages × totalVariants).

**Fix**: Use a targeted `whereIn("core_id", pageCoreIds)` query that only fetches the current page's records, and merge into a running map.

### bulkUpsertByCoreId loads the full table each call

`bulkUpsertByCoreId` Step 1 loads ALL existing records for the table to classify creates vs updates. When called per-page, this repeats for every page. For the first full sync (0 existing rows) this is fast. For subsequent syncs with 200K+ rows, it's a known overhead that should be addressed in a future refactor (e.g., passing in a pre-loaded existingMap or filtering by the page's coreIds).

### Soft-delete `notIn: [...seenCoreIds]` exceeds Postgres bind-param limit at scale

The end-of-phase soft-delete sweep `WHERE coreId NOT IN (...)` binds one
parameter per element. Once the seen-set grows past ~50K rows for a given
entity, this approaches Postgres's 65535 bind-parameter limit. Cms-side
catalogs are below that today, but the same pattern was carried forward
into admin's port (PR #846) and surfaced as a real risk for admin's video
+ video_dub phases. The fix is to invert the sweep to a
`synced_at < runStartedAt` watermark — see
[Soft-delete notIn watermark anti-pattern](../performance-issues/soft-delete-notIn-watermark-anti-pattern-20260428.md).

## Prevention

| Pattern                       | Rule                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Full table scans inside loops | Never call buildCoreIdMap or similar full-scan functions inside a pagination loop. Use targeted queries or incremental maps. |
| Collect-all-then-write        | For large datasets (>10K records), prefer per-page/streaming writes over collecting everything into memory first.            |
| Page size defaults            | Use 500+ for internal sync operations between trusted services. 100 is too conservative for server-to-server GraphQL.        |
| Progress reporting            | Ensure progress increments during the work, not only after completion. Users need visibility into long-running operations.   |

## Key Files

- `apps/cms/src/api/core-sync/services/sync-video-variants.ts` — per-page upsert loop
- `apps/cms/src/api/core-sync/services/sync-videos.ts` — page size bump
- `apps/cms/src/api/core-sync/services/bulk-upsert.ts` — bulk upsert (called per page)

## Sibling implementation: admin (PR #846, 2026-04-28)

Admin's `apps/admin/src/services/core-sync/phases/sync-{languages,
countries,keywords,videos,dubs}.ts` ports this per-page pattern but
goes one architectural step further: instead of per-row
`prisma.upsert` inside an interactive `$transaction({timeout:5_000})`,
each page issues a single bulk `INSERT … ON CONFLICT DO UPDATE` via
`prisma.$executeRaw` + `Prisma.sql` + `Prisma.join`.

Two reasons this matters:

1. **Per-row Prisma upserts inside `$transaction({timeout:5_000})` time
   out reliably in production** — admin's R1 prod smoke on
   2026-04-27 hit `Transaction API error: Transaction not found` on
   every page, wrote zero rows, and reported clean test/deploy state.
   See [Prisma `$transaction({timeout:5_000})` is the wrong tool for
   per-row bulk work](../database-issues/prisma-transaction-timeout-wrong-tool-for-per-row-bulk-20260428.md).
2. **Admin's bulk-INSERT approach also resolves MANAGER-style per-row
   protection at the SQL layer** via `ON CONFLICT … DO UPDATE …
WHERE source != 'manager' RETURNING` — the JS-side pre-pass
   `findUnique` that this cms doc's pattern would have inherited is
   collapsed into the bulk statement. See [Per-row protection in a
   bulk INSERT via ON CONFLICT WHERE +
   RETURNING absence-as-signal](../best-practices/prisma-on-conflict-where-row-protection-20260428.md).

For the helpers (`newRowId` via `@paralleldrive/cuid2`, `jsonbParam`
for the PG18 jsonb cast, `bulkErrorLogFields` for structured catch
logging) and the worked examples, see [Bulk upsert in Prisma via
`$executeRaw` + `Prisma.join` + `INSERT … ON CONFLICT DO
UPDATE`](../best-practices/prisma-bulk-upsert-pattern-20260428.md).

## Related Documentation

- [Core sync bulk UPDATE temp table pattern](./core-sync-bulk-update-temp-table-pattern.md) — batch UPDATE optimization (PR #558)
- [Core sync incremental delta sync](./core-sync-incremental-delta-sync.md) — watermark system
- [Prisma `$transaction({timeout:5_000})` is the wrong tool for per-row bulk work](../database-issues/prisma-transaction-timeout-wrong-tool-for-per-row-bulk-20260428.md) — admin-side failure mode that motivated PR #846
- [Bulk upsert in Prisma via `$executeRaw` + `Prisma.join` + `INSERT … ON CONFLICT DO UPDATE`](../best-practices/prisma-bulk-upsert-pattern-20260428.md) — admin's evolution of this pattern
- [Per-row protection in a bulk INSERT via `ON CONFLICT … WHERE` + RETURNING absence-as-signal](../best-practices/prisma-on-conflict-where-row-protection-20260428.md) — how MANAGER protection moved from JS pre-pass to SQL
- [Soft-delete notIn watermark anti-pattern](../performance-issues/soft-delete-notIn-watermark-anti-pattern-20260428.md) — bind-parameter-limit risk at scale
