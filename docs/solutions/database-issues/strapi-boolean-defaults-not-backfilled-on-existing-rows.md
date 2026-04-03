---
title: "Backfill NULL boolean columns after Strapi data snapshot import to prevent GraphQL non-nullable errors"
category: database-issues
date: 2026-04-01
severity: high
component: apps/cms/src/scripts/data-import
tags:
  - strapi
  - graphql
  - database
  - data-import
  - boolean-defaults
  - backfill
  - cms
related_issues: []
---

## Problem

The manager app's `/api/videos` route returned a GraphQL error:

```
Cannot return null for non-nullable field Video.aiMetadata
```

Three required boolean fields across three Strapi content type tables contained NULL values despite their schemas declaring `required: true` with `default: false`:

| Table             | Field          | Schema Default | Null Rows | Total Rows     |
| ----------------- | -------------- | -------------- | --------- | -------------- |
| `videos`          | `ai_metadata`  | `false`        | 2,112     | 2,167 (97%)    |
| `video_subtitles` | `ai_generated` | `false`        | 20,126    | 20,126 (100%)  |
| `video_variants`  | `ai_generated` | `false`        | 414,624   | 414,624 (100%) |

The GraphQL schema declared these as `Boolean!` (non-nullable), so any NULL in the database caused a hard runtime error.

## Investigation Steps

1. Traced the error from `apps/manager/src/app/api/videos/route.ts` to the GraphQL query requesting `aiMetadata` on the Video type.
2. Checked the CMS content type schema at `apps/cms/src/api/video/content-types/video/schema.json` — field is `required: true, default: false`.
3. Checked `apps/cms/schema.graphql` — field type is `Boolean!` (non-nullable), confirming Strapi promotes `required: true` to a non-nullable GraphQL type.
4. Wrote a script to extract all required non-relation fields from all 20 Strapi `schema.json` files and generated SQL to check every required field for NULL values across the database.
5. Found exactly 3 fields with NULLs, then queried total vs null row counts to understand scope (nearly 100% of rows affected).
6. Confirmed no `DEFAULT` constraint exists at the PostgreSQL column level — Strapi manages defaults purely at the ORM layer.

## Root Cause

Strapi v5 only applies `default` values during new record creation through its ORM. When a boolean field with `default: false` is added to a content type schema **after** data already exists, existing rows are not backfilled. PostgreSQL columns are added as nullable with no database-level DEFAULT constraint.

This means any schema migration that adds a required field with a default leaves all pre-existing rows with NULL. The data-import pipeline compounds this: restoring a `pg_dump` snapshot faithfully reproduces the NULLs, so even a fresh environment inherits the problem.

## What This Does Not Mean

This issue does **not** mean the whole database is corrupted.

It means specific historical rows drifted out of sync with the current schema contract. In this case, the snapshot reproduced old `NULL` values in columns that the current Strapi schema now exposes as required `Boolean!` fields.

The operational takeaway is narrower:

- **Real deploy risk:** another environment still has the same `NULL` rows and application code reads those fields before a backfill or import fixup runs
- **Not automatic deploy risk for all new work:** once the data is backfilled, or the environment uses the real import pipeline that applies the repair, current feature work is not invalid just because the snapshot once contained stale rows
- **Why local dev surfaced it first:** this was reproduced through a local snapshot restore path that loaded the raw dump before all cleanup steps had run, so it exposed data drift that fresh ORM-created rows would not show

## Solution

### 1. Immediate: Backfill the current database

```sql
UPDATE videos SET ai_metadata = false WHERE ai_metadata IS NULL;
UPDATE video_subtitles SET ai_generated = false WHERE ai_generated IS NULL;
UPDATE video_variants SET ai_generated = false WHERE ai_generated IS NULL;
```

### 2. Durable: Add a backfill step to the data-import pipeline

Added `backfillBooleanDefaults()` to `apps/cms/src/scripts/data-import-utils.ts` with a `BOOLEAN_DEFAULTS` registry:

```typescript
const BOOLEAN_DEFAULTS: Array<{
  table: string
  column: string
  value: boolean
}> = [
  { table: "videos", column: "ai_metadata", value: false },
  { table: "video_subtitles", column: "ai_generated", value: false },
  { table: "video_variants", column: "ai_generated", value: false },
]
```

Integrated as Step 6/7 in `data-import.ts`, between "Nullify admin refs" and "Record import state" — follows the same post-restore fixup pattern as the existing `nullifyAdminRefs()`.

## Key Insight

Strapi v5 has a schema-database impedance mismatch for defaults: the GraphQL schema says `Boolean!`, the content type schema says `default: false`, but the actual PostgreSQL column has no DEFAULT constraint and permits NULL. Strapi only enforces defaults at write time through its ORM, not at the DDL level. Any data that bypasses the ORM (pre-existing rows, pg_dump restores, direct SQL) will carry NULLs that GraphQL rejects at read time. The fix must live in the data pipeline, not the schema, because the schema is already "correct" — it is the data that drifts.

## Prevention

- **When adding a required boolean to an existing content type**: always pair the schema change with an entry in the `BOOLEAN_DEFAULTS` registry in the same PR.
- **Test with production snapshots**: fresh databases have zero pre-existing rows and will never surface this bug.
- **Consider a drift-detection script**: parse all `schema.json` files for required booleans with defaults and compare against the `BOOLEAN_DEFAULTS` array. Flag any missing entries in CI.

## Related Documentation

- [CMS Database Snapshot Restore Automation](../platform/cms-database-snapshot-restore-automation.md) — explains why a raw snapshot restore is not equivalent to the full import pipeline and can temporarily surface stale rows before fixups run
- [Strapi v5 Many-to-One Relation Clearing](../integration-issues/strapi-v5-manytone-relation-clearing.md) — related pattern of Strapi treating missing/null values non-obviously
- [Codegen Strips Optional GraphQL Variables](../cms/codegen-strips-optional-graphql-variables.md) — another GraphQL nullability issue with different root cause
