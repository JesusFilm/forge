---
id: "feat-312"
title: "Admin query embedding one-second fast fail"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-03"
duration: 1
depends_on:
  - "feat-311"
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "latency"
---

## Problem

Live Watch search should not spend multiple seconds waiting on a query embedding
provider. The prior single-query embedding path allowed a provider attempt to
run for 2.5 seconds and retried once, which made provider instability show up as
roughly five-second degraded semantic lanes.

## What Changed

1. Reduce the single-query embedding provider timeout to 1 second.
2. Disable retries for single-query embedding calls.
3. Reduce the Watch semantic embedding lane budget to 1 second total.
4. Keep bulk/backfill embedding generation on the existing longer batch timeout.

## Verification

```bash
pnpm --filter @forge/admin exec vitest run src/services/embeddings.service.test.ts src/services/watch-search.service.test.ts
pnpm --filter @forge/admin typecheck
```
