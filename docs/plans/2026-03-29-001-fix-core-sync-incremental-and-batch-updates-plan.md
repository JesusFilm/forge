---
title: "fix: Core sync incremental default + batch UPDATE performance"
type: fix
status: active
date: 2026-03-29
origin: docs/solutions/cms/core-sync-incremental-delta-sync.md
---

# fix: Core sync incremental default + batch UPDATE performance

## Overview

The core-sync system has two compounding problems that make syncing 2-5M records infeasible:

1. **Incremental sync defaults to off** — every trigger does a full sync unless the caller explicitly passes `{ incremental: true }`. The watermark system exists but is never used by default.
2. **Updates are sequential** — `bulk-upsert.ts` batches INSERTs (500/batch) but does UPDATEs one-at-a-time (2 SQL queries per record: draft + published). For millions of existing records, this is the primary bottleneck.

## Problem Frame

The sync pulls data from the JFP gateway GraphQL API into the Strapi v5 PostgreSQL database. With 2-5M video variant records, the current approach takes days. The user observes ~4 records per 10 seconds on updates, which is consistent with individual UPDATE round-trips to a Railway-hosted PostgreSQL instance (~5ms per query, 2 queries per record, plus overhead).

## Requirements Trace

- R1. Sync defaults to incremental when a watermark exists, falling back to full on first run
- R2. Batch UPDATE queries to achieve throughput comparable to batch INSERTs (~500 records per DB round-trip)
- R3. Preserve Strapi v5 two-row invariant (draft + published rows per document)
- R4. Preserve `source: "manager"` skip logic (never overwrite manager-sourced records)
- R5. Maintain fallback-to-individual resilience on batch failure
- R6. Measurable improvement verified via Railway logs

## Scope Boundaries

- Only `apps/cms/src/api/core-sync/` is modified
- No changes to the gateway API, GraphQL queries, or content types
- No changes to the CREATE path (already batched)
- No changes to link table handling (already uses batched whereIn + batch insert)
- Countries/Keywords always full sync (gateway lacks `updatedAt` support) — unchanged

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/core-sync/services/bulk-upsert.ts` — bulk upsert with raw knex SQL. Creates are batched, updates are not.
- `apps/cms/src/api/core-sync/services/core-sync.ts:114` — `incremental ?? false` is the default
- `apps/cms/src/api/core-sync/controllers/core-sync.ts:14` — `ctx.request.body?.incremental === true` strict check
- Existing pattern: knex raw SQL, `INSERT ... RETURNING`, batch sizes of 500

### Institutional Learnings

- `docs/solutions/cms/core-sync-incremental-delta-sync.md` — watermark system design, per-phase timestamps, zero-error advancement
- `docs/solutions/platform/cms-database-snapshot-restore-automation.md` — confirms full sync takes 4+ hours, Railway filesystem is ephemeral
- PR #555 — when bypassing Strapi document service, must use snake_case DB column names

## Key Technical Decisions

- **Flip incremental default to `true`**: The watermark system already handles the first-run case — `getLastSyncTime` returns `null`, which means `since` is `undefined`, which means the phase runner does a full fetch. So defaulting to `true` is safe: first run = full, subsequent runs = incremental. Callers can still explicitly pass `{ incremental: false }` for a forced full sync.

- **Use PostgreSQL temp table + UPDATE FROM for batch updates**: Rather than `UPDATE ... SET ... WHERE id = ?` per record, stage all updates into a temp table (batch INSERT), then execute a single `UPDATE ... FROM` join. This reduces N individual round-trips to ~(N/500) batch inserts + 1 UPDATE statement.

  Why temp table over other approaches:
  - `ON CONFLICT DO UPDATE` won't work because we update by PK (`id`), not by a unique constraint on the data columns
  - `unnest()` with arrays is fragile for dynamic column sets
  - Temp table is the standard PostgreSQL pattern for bulk updates with arbitrary column sets, well-supported by knex raw queries

- **Batch size stays at 500**: Consistent with the existing CREATE batch size. Can be tuned later via env var if needed.

## Open Questions

### Resolved During Planning

- **Q: Will flipping the default break any existing callers?** Resolution: No. The only callers are `POST /core-sync/trigger` (which can still pass `incremental: false` for full sync) and `runFullSync()` (which explicitly passes `incremental: false`). The default change only affects callers that don't specify — making them incremental is the desired behavior.

- **Q: What about the `locale` column on the temp table?** Resolution: The temp table doesn't need locale — we're updating by PK (`id`), which is already locale-specific since Step 1 loads existing records filtered by locale.

### Deferred to Implementation

- **Exact temp table column types**: Will be determined at implementation time based on the column types in each target table. The temp table only needs `id INTEGER` plus the data columns being updated.
- **Whether to add `CORE_SYNC_UPDATE_BATCH_SIZE` env var**: Start with hardcoded 500, add env var only if tuning is needed.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
Current update path (per record):
  for each record:
    UPDATE table SET col1=v1, col2=v2 WHERE id = draft_id    -- 1 round-trip
    UPDATE table SET col1=v1, col2=v2 WHERE id = published_id -- 1 round-trip
  Total: 2N round-trips

Proposed update path (batched):
  1. CREATE TEMP TABLE _bulk_update_<table> (id INTEGER, col1, col2, ...)
  2. for each batch of 500:
       INSERT INTO _bulk_update VALUES (draft_id, v1, v2, ...), (pub_id, v1, v2, ...)
     Total: ceil(2N / 500) round-trips
  3. UPDATE table AS t SET col1=s.col1, col2=s.col2, ...
     FROM _bulk_update AS s WHERE t.id = s.id
     Total: 1 round-trip
  4. DROP TABLE _bulk_update
     Total: 1 round-trip

  Grand total: ceil(2N / 500) + 3 round-trips
  For N = 100,000: ~403 round-trips vs 200,000
```

