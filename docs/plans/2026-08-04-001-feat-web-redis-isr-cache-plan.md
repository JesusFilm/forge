---
title: "feat: Add Redis-backed Web ISR cache"
type: feat
status: completed
date: 2026-08-04
---

# feat: Add Redis-backed Web ISR cache

## Overview

Move `@forge/web` self-hosted Next.js ISR/Data Cache storage from process-local deploy artifacts to a Redis-backed cache in production. The goal is to reduce crawler-triggered regeneration after deploys, especially for Googlebot/search crawling, while preserving local development, CI, and build behavior when Redis is absent.

## Problem Frame

Search bots request many cacheable watch URLs after deploys. Because the app is self-hosted on Railway and the ISR/Data Cache is process-local by default, deploys reset hot cache state and push expensive regeneration back onto production traffic. The production Railway Redis resource now exists as `@forge/web/redis`; the code must use the official Next cache handler path and the maintained `@fortedigital/nextjs-cache-handler` package rather than an in-house cache implementation.

## Requirements Trace

- R1. Use Next's supported `cacheHandler` integration for ISR/Data Cache persistence.
- R2. Use `@fortedigital/nextjs-cache-handler` rather than a custom Redis store.
- R3. Production runtime uses Redis when `REDIS_URL` exists.
- R4. Development, CI, build, no-Redis, and Redis-connect-failure paths continue to boot with a local fallback.
- R5. Build-time cache artifacts do not overwrite runtime-warmed Redis entries on deploy.
- R6. Railway production has a dedicated Redis resource named `@forge/web/redis` and `@forge/web` references it without direct worktree deploys.
- R7. The change ships through the normal PR-to-main Railway deploy path; no `railway up` or manual production code deploy from the worktree.

## Scope Boundaries

- Do not implement a custom Redis cache store.
- Do not prewarm the long-tail URL set during `next build`; current watch routes intentionally return empty `generateStaticParams()` and allow runtime ISR.
- Do not change watch route revalidation windows or admin webhook semantics.
- Do not trigger a production deployment directly from the local worktree.

### Deferred to Separate Tasks

- Post-deploy crawler prewarming for a bounded URL list: future task if Redis-backed runtime caching is insufficient.
- Observability around cache hit/miss rates: future task if runtime behavior needs more visibility than Next/Forte debug logs provide.

## Context & Research

### Relevant Code and Patterns

- `apps/web/next.config.mjs` exports `nextConfig` and is the correct place to install `cacheHandler` and disable the built-in memory cache for self-hosted production.
- `apps/web/src/instrumentation.ts` already handles Node-only startup hooks for Datadog and memory diagnostics; initial cache registration belongs in this same Node runtime guard.
- `apps/web/src/app/[locale]/[htmlLang]/**` routes use `revalidate = 3600`, `dynamic = "force-static"`, and empty `generateStaticParams()` for runtime ISR.
- `apps/web/scripts/prune-next-isr-output.mjs` intentionally prunes concrete ISR outputs after build, so build-time Redis writes are not the primary mechanism for this fix.
- `apps/web/railway.toml` defines the normal Railway build/start behavior but production deployment remains PR-to-main.

### Institutional Learnings

- `CLAUDE.md` and `AGENTS.md` require production code deploys to go through PR merge to `main`; direct `railway up` or manual redeploys are prohibited outside explicit break-glass.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` warns that opt-in env vars must not be required at schema-load/boot when absent. The cache handler must tolerate absent `REDIS_URL`.
- `apps/web/CLAUDE.md` documents the existing ISR route/data-cache relationship and `/api/revalidate` requirement to invalidate both route output and tagged resolver data.

### External References

- Next.js `cacheHandler` configuration docs describe the supported self-hosted cache handler integration.
- Next.js self-hosting caching docs recommend `cacheMaxMemorySize: 0` when configuring a shared cache handler.
- `@fortedigital/nextjs-cache-handler` documents Redis handlers and `registerInitialCache(..., { setOnlyIfNotExists: true })`.

## Key Technical Decisions

- Use `@fortedigital/nextjs-cache-handler` with its Redis strings handler: this follows the maintained package the user selected and avoids bespoke cache protocol code.
- Require only `REDIS_URL` for production Redis activation: Railway can provide a direct reference variable, and local/dev remains simple.
- Keep production build isolated from Redis: build-time concrete watch output is intentionally empty/pruned, and startup registration can seed remaining build artifacts without overwriting warmed runtime entries.
- Use local LRU fallback for dev/build/no Redis/connect failure: the site remains bootable and deployable even before every environment has Redis configured.
- Use `setOnlyIfNotExists` during instrumentation registration: deploy startup can populate missing initial entries without clobbering entries written by a live runtime.

## Open Questions

### Resolved During Planning

- Should the resource be named `@forge/web/redis`? Yes, per user request and Railway verification.
- Should production build write directly to Redis? No for this iteration; existing static params are empty and ISR output is pruned, so runtime caching is the meaningful path.

### Deferred to Implementation

- Exact Forte handler constructor requirements in tests: verify with focused smoke tests and package examples during implementation.
- Whether Railway dashboard config-as-code path is honored for `@forge/web`: verify operationally if a later deployment issue suggests dashboard config drift.

## Implementation Units

- [x] **Unit 1: Add maintained cache handler dependency and config**

**Goal:** Install and configure the maintained Next cache handler package for `@forge/web`.

**Requirements:** R1, R2, R3, R4

**Dependencies:** Railway Redis resource may exist before or after this unit; code must work without it.

**Files:**

- Create: `apps/web/cache-handler.mjs`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/web/src/lib/next-cache-handler.test.ts`

