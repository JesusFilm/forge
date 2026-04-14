---
id: "feat-091"
title: "Admin App Sync Hardening and GraphQL Rate Limit"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-04-14"
duration: 3
depends_on:
  - "feat-086"
blocks: []
tags:
  - "platform"
  - "admin"
  - "sync"
  - "security"
  - "prisma"
---

## Problem

The admin app foundation shipped the Core sync architecture, but several
production-hardening items remain in the sync and GraphQL infrastructure. The
current phase runners trust Core payloads at runtime, do not soft-delete unseen
Core rows on full sync, and can leave partial page writes if a process crashes
mid-page. The GraphQL rate limiter also still uses in-memory storage, which is
not safe across multiple Railway instances.

## Entry Points — Read These First

1. `docs/handoffs/2026-04-14-admin-app-v1-handoff.md` — canonical outstanding backend work list after phase 7.
2. `apps/admin/src/services/core-sync/phases/` — current phase runner implementations for languages, countries, keywords, videos, and video-dubs.
3. `apps/cms/src/api/core-sync/services/` — known-working Core query shapes and sync patterns from the CMS implementation.
4. `apps/admin/src/auth/rate-limit.ts` — Redis connection and fail-open local fallback pattern currently used for auth routes.
5. `apps/admin/src/graphql/plugins/rate-limit.ts` — current in-memory GraphQL limiter that must move to shared storage.
6. `apps/admin/src/services/core-sync/orchestrator.ts` and `orchestrator.test.ts` — phase orchestration, watermark semantics, and current test harness.

## Grep These

- `LANGUAGES_QUERY|COUNTRIES_QUERY|KEYWORDS_QUERY|VIDEOS_QUERY|DUBS_QUERY` in `apps/admin/src/services/core-sync/phases/`
- `softDeleteUnseen|seenIds|seenVariantIds|circuit breaker|prefetch` in `apps/cms/src/api/core-sync/services/`
- `InMemoryStore|useRateLimiter` in `apps/admin/src/graphql/plugins/`
- `REDIS_HOST|REDIS_PORT|REDIS_PASSWORD` in `apps/admin/src/`

## What To Build

1. Add Zod runtime schemas for each Core sync phase and parse each fetched page before processing.
2. Harden full-sync behavior in all phase runners:
   - track seen Core ids on non-incremental runs
   - soft-delete unseen `source='core'` rows after a successful full sync
   - abort that soft-delete path when the first full-sync page is empty
3. Wrap each page’s upsert work in a Prisma interactive transaction so page writes are atomic.
4. Replace GraphQL `InMemoryStore` with a Redis-backed rate limiter store using the existing Redis env and connection strategy.
5. Add or expand tests for:
   - runtime parse failures incrementing errors without aborting the phase
   - soft-delete on full sync
   - circuit-breaker abort when the first page is unexpectedly empty
   - GraphQL rate limiter wiring where practical without network dependency

## Constraints

- Keep this ticket headless: no dashboard or UI work.
- Do not introduce direct `process.env` reads outside existing env modules.
- Preserve the existing watermark semantics in `orchestrator.ts`: advance only on zero phase errors and keep fetch-start capture semantics.
- Do not overwrite `source='manager'` rows during sync.

## Verification

- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- Core sync phase tests cover parse errors, full-sync soft-delete, and circuit-breaker behavior.
- `apps/admin/src/graphql/plugins/rate-limit.ts` no longer uses `InMemoryStore`.