## Implementation Units

- [ ] **Unit 1: Flip incremental sync default**

  **Goal:** Make sync incremental by default so restarts resume from the watermark.

  **Requirements:** R1

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/api/core-sync/services/core-sync.ts`

  **Approach:**
  - Change `options?.incremental ?? false` to `options?.incremental ?? true` on line 114
  - `runFullSync()` already passes `incremental: false` explicitly, so it's unaffected
  - Add a log line indicating the default mode so it's visible in Railway logs

  **Patterns to follow:**
  - Existing logging pattern: `[core-sync] ========== Starting ${mode} sync...`

  **Test scenarios:**
  - Calling `runSync(strapi)` with no options runs incremental
  - Calling `runSync(strapi, { incremental: false })` runs full
  - `runFullSync()` still runs full
  - First run with no watermark falls through to full fetch per phase

  **Verification:**
  - Railway logs show `Starting incremental sync` when triggered without explicit `incremental` flag

- [ ] **Unit 2: Batch UPDATE queries in bulk-upsert.ts**

  **Goal:** Replace one-at-a-time UPDATE queries with temp table + UPDATE FROM pattern.

  **Requirements:** R2, R3, R4, R5

  **Dependencies:** None (independent of Unit 1)

  **Files:**
  - Modify: `apps/cms/src/api/core-sync/services/bulk-upsert.ts`

  **Approach:**
  - Replace Step 4 (lines ~209-235) with a batched update strategy:
    1. Build an array of `{ id, ...data, source, updated_at }` rows, one per draft/published row that needs updating
    2. Create a temp table with matching columns using `knex.schema.createTable` (or raw SQL)
    3. Batch INSERT into the temp table (500 rows per batch)
    4. Execute a single `UPDATE table AS t SET ... FROM temp AS s WHERE t.id = s.id`
    5. DROP the temp table
  - Each update record contributes up to 2 rows to the temp table (draft + published), with the published row also setting `published_at`
  - Preserve `source: "manager"` skip logic — these records are already filtered out in Step 2 (classify), so they never reach the update path
  - Wrap in try/catch — on failure, fall back to the current one-at-a-time approach (matching the create path's resilience pattern)
  - Use a unique temp table name per call to avoid collisions (e.g., `_bulk_upd_${tableName}`)

  **Patterns to follow:**
  - Existing batch INSERT pattern in Step 3 of bulk-upsert.ts (lines 132-207)
  - Existing knex usage throughout the file
  - `BATCH = 500` constant already defined

  **Test scenarios:**
  - Batch of 1,000 existing records updates both draft and published rows correctly
  - Mixed batch (some creates, some updates) — creates use existing path, updates use new batched path
  - All `source: "manager"` records are skipped (existing behavior preserved)
  - Batch update failure falls back to individual updates
  - Empty update set (all creates) skips the temp table path entirely
  - Columns with NULL values are preserved correctly

  **Verification:**
  - Railway logs show bulk update completing in seconds instead of minutes for large record sets
  - `stats.updated` count matches expected number of records
  - Draft and published rows both contain updated data after sync

- [ ] **Unit 3: Verify via Railway logs**

  **Goal:** Trigger sync on Railway and measure performance improvement.

  **Requirements:** R6

  **Dependencies:** Units 1 and 2 deployed

  **Files:**
  - No code changes

  **Approach:**
  - Deploy to Railway
  - Trigger an incremental sync via `POST /core-sync/trigger` (no body needed — now defaults to incremental)
  - Monitor Railway logs for timing output from existing `[core-sync]` log lines
  - Compare variant sync duration against previous runs
  - If incremental watermark exists, verify it only fetches recently updated records (look for `Core API reports N updated video variants` where N is small)
  - If no watermark exists (first run after deploy), run full sync, then trigger again to verify incremental picks up

  **Verification:**
  - Incremental sync shows small record count (not 2-5M)
  - Batch update phase completes in seconds/minutes, not hours
  - Watermark is persisted (check via status endpoint)

## System-Wide Impact

- **Interaction graph:** Only the sync trigger endpoint and internal phase runners are affected. No Strapi middleware, lifecycle hooks, or content API changes.
- **Error propagation:** Batch update failure falls back to individual updates — same error handling as batch creates. Phase-level error count still controls watermark advancement.
- **State lifecycle risks:** Temp tables are session-scoped and auto-dropped on connection close, so no cleanup risk. The `syncInProgress` flag prevents concurrent syncs that could conflict.
- **API surface parity:** The `/core-sync/trigger` endpoint behavior changes (incremental default), but this is the desired fix. The `/core-sync/status` endpoint is unchanged.

## Risks & Dependencies

- **Risk: Temp table column mismatch** — if the data object contains columns not in the target table, the UPDATE FROM will fail. Mitigation: the data columns are already validated by the existing INSERT path, which would also fail. The fallback-to-individual path provides resilience.
- **Risk: Large temp tables** — for 2M records with 2 rows each = 4M rows in the temp table. PostgreSQL handles this well since temp tables are in-memory/tempfiles, but worth monitoring. The batch INSERT approach (500 at a time) avoids building a single massive INSERT statement.
- **Dependency: Railway deployment** — changes need to be deployed before verification. No infrastructure changes needed.

## Sources & References

- **Origin document:** [docs/solutions/cms/core-sync-incremental-delta-sync.md](/workspace/docs/solutions/cms/core-sync-incremental-delta-sync.md)
- Related learning: [docs/solutions/platform/cms-database-snapshot-restore-automation.md](/workspace/docs/solutions/platform/cms-database-snapshot-restore-automation.md)
- Related code: `apps/cms/src/api/core-sync/services/bulk-upsert.ts`
- Related PR: #555 (snake_case DB column names for bulk upsert)