**Approach:**

- Configure Forte's `CacheHandler.onCreation` once per process.
- Use `redis` client with `REDIS_URL` only outside development and production build phase.
- Return Forte's LRU handler when Redis is absent or unavailable.
- Keep `NEXT_CACHE_REDIS_PREFIX` as the only optional cache-specific knob.

**Patterns to follow:**

- Forte production Redis example.
- Existing Web optional-env posture from `apps/web/.env.example` and `apps/web/CLAUDE.md`.

**Test scenarios:**

- Happy path: importing the cache handler with no `REDIS_URL` exposes the expected Next cache handler methods.
- Edge case: production build phase does not attempt Redis and still creates a handler.
- Error path: Redis connection failure falls back to local cache without throwing during handler creation.

**Verification:**

- Focused handler tests pass.
- Handler can be imported and instantiated from `apps/web`.

- [x] **Unit 2: Wire Next and startup registration**

**Goal:** Make Next use the custom handler and safely register build-time initial cache artifacts.

**Requirements:** R1, R4, R5

**Dependencies:** Unit 1.

**Files:**

- Modify: `apps/web/next.config.mjs`
- Modify: `apps/web/src/instrumentation.ts`
- Test: `apps/web/src/instrumentation.test.ts`
- Test: `apps/web/src/lib/next-cache-handler.test.ts`

**Approach:**

- Set `nextConfig.cacheHandler` to the repo-local handler path.
- Set `cacheMaxMemorySize: 0` for shared-cache self-hosting behavior.
- In Node-only instrumentation, dynamically import Forte's initial-cache registration and the cache handler.
- Use `setOnlyIfNotExists: true` to avoid overwriting Redis entries warmed by runtime requests.

**Patterns to follow:**

- Existing Node-only instrumentation guard in `apps/web/src/instrumentation.ts`.
- Next self-hosting caching guidance.

**Test scenarios:**

- Happy path: instrumentation registration still completes in the existing test harness.
- Error path: non-production registration failure logs a concise error and does not suppress Datadog/memory setup.
- Integration: importing `apps/web/next.config.mjs` reports the expected cache handler path and `cacheMaxMemorySize` value.

**Verification:**

- Focused lint and Vitest pass.
- Config import smoke check reports the cache handler path.

- [x] **Unit 3: Document environment and operational contract**

**Goal:** Make the Redis cache behavior clear for local developers and production operators.

**Requirements:** R3, R4, R6, R7

**Dependencies:** Units 1 and 2.

**Files:**

- Modify: `apps/web/.env.example`
- Modify: `apps/web/CLAUDE.md`

**Approach:**

- Document `REDIS_URL` and `NEXT_CACHE_REDIS_PREFIX`.
- State fallback behavior for local, CI, build, and no-Redis runs.
- State that production code deploys use the normal PR-to-main Railway path.

**Patterns to follow:**

- Existing Web env documentation style.
- Existing Railway deployment warning in root `AGENTS.md`.

**Test scenarios:**

- Test expectation: none -- documentation-only unit; validation is review for consistency with code.

**Verification:**

- Docs mention no removed host/port/password/TTL knobs.
- Docs match the handler's actual environment variable contract.

- [x] **Unit 4: Provision and verify Railway production Redis wiring**

**Goal:** Ensure production has a dedicated Redis resource and `@forge/web` has the correct reference variables without direct code deployment.

