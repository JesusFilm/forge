---
id: "feat-272"
title: "Admin production search trace retention self-heal"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on:
  - "feat-136"
blocks: []
tags:
  - "admin"
  - "search"
  - "observability"
  - "production"
---

## Problem

Production Watch search can return results while the Admin search analytics page
has no raw trace detail. The raw trace writer currently refuses to store rows in
production whenever the retention scheduler heartbeat is missing or stale. That
protects the 30-day raw-query retention limit, but it also creates a total trace
capture outage when the scheduler is not active.

## Entry Points

1. `apps/admin/src/services/search-trace.service.ts`
2. `apps/admin/src/services/search-trace-retention.service.ts`
3. `apps/admin/src/graphql/queries/watch-search.ts`
4. `apps/admin/src/app/dashboard/ops-data.ts`

## What To Build

1. Keep raw trace writes blocked when retention cannot be proven safe.
2. Before blocking capture, run the existing expired-trace purge inline so a
   successful purge can re-establish retention safety for the current write.
3. Preserve aggregate writes and live search responses even when purge or trace
   writes fail.
4. Add a regression test for production with missing retention health.

## Verification

```
pnpm --filter @forge/admin test -- search-trace.service.test.ts search-trace-retention.service.test.ts
pnpm --filter @forge/admin typecheck
```
