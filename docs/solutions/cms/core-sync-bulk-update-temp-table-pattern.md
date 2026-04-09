---
title: "Core Sync Bulk UPDATE via Temp Table + UPDATE FROM"
category: cms
date: 2026-03-29
severity: high
tags:
  - core-sync
  - performance
  - postgresql
  - knex
  - bulk-upsert
  - strapi-v5
modules:
  - apps/cms
related_issues:
  - "PR #555"
related:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
---

# Core Sync Bulk UPDATE via Temp Table + UPDATE FROM

## Problem

The `bulkUpsertByCoreId` function in core-sync batched INSERT operations (500/batch) but performed UPDATE operations one-at-a-time: 2 individual SQL queries per record (draft row + published row). With 2-5M video variant records, this meant 4-10M sequential round-trips to Railway-hosted PostgreSQL, taking days to complete.

## Symptoms

- Sync throughput of ~4 records per 10 seconds on updates
- Video variant sync phase taking hours/days instead of minutes
- Railway logs showing continuous individual UPDATE statements
- Full sync triggered on every restart because incremental default was `false`

## What Didn't Work

- **Individual updates with PK lookup**: The original approach used `knex(tableName).where("id", draftId).update(data)` per row. Even though PK lookups are indexed, the network round-trip latency (~2-5ms per query) dominated at scale.

## Solution

Replaced the one-at-a-time UPDATE loop with PostgreSQL's temp table + UPDATE FROM pattern:

1. Build all update rows into a flat array (draft + published per record)
2. Create a temp table cloning the target table's column types
3. Batch INSERT into the temp table (500 rows per batch)
4. Execute a single `UPDATE ... FROM` join
5. DROP the temp table

```typescript
// Create temp table with matching column types (no constraints)
await knex.raw(`CREATE TEMP TABLE ?? AS SELECT * FROM ?? WHERE false`, [
  tempTable,
  tableName,
])

// Batch INSERT into temp table
for (let i = 0; i < updateRows.length; i += BATCH) {
  await knex(tempTable).insert(updateRows.slice(i, i + BATCH))
}

// Single UPDATE FROM join
const dataCols = Object.keys(updateRows[0]!).filter((c) => c !== "id")
const setClause = dataCols
  .map((c) => `"${c}" = "${tempTable}"."${c}"`)
  .join(", ")
await knex.raw(
  `UPDATE "${tableName}" SET ${setClause} FROM "${tempTable}" WHERE "${tableName}"."id" = "${tempTable}"."id"`,
)
```

Also flipped the incremental sync default from `false` to `true` so syncs resume from the watermark instead of re-fetching everything.

## Why This Works

- **Network round-trips reduced from 2N to ~(2N/500) + 3**: For 100k records, that's ~403 queries instead of 200,000.
- **PostgreSQL optimizes the UPDATE FROM**: Uses the PK index on the target table and processes all rows in a single pass.
- **`CREATE TABLE AS SELECT ... WHERE false`**: Clones column types without constraints (unlike `LIKE` which copies NOT NULL constraints, causing INSERT failures on partial column sets).

## Gotchas

### 1. Knex batch insert uses first object's keys as column list

When calling `knex(table).insert([{a:1}, {a:1, b:2}])`, knex determines the INSERT column list from the **first object's keys**. Extra keys in subsequent objects are silently dropped.

**Fix**: Ensure all objects in the array have identical key sets. For the Strapi v5 dual-row pattern (draft + published), always include `published_at` explicitly:

```typescript
// Draft row: explicitly set published_at to null
updateRows.push({ id: draftId, ...base, published_at: null })
// Published row: set published_at to now
updateRows.push({ id: publishedId, ...base, published_at: now })
```

### 2. CREATE TABLE AS vs LIKE

- `CREATE TABLE AS SELECT * FROM t WHERE false` — copies column names and types only. No constraints, no defaults, no indexes. Safe for partial-column inserts.
- `CREATE TEMP TABLE t2 (LIKE t)` — copies column names, types, AND NOT NULL constraints. Will reject inserts missing non-nullable columns.

Always use `AS SELECT ... WHERE false` for temp staging tables.

### 3. Temp table cleanup

Always DROP in a `finally` block, and log errors instead of swallowing them:

```typescript
finally {
  await knex.raw(`DROP TABLE IF EXISTS ??`, [tempTable]).catch((e) => {
    strapi.log.warn(`Failed to drop temp table ${tempTable}: ${e}`)
  })
}
```

If DROP fails (e.g., connection lost), the temp table persists for the session lifetime. A swallowed error here means the next sync's CREATE will fail silently, cascading to the fallback path.

### 4. Fallback resilience

Wrap the batch path in try/catch and fall back to individual updates if it fails — matching the existing create path's resilience pattern. This ensures a bad batch doesn't halt the entire sync.

## Prevention

| Pattern                           | Rule                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Knex batch insert key consistency | All objects in a batch insert array must have identical keys. Missing keys are silently dropped, not set to NULL. |
| Temp table creation               | Use `CREATE TABLE AS SELECT ... WHERE false` for staging tables, never `LIKE`                                     |
| Temp table cleanup                | Always DROP in finally block with error logging                                                                   |
| Strapi v5 dual-row updates        | Always include `published_at` explicitly (null for drafts, timestamp for published)                               |
| Sync default mode                 | Default to incremental (`true`) — first run auto-falls-back to full when no watermark exists                      |

## Key Files

- `apps/cms/src/api/core-sync/services/bulk-upsert.ts` — bulk upsert with temp table UPDATE FROM
- `apps/cms/src/api/core-sync/services/core-sync.ts` — sync orchestrator, incremental default
- `apps/cms/src/api/core-sync/services/sync-video-variants.ts` — video variants phase runner

## Related Documentation

- [Core sync incremental delta sync](./core-sync-incremental-delta-sync.md) — watermark system design
- [Strapi v5 manyToOne relation clearing](../integration-issues/strapi-v5-manytone-relation-clearing.md) — relation handling in sync
- [CMS database snapshot restore](../platform/cms-database-snapshot-restore-automation.md) — confirms full sync takes 4+ hours