**Requirements:** R3, R6, R7

**Dependencies:** User authorization to mutate Railway production config.

**Files:**

- Modify: none

**Approach:**

- Create or verify Redis service `@forge/web/redis` in the `forge` project production environment.
- Set `@forge/web.REDIS_URL` as a Railway reference to `@forge/web/redis.REDIS_URL`.
- Set `@forge/web.NEXT_CACHE_REDIS_PREFIX=forge:web:next-cache`.
- Skip deploys when setting variables; allow the normal code deploy to pick them up.

**Patterns to follow:**

- Existing project service naming, e.g. `@forge/admin/redis`.
- Root deployment boundary forbidding direct worktree deploys.

**Test scenarios:**

- Integration: Railway service list includes both `@forge/web` and `@forge/web/redis`.
- Integration: `@forge/web` production variable list contains `REDIS_URL` and `NEXT_CACHE_REDIS_PREFIX`.
- Integration: Redis service deployment status is successful.

**Verification:**

- Railway reports Redis service status `SUCCESS`.
- `@forge/web` variable keys are present.
- No production deploy is triggered manually.

- [x] **Unit 5: Prepare normal release path**

**Goal:** Make the implementation ready for review and merge so Railway can deploy from `main`.

**Requirements:** R7

**Dependencies:** Units 1 through 4.

**Files:**

- Modify: code files from prior units only

**Approach:**

- Run focused lint/tests for touched Web files.
- Note that full `@forge/web` typecheck currently fails on unrelated generated GraphQL/package type issues if still present.
- Commit and open a PR if requested/available, rather than deploying directly.

**Patterns to follow:**

- Root deployment policy.
- Existing Web PR validation expectations.

**Test scenarios:**

- Integration: focused test suite covers cache handler and instrumentation.
- Error path: report unrelated typecheck failures rather than hiding them.

**Verification:**

- Working tree changes are reviewable.
- PR path is available for main merge and normal Railway deploy.

## System-Wide Impact

- **Interaction graph:** Next App Router uses `cacheHandler` for ISR/Data Cache; instrumentation registers initial cache entries; Railway provides `REDIS_URL`; admin revalidation continues to call Web's revalidation route and tags.
- **Error propagation:** Redis connection failures must degrade to process-local cache, not request failures or boot failures.
- **State lifecycle risks:** Runtime-warmed Redis entries survive deploys; `setOnlyIfNotExists` avoids deploy startup overwrites; stale entries remain governed by route/data revalidation semantics.
- **API surface parity:** No public route, GraphQL, or component API changes.
- **Integration coverage:** Package import, Next config import, instrumentation smoke tests, and Railway variable/service verification cover the cross-layer seams.
- **Unchanged invariants:** Route TTLs, `unstable_cache` tags, admin webhook behavior, and PR-to-main production deployment policy remain unchanged.

## Risks & Dependencies

| Risk                                            | Mitigation                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Redis unavailable at runtime                    | Handler falls back to local LRU; debug logging available via `NEXT_PRIVATE_DEBUG_CACHE`. |
| Cache entries overwritten during deploy startup | Use `registerInitialCache(..., { setOnlyIfNotExists: true })`.                           |
| Production env exists before code deploy        | Handler is absent until code ships; variables alone are inert.                           |
| Code deploy without Redis in some environment   | Missing `REDIS_URL` uses local fallback and does not block boot.                         |
| Direct production deploy from worktree          | Keep release to commit/PR/main; do not run `railway up` or manual redeploy.              |

## Documentation / Operational Notes

- Production Railway now has `@forge/web/redis` and `@forge/web` Redis variables configured with deploys skipped.
- After the code reaches `main` and Railway deploys normally, verify representative watch URLs by making repeated requests and checking origin load/logs rather than expecting build-time prewarm.
- If crawler pressure remains high, plan a bounded post-deploy warmer for top URLs rather than moving arbitrary build output writes into Redis.

## Sources & References

- Related code: `apps/web/cache-handler.mjs`
- Related code: `apps/web/next.config.mjs`
- Related code: `apps/web/src/instrumentation.ts`
- Related code: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- Related code: `apps/web/scripts/prune-next-isr-output.mjs`
- External docs: `https://nextjs.org/docs/app/api-reference/config/next-config-js/incrementalCacheHandlerPath`
- External docs: `https://nextjs.org/docs/app/guides/self-hosting#configuring-caching`
- External docs: `https://github.com/fortedigital/nextjs-cache-handler`
