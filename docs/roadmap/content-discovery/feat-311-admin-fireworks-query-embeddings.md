---
id: "feat-311"
title: "Admin Fireworks query embedding provider"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-02"
duration: 1
depends_on:
  - "feat-175"
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "fireworks"
---

## Problem

Production Watch search semantic embedding latency is dominated by uncached
provider turnaround and timeouts. The current Admin live-query embedding path
uses OpenRouter pinned to one upstream provider with fallbacks disabled, adding
a routing hop without meaningful failover. Production now has a Fireworks API
key available, so Admin needs a reversible Fireworks provider path for live
query embeddings.

## What To Build

1. Add optional Fireworks embedding env configuration to Admin.
2. Add Fireworks as a selectable provider in `embeddings.service.ts` while
   preserving OpenRouter as the default/fallback.
3. Keep query embedding cache keys provider-bound so Fireworks and OpenRouter
   vectors never share cached rows.
4. Update Admin ops readiness to recognize the selected embedding backend.
5. Add provider-selection tests for request body, credential preference,
   missing configuration, and cache identity metadata.

## Constraints

- Do not move live search orchestration out of Admin.
- Do not change stored content embedding provenance or vector indexes.
- Do not make Fireworks required at boot; deploys without the new env must keep
  the OpenRouter path working.
- Keep the provider switch reversible via env only.

## Verification

```bash
pnpm --filter @forge/admin exec vitest run src/services/embeddings.service.test.ts src/services/watch-search.service.test.ts src/app/dashboard/ops-data.test.ts
pnpm --filter @forge/admin typecheck
```
