---
title: Admin watch search production rollout checklist
date: 2026-07-20
category: best-practices
module: apps/admin
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - Replacing a public watch search implementation
  - Shipping search ranking changes with database migrations
  - Adding production search analytics and timing traces
  - Verifying provider-bound transcript semantic search
tags: [admin, search, watch, embeddings, prisma, migrations, analytics, rollout]
---

# Admin Watch Search Production Rollout Checklist

## Context

The universal watch search replacement moves search ownership into Admin:
ranking, query embeddings, availability checks, fallback languages, analytics,
and timing traces all live behind the Admin GraphQL contract consumed by web,
mobile, and TV. This is not a compatibility layer over the old Algolia or R4
hybrid search paths; it is the production search path.

Codex session memory for this rollout reinforced two useful patterns: keep live
query embedding provider selection explicit, and validate migration deploy
against a real Postgres sidecar before trusting CI.

## Guidance

Use the production-readiness check as a release gate, not as a final smoke:

- Run schema generation and generated client regeneration together whenever
  the Admin Pothos schema changes.
- Run `prisma migrate deploy` against a real Postgres sidecar, not only
  `prisma validate`. Prisma wraps normal migration SQL in a transaction, so
  `CREATE INDEX CONCURRENTLY` will fail even when the SQL looks correct in
  isolation.
- Keep query embeddings provider-bound. Query embedding cache rows should be
  keyed by normalized query plus provider, model, dimensions, and transform
  provenance so cached vectors cannot cross model spaces.
- Treat expired embedding cache rows as misses. Do not reuse expired vectors or
  extend their TTL as a side effect of reading them.
- Do not expose playable identifiers from search candidates until the
  watchability step proves the edition has a playable option.
- Keep analytics in Admin and bounded. Record viewed results incrementally,
  record clicks against the visible request, and purge raw search/event rows on
  the retention workflow.
- Preserve trace explainability. Ranking score, component contributions,
  confidence gating, cache hit/miss, and timing spans are production debugging
  surfaces, not UI decoration.

## Why This Matters

Search quality regressions are rarely obvious from a single result list. The
same change can affect language targeting, exact-title recall, transcript
semantic recall, availability fallback, and client click analytics. A rollout is
only trustworthy when the generated GraphQL contract, migrations, provider
credentials, timing traces, and a real search request all agree.

The local sidecar migration check is especially important. CI can validate
formatting, types, tests, builds, and generated schema drift, but it may not
exercise the exact migration transaction behavior that `prisma migrate deploy`
will use in production.

## When to Apply

- Replacing or removing legacy search entry points.
- Changing watch search scoring, confidence gates, or availability joins.
- Adding indexes for search availability or transcript retrieval.
- Adding or changing query embedding caching.
- Preparing a search PR for merge to main.

## Examples

The minimum rollout command shape should include:

```bash
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/admin db:migrate:deploy
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/web typecheck
pnpm --filter @forge/mobile typecheck
pnpm --filter @forge/tv typecheck
pnpm --filter @forge/admin exec vitest run --maxWorkers=2 --minWorkers=1
pnpm --filter @forge/web exec vitest run --maxWorkers=2 --minWorkers=1
pnpm --filter @forge/mobile test
pnpm --filter @forge/tv test
```

> **Added 2026-07-23.** This consumer-side gate cannot detect a consumer left on
> a compile shim. When #1622 shimmed `apps/tv` and `apps/mobile` search to return
> an empty array, every command above stayed green while search was entirely dead
> in both apps — a stub satisfies `typecheck` by construction, and the unit tests
> that would have caught it were deleted in the same commit. For any consumer not
> migrating in the same PR, add a behavioral check (a real query against the new
> surface) and treat a deleted contract assertion as a release blocker. See
> `docs/solutions/best-practices/compile-shim-empty-return-hides-downstream-contract-drift.md`.

For indexes that must be created through Prisma migrations, avoid this shape:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS watch_search_event_request_id_idx
  ON watch_search_event(request_id);
```

Use ordinary migration-safe DDL in Prisma-managed migrations:

```sql
CREATE INDEX IF NOT EXISTS watch_search_event_request_id_idx
  ON watch_search_event(request_id);
```

If a truly concurrent index is required for a hot production table, schedule it
outside the Prisma migration transaction and document the operational step
explicitly.

## Related

- [Admin hybrid search R4 pattern](../platform/admin-hybrid-search-r4-pattern.md)
- [OpenRouter-only embedding provider contract](./openrouter-only-embedding-provider-contract.md)
- [Admin search trace retention pattern](../platform/admin-search-trace-retention-pattern.md)
- [Prisma raw SQL invariant assertions](./prisma-raw-sql-invariant-assertions-20260423.md)
