---
id: "feat-143"
title: "Drop legacy search trace aggregate unique key"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-05-26"
duration: 1
depends_on:
  - "feat-137"
blocks: []
tags:
  - "admin"
  - "search"
  - "observability"
  - "database"
---

## Problem

Feat-137 keeps the original 10-column `search_trace_aggregate` unique key for
rolling deploy compatibility while adding the new label-source/version-aware
unique key. That prevents old Admin instances from failing aggregate upserts
during the deployment window, but the compatibility key should be removed
before future deterministic label versions need multiple aggregate cohorts for
the same legacy dimensions.

## Entry Points - Read These First

1. `apps/admin/prisma/schema.prisma`
   - `SearchTraceAggregate` currently declares both the legacy and
     label-version-aware unique keys.
2. `apps/admin/prisma/migrations/0022_search_trace_query_label_provenance/migration.sql`
   - Adds the version-aware key while intentionally preserving the legacy key.
3. `apps/admin/src/services/search-trace.service.ts`
   - Upserts aggregates through the version-aware Prisma compound key.

## What To Build

1. After feat-137 has deployed and old Admin instances are drained, add a
   migration that drops `search_trace_aggregate_bucket_dims_key`.
2. Remove the legacy Prisma `@@unique` declaration while keeping
   `search_trace_aggregate_bucket_label_dims_key`.
3. Validate that aggregate upserts still use the label-version-aware compound
   key and that future label versions can coexist for the same non-version
   dimensions.

## Constraints

- Do not drop the legacy key in the same deployment as feat-137.
- Keep aggregate rows query-free.
- Do not change public REST or GraphQL search response shapes.

## Verification

```
pnpm --filter @forge/admin db:generate
pnpm --filter @forge/admin exec prisma validate
pnpm --filter @forge/admin test -- search-trace.service.test.ts
pnpm --filter @forge/admin typecheck
```
