---
module: apps/admin core sync
date: 2026-05-07
last_updated: 2026-05-19
problem_type: performance_issue
component: background_job
severity: medium
symptoms:
  - Full Core sync spends most of its time in video dub and download phases.
  - Nested video variant downloads make the Core API and local write path hard to tune independently.
  - Repeat incremental syncs rewrite unchanged rows unless conflict updates are guarded.
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - database
  - service_object
tags:
  - core-sync
  - bulk-upsert
  - workflow
  - postgres
---

# Admin Core Sync High-Volume Bulk Upsert Pattern

## Problem

Admin Core sync originally treated `videoVariants` as the parent for too much
data. Dubs, Mux metadata, editions, subtitles, images, and downloads were
either nested or mixed into broader phases, which made one phase look like one
opaque long-running step and left local Postgres doing too many per-row writes.

The worst case was video dub downloads: roughly 1.36 million rows. Once Core
exposed root queries for downloads and related entities, the admin sync needed
to split them into dedicated phases and make the local write path bulk-oriented.

## Symptoms

- A clean full sync took about 14m 51s with large root-query pages but row-ish
  local writes.
- `video-dubs` and `video-dub-downloads` dominated wall-clock time.
- Increasing page size and request concurrency helped only until local writes
  became the bottleneck.
- The UI could not show useful Core Sync progress while one oversized phase
  owned most of the run.

## What Didn't Work

Increasing page size alone reduced network overhead, but it did not remove the
local write bottleneck.

Fetching multiple pages at once helped the download phase, but it was only safe
when database writes stayed ordered and bounded. Running concurrent DB writes
for these large phases risks pushing contention into Postgres instead of
solving the bottleneck.

Skipping unchanged conflict updates is not safe during full sync if soft-delete
uses `synced_at` as the presence marker. Unchanged rows must still be refreshed
on full sync, or the cleanup tail can treat present rows as stale.

## Solution

Split high-volume related data into root-query phases:

- `video-images` _(query shape changed flat → nested in PR #950; see the
  [flat-vs-nested image query learning](../integration-issues/admin-core-sync-flat-vs-nested-image-query-coverage-gap-20260519.md).
  The phase split itself is unchanged.)_
- `video-editions`
- `video-subtitles`
- `video-dubs`
- `video-dub-downloads`

Keep `video-dubs` responsible for Core `videoVariants`, Mux metadata, and the
dub row itself. Move download rows to `video-dub-downloads` via Core's
`videoVariantDownloads` root query.

Use raw bulk upsert for large local write sets:

```sql
INSERT INTO "video_dub_download" (...)
SELECT ...
FROM unnest($ids::text[], $core_ids::text[], ...)
ON CONFLICT ("core_id")
DO UPDATE SET ...
WHERE
  $refresh_unchanged_rows::boolean
  OR "video_dub_download"."deleted_at" IS NOT NULL
  OR "video_dub_download"."quality" IS DISTINCT FROM EXCLUDED."quality"
  OR ...
```

The `refresh_unchanged_rows` flag is the load-bearing part:

- full sync passes `true`, so `synced_at` marks every seen row for the
  soft-delete tail;
- incremental sync passes `false`, so unchanged conflicts avoid unnecessary
  updates.

For large phases, use `INSERT ... SELECT FROM unnest(...) ON CONFLICT` with
parallel-array length checks before calling Prisma raw SQL. This keeps bind
counts low and catches array-shape mistakes before Postgres silently pads
unequal `unnest` arrays with NULLs.

## Why This Works

Root queries reduce Core resolver fan-out and let each entity class choose its
own page size and retry behavior.

Bulk upsert collapses thousands of row writes into a small number of SQL
round-trips. The conflict `WHERE ... IS DISTINCT FROM` guard avoids rewriting
unchanged rows on incremental syncs while preserving full-sync presence
tracking.

The dedicated Workflow steps make progress observable: a run now shows separate
steps for subtitles, dubs, downloads, images, editions, and origins instead of
one giant sync block.

## Results

After splitting phases and bulk-upserting the largest local writes, a wiped
full sync completed in about 7m 58s:

- `video-dubs`: 91,988ms for 209,297 rows
- `video-dub-downloads`: 302,205ms for 1,361,601 rows
- total run: 477,954ms
- coverage audit: pass
- sync errors: 0

## Prevention

When adding another high-volume Core entity:

1. Prefer a root Core query with `updatedAt` filtering over relation nesting.
2. Make it a separate sync phase if operators will care about its progress.
3. Use page-level bulk writes for large row counts.
4. Keep full-sync soft-delete semantics explicit: either track seen IDs safely
   or refresh `synced_at` for every present row.
5. Guard incremental `ON CONFLICT DO UPDATE` with `IS DISTINCT FROM` when row
   churn matters.
6. Benchmark against a wiped local database and record phase timings before
   merging.

## References

- `apps/admin/src/services/core-sync/phases/sync-dubs.ts`
- `apps/admin/src/services/core-sync/phases/sync-dub-downloads.ts`
- `apps/admin/src/services/core-sync/orchestrator.ts`
- `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`
- `docs/solutions/database-issues/postgres-prepared-statement-bind-variable-limit-32767-20260504.md`
- `docs/solutions/integration-issues/admin-core-sync-flat-vs-nested-image-query-coverage-gap-20260519.md`
