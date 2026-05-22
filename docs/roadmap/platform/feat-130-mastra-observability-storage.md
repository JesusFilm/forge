---
id: "feat-130"
title: "Mastra Observability Storage"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-22"
duration: 1
depends_on:
  - "feat-129"
blocks: []
tags:
  - "platform"
  - "mastra"
  - "observability"
  - "infrastructure"
---

## Problem

The self-hosted Mastra runtime can serve Studio, but Studio log and
observability screens cannot show failed runs without a persistent
observability store. Railway containers have ephemeral filesystems unless a
volume is attached, so local runtime traces and logs disappear across restarts
and may not be queryable by Studio.

## Entry Points - Read These First

1. `apps/mastra/src/mastra/index.ts` - Mastra runtime configuration.
2. `apps/mastra/src/config/env.ts` - runtime environment validation.
3. `apps/mastra/railway.toml` - Railway build/start configuration.
4. `docs/roadmap/platform/feat-129-mastra-railway-workflow-runtime.md` -
   original runtime and Studio acceptance criteria.

## What To Build

1. Configure Mastra with a persistent default store and an observability store
   that Studio can query for logs and run traces.
2. Enable Mastra Observability with the storage exporter and structured logging.
3. Attach Railway persistent storage to the `@forge/mastra` service and point
   the runtime at the mounted database files.
4. Document the required Railway mount and env values.

## Constraints

- Do not make the Mastra runtime responsible for human identity or Studio
  access control; that remains in `apps/mastra-gateway`.
- Do not log bearer tokens, cookies, model provider keys, or raw prompts that
  may contain sensitive data.
- Keep this scoped to runtime observability/storage; do not migrate Manager
  subtitle workflows in this feature.

## Verification

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- `pnpm --filter @forge/mastra build`
- Railway `@forge/mastra` has a persistent volume mounted for Mastra data.
- Studio logs/observability endpoints return data instead of failing.
