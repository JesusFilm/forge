---
id: "feat-334"
title: "Web Redis-backed ISR cache"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "infrastructure"
  - "railway"
  - "redis"
---

## Problem

Googlebot and other crawlers can trigger expensive `@forge/web` ISR/Data Cache regeneration after Railway deploys because the default self-hosted Next cache is process-local and deploy-local. Runtime cache entries need to survive deploys and be shared by web instances.

## Entry Points — Read These First

1. `apps/web/cache-handler.mjs` — Forte cache handler setup, Redis activation, and local fallback behavior.
2. `apps/web/next.config.mjs` — Next `cacheHandler` and `cacheMaxMemorySize` wiring.
3. `apps/web/src/instrumentation.ts` — initial cache registration with `setOnlyIfNotExists`.
4. `apps/web/CLAUDE.md` — operational notes for Web ISR/Data Cache and Redis env vars.
5. `docs/plans/2026-08-04-001-feat-web-redis-isr-cache-plan.md` — implementation plan and verification notes.

## Grep These

- `cacheHandler`
- `registerInitialCache`
- `NEXT_CACHE_REDIS_PREFIX`
- `REDIS_URL`
- `@fortedigital/nextjs-cache-handler`

## What To Build

- Install `@fortedigital/nextjs-cache-handler` and `redis` in `apps/web`.
- Configure `apps/web/cache-handler.mjs` to use Redis when `REDIS_URL` exists outside development and production build phase.
- Fall back to Forte's local LRU handler for development, CI/build, no Redis, and Redis connection failures.
- Wire `apps/web/next.config.mjs` with `cacheHandler` and `cacheMaxMemorySize: 0`.
- Register initial cache artifacts in `apps/web/src/instrumentation.ts` using `setOnlyIfNotExists`.
- Provision Railway production Redis service `@forge/web/redis` and reference its `REDIS_URL` from `@forge/web`.

## Constraints

- Do not use a custom Redis cache store.
- Do not write runtime cache entries to Redis from `next build` by default.
- Do not change watch route revalidation windows or admin webhook invalidation semantics.
- Do not deploy local worktree code directly to production; ship through PR merge to `main` and normal Railway autodeploy.

## Verification

- `pnpm --filter @forge/web exec vitest run src/lib/next-cache-handler.test.ts src/instrumentation.test.ts`
- `pnpm --filter @forge/web exec eslint cache-handler.mjs next.config.mjs src/lib/next-cache-handler.test.ts src/instrumentation.ts`
- `pnpm install --lockfile-only --offline --ignore-scripts`
- Import `apps/web/next.config.mjs` and verify `cacheHandler` points at `apps/web/cache-handler.mjs` and `cacheMaxMemorySize` is `0`.
- Import and instantiate `apps/web/cache-handler.mjs`.
- Verify Railway production has service `@forge/web/redis` and `@forge/web` variables `REDIS_URL` and `NEXT_CACHE_REDIS_PREFIX`.
