---
title: "Manager SWR cache needs failure backoff during upstream Strapi outages"
category: performance-issues
module: Manager
date: 2026-03-31
problem_type: performance_issue
component: tooling
symptoms:
  - "Every stale read after a failed refresh kicked off another upstream fetch attempt"
  - "A sustained Strapi outage could hammer the paginated /api/videos fetcher on every request"
  - "Background refresh failures could reject without an awaiting caller when stale data was served"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags:
  - manager
  - next-js
  - strapi
  - swr-cache
  - stale-while-revalidate
  - backoff
  - outage-handling
  - reliability
affected_components:
  - apps/manager/src/lib/swr-cache.ts
  - apps/manager/src/app/api/videos/route.ts
  - apps/manager/src/app/api/languages/route.ts
  - apps/manager/src/app/api/coverage-snapshots/route.ts
  - apps/manager/src/instrumentation.ts
related_docs:
  - docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md
  - docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md
  - docs/solutions/web/nextjs-headers-defeats-route-cache.md
---

# Manager SWR Cache Failure Backoff During Strapi Outages

## Problem

`apps/manager/src/lib/swr-cache.ts` deduplicated concurrent refreshes, but once a refresh failed it immediately cleared the shared promise and retained no cooldown state. During a real Strapi outage, every later request that touched a stale cache entry could start another expensive upstream refresh, especially for the paginated `videoCache` fetcher.

## Environment

- Module: Manager (`apps/manager`)
- Stack: Next.js App Router, server-side Strapi GraphQL, module-scoped SWR cache
- Affected component: `apps/manager/src/lib/swr-cache.ts`
- Date solved: 2026-03-31

## Symptoms

- Repeated requests during an upstream failure retried refresh work immediately instead of backing off
- The `videoCache` path could repeatedly re-enter a heavy `fetchAllPages()` GraphQL flow while Strapi was still down
- `languageCache` and the new latest coverage snapshot cache inherited the same retry pattern because they all shared `createSwrCache()`
- The newly added latest coverage snapshot cache would have inherited the same failure pattern
- In the stale-data path, a failed background refresh could reject without any caller awaiting it

## What Didn't Work

**Original cache design:** Promise deduplication alone was not enough.

- **Why it failed:** deduplication only helps when requests overlap in time. After the shared promise rejected and cleared, the next request started a brand new refresh immediately.

**Serving stale data without handling the refresh promise:** also was not enough.

- **Why it failed:** if the request returned cached data and did not await the refresh promise, a failed background refresh could surface as an unhandled rejection even though the error had already been logged.

## Solution

Add explicit failure-backoff state to the shared cache and suppress background-path rejections after logging.

### 1. Record the last refresh failure

Track:

- `lastFailureAt`
- `lastFailureMessage`
- configurable `failureBackoffMs` (default `30_000`)

### 2. Suppress retries during the cooldown window

When the cache is stale and the previous refresh failed recently:

- return stale cached data immediately if it is still within `maxStaleMs`
- throw a clear backoff error only when there is no usable cached value left

### 3. Swallow background refresh rejections in the stale-data path

If `get()` serves stale cached data and lets refresh continue in the background, attach a `.catch()` handler to avoid an unhandled rejection. Logging still happens in `doRefresh()`.

```ts
const inFailureBackoff =
  lastFailureAt > 0 && now - lastFailureAt < failureBackoffMs

if (inFailureBackoff) {
  if (!cached || isTooOld) {
    throw new Error(
      `[${label}] Refresh suppressed during failure backoff: ${lastFailureMessage ?? "upstream refresh recently failed"}`,
    )
  }
  return cached
}

const promise = refresh()

if (!cached || isTooOld) {
  await promise
} else {
  void promise.catch(() => {
    // Failure already logged in doRefresh()
  })
}
```

The helper now behaves like a lightweight circuit breaker for brief upstream outages:

- deduplicate concurrent refreshes
- record the most recent failure
- suppress repeat retries during the backoff window
- serve stale data when it is still within `maxStaleMs`
- fail fast when there is no safe cached value left

## Why This Works

1. The cache now distinguishes **"stale because TTL expired"** from **"stale and upstream is still failing"**.
2. Backoff prevents repeated re-entry into the expensive fetcher while the outage is still active.
3. Stale data remains available when it is still within `maxStaleMs`, so user-facing requests degrade more gracefully.
4. The background refresh path no longer leaks an unhandled promise rejection when stale data is served.

## Verification

- `pnpm --filter @forge/manager typecheck`
- `pnpm exec tsx -e ...` harness confirmed:
  - first stale read triggered one failed refresh
  - the next read inside the cooldown window reused stale data
  - fetch call count did not increase during backoff
- the same harness originally exposed the unhandled rejection risk in the fire-and-forget path, which was then fixed by attaching a background `.catch()`
- Local Manager smoke test confirmed the refreshed cache utility still served:
  - `GET /api/videos`
  - `GET /api/languages`
  - `GET /api/coverage-snapshots?latest=true`

## Prevention

- Any shared stale-while-revalidate cache should model three states explicitly: fresh, stale, and stale-after-failure.
- Deduplicating only concurrent calls is not sufficient for outage behavior. Add cooldown state whenever a refresh can fail repeatedly.
- If a request path intentionally does not await a background refresh, always attach a rejection handler.
- During incident review, watch for repeated log lines like `[video-cache] Background refresh failed:` on every request. Healthy backoff behavior should compress those into roughly one failure per backoff window.
- Re-check older documentation when extending a shared utility. The March 28 cache note correctly covered deduplication and stale serving, but it overstated error handling completeness before this follow-up fix.

## Related Documentation

- [Strapi nested relation truncation and N+1 manager performance fix](./strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md)
- [Manager coverage dashboard review regression cleanup](../integration-issues/manager-coverage-dashboard-review-regression-cleanup.md)
- [Next.js headers() in page routes silently defeats Full Route Cache](../web/nextjs-headers-defeats-route-cache.md)
