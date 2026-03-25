---
title: Core Sync Incremental Delta Sync
category: cms
date: 2026-03-25
tags: [core-sync, performance, gateway-api, incremental-sync]
---

# Core Sync Incremental Delta Sync

## Problem

The core-sync process fetches ALL records from the gateway API on every run (daily cron). With thousands of videos and variants, this is slow and wasteful when only a handful of records changed.

## Solution

Added incremental (delta) sync support using the gateway API's `updatedAt` `DateTimeFilter` (`{ gte, lte }`).

### Key Decisions

1. **Watermark persistence**: Raw knex table `core_sync_states` with `phase` (PK) and `last_synced_at`. Chose raw knex over a Strapi content type because this is internal sync state, not content — no need for admin UI, REST/GraphQL endpoints, or ORM overhead.

2. **Per-phase timestamps**: Each sync phase stores its own watermark so phases can be re-run independently.

3. **`INSERT ... ON CONFLICT ... DO UPDATE`**: Used knex's `.onConflict().merge()` for atomic upsert of the watermark, avoiding the read-then-write race condition.

4. **Watermark only advances on zero errors**: If a phase has errors, the watermark stays put so failed records are retried on the next incremental run.

5. **Soft-delete only on full sync**: Incremental sync only sees a subset, so running soft-delete would incorrectly unpublish records that simply weren't in the delta.

6. **Countries/Keywords always full sync**: The gateway API doesn't support `updatedAt` filtering on these entity types. They're small datasets so this is fine.

### Gateway API Schema for `updatedAt`

The gateway uses a `DateTimeFilter` input object:

```graphql
input DateTimeFilter {
  gte: DateTime
  lte: DateTime
}
```

All three filterable entity types use this:

- `VideosFilter.updatedAt: DateTimeFilter`
- `LanguagesFilter.updatedAt: DateTimeFilter`
- `VideoVariantFilter.updatedAt: DateTimeFilter`

Usage: `where: { updatedAt: { gte: "2026-03-24T03:00:00.000Z" } }` returns only records updated since that timestamp.

### Gotchas

- The codegen-generated types in `gql/gql.ts` use exact string matching for query→type mapping. When changing query signatures (adding variables), you must update both the document map strings AND the overload signatures to match exactly.
- The `Exact<>` utility type in generated GraphQL types prevents passing extra fields — variable types must match the codegen output precisely.
- Clock skew between CMS and gateway servers could cause missed records. The `gte` operator (inclusive) provides some safety, and records are idempotently upserted so duplicates are harmless. Consider adding a small safety margin (e.g., 60 seconds) to the watermark if drift is observed.
