---
title: "fix: Optimize Videos GraphQL Query Performance"
type: fix
status: completed
date: 2026-03-28
deepened: 2026-03-28
---

# fix: Optimize Videos GraphQL Query Performance

## Enhancement Summary

**Deepened on:** 2026-03-28
**Research agents used:** Performance Oracle, Architecture Strategist, TypeScript Reviewer, Code Simplicity Reviewer, Pattern Recognition Specialist, Security Sentinel, Strapi v5 Docs Researcher, SWR Best Practices Researcher

### Key Improvements

1. **Correctness bug discovered**: Strapi v5 GraphQL defaults nested relation limit to **10** (not 100). The current nested query silently truncates variants/subtitles for any video with >10 of either. This elevates the query flattening from performance optimization to **correctness fix**.
2. **Error handling added**: The original cache code had an unsafe non-null assertion and swallowed errors. Fixed with proper error propagation and null-safety.
3. **TTL reduced to 120s**: Architecture review determined 5 minutes is too long for actively-edited content; 120s with SWR is the right balance.
4. **Cache warming via instrumentation**: Fire-and-forget warm on startup eliminates cold-start penalty after Railway deploys.
5. **Shared SWR utility**: Extract cache pattern to `src/lib/swr-cache.ts` to eliminate duplication with the languages route.

### New Considerations Discovered

- The `coreId` field on variants/subtitles is also unused (not just `source`) — trim both
- Strapi v5 GraphQL `maxLimit` is `-1` (unlimited), separate from REST `maxLimit: 100` — `pageSize: 5000` works fine
- Module-scoped cache is correct for Railway's single-instance deployment model — document assumption
- Add `MAX_STALE_MS` hard limit (30 min) to prevent serving arbitrarily old data if Strapi is down

---

## Overview

The `GET /api/videos` endpoint in `apps/manager` takes ~4s on cold requests due to a deeply nested Strapi v5 GraphQL query. The `children` manyToMany self-relation is the dominant cost (~2.5s of ~4s), triggering N+1-style resolution for 1056 videos. A 60-second in-memory cache mitigates repeat loads but blocks on every cache miss with no deduplication of concurrent fetches.

This plan combines two approaches: **flatten the query** (eliminate nested `children` relation) and **stale-while-revalidate caching** (copy the proven pattern from the languages route).

## Problem Statement / Motivation

- Cold dashboard load takes ~4s, degrading developer/editor experience
- Cache miss blocks the request — no stale-while-revalidate, no concurrent deduplication
- Multiple simultaneous requests on cache expiry each independently query Strapi (thundering herd)
- **[CRITICAL — confirmed via source analysis]** Strapi v5 GraphQL applies a default limit of **10** to nested relation fields when no pagination argument is provided. The current query fetches `children { variants { ... } subtitles { ... } }` without explicit pagination on the nested relations, meaning any child video with >10 variants or >10 subtitles returns **silently truncated data**. This is an active correctness bug causing incomplete coverage reporting.
- On Railway redeployment, cache is evicted and the first request always pays the full ~4s cost

### Research Insights

**Strapi v5 GraphQL pagination (confirmed from `@strapi/plugin-graphql@5.36.0` source):**

- REST `maxLimit: 100` in `config/api.ts` does **NOT** apply to GraphQL
- GraphQL plugin `maxLimit` defaults to `-1` (unlimited) — `pageSize: 5000` works fine
- Nested relations without explicit `pagination` argument default to `limit: 10` (hardcoded in `@strapi/utils/dist/pagination.js`)
- No DataLoader-style batching exists — each nested relation fires a separate DB query per parent entity (N+1)

**References:**

- `@strapi/plugin-graphql@5.36.0` default config: `maxLimit: -1`
- `@strapi/utils/dist/pagination.js` line 42-49: `STRAPI_DEFAULTS.offset.limit = 10`
- `apps/cms/config/plugins.ts`: no `maxLimit` override for GraphQL

## Proposed Solution

### Phase 1: Flatten the GraphQL Query

Replace the nested `children { ... variants { ... } subtitles { ... } }` query with a flat query that fetches ALL videos at the top level, including a `parents { documentId }` field for hierarchy reconstruction.

**This is both a performance optimization AND a correctness fix** — the flat query eliminates nested relation truncation because variants/subtitles are fetched per top-level video (subject to the top-level default of 10, which must also be overridden — see query below).

**Current query** (nested, ~4s, **silently truncated at 10 items per nested relation**):

```graphql
videos_connection(pagination: { page: 1, pageSize: 5000 }) {
  nodes {
    documentId, coreId, title, label, slug, aiMetadata
    images { thumbnail, videoStill }
    children {                          # <-- 2.5s cost, also capped at 10 children
      documentId, coreId, title, label, slug, aiMetadata
      images { thumbnail, videoStill }
      variants { coreId, aiGenerated, language { coreId } }    # capped at 10!
      subtitles { coreId, aiGenerated, language { coreId } }   # capped at 10!
    }
    variants { coreId, aiGenerated, language { coreId } }      # capped at 10!
    subtitles { coreId, aiGenerated, language { coreId } }     # capped at 10!
  }
}
```

**Proposed query** (flat, expected ~1.5s, explicit pagination to avoid truncation):

```graphql
videos_connection(pagination: { page: 1, pageSize: 5000 }) {
  nodes {
    documentId, coreId, title, label, slug, aiMetadata
    images(pagination: { limit: -1 }) { thumbnail, videoStill }
    parents(pagination: { limit: -1 }) { documentId }
    variants(pagination: { limit: -1 }) { aiGenerated, language { coreId } }
    subtitles(pagination: { limit: -1 }) { aiGenerated, language { coreId } }
  }
  pageInfo { page, pageCount, pageSize, total }
}
```

### Research Insights (Phase 1)

**Why `pagination: { limit: -1 }` on nested relations:**
Strapi v5 GraphQL defaults nested relations to `limit: 10`. Passing `limit: -1` with `maxLimit: -1` (the GraphQL plugin default) returns all items. This is safe because the GraphQL plugin's `maxLimit` is unlimited in this project's config.

**Correctness impact:**

- The JESUS film has translations in 2,000+ languages. If each translation has a variant, the current query truncates to 10 variants per video — coverage reports show "none" for languages that actually have content.
- This makes the query flattening a **P1 correctness fix**, not just a P2 performance optimization.

**Field trimming (also apply here):**

- Remove `source` from variants/subtitles — unused in `determineCoverageForItems()`
- Remove `coreId` from variants/subtitles — also unused in coverage computation or `toVideoItem()`
- Only `aiGenerated` and `language { coreId }` are needed for coverage

**Hierarchy reconstruction in application code:**

```typescript
// apps/manager/src/app/api/videos/route.ts

// Note: Reuse existing RawVideoNode type name (not FlatVideoNode)
// since the flat query fully replaces the nested one

function buildCollections(
  videos: RawVideoNode[],
  selectedLanguageIds: string[],
) {
  const videoMap = new Map(videos.map((v) => [v.documentId, v]))

  // Build parent -> children mapping from child's parents field
  const parentChildrenMap = new Map<string, RawVideoNode[]>()
  for (const video of videos) {
    for (const parent of video.parents) {
      let children = parentChildrenMap.get(parent.documentId)
      if (!children) {
        children = []
        parentChildrenMap.set(parent.documentId, children)
      }
      children.push(video)
    }
  }

  const collections: CmsCollection[] = []
  for (const [parentDocId, children] of parentChildrenMap) {
    const parent = videoMap.get(parentDocId)
    if (!parent) continue
    collections.push({
      ...formatVideo(parent, selectedLanguageIds),
      children: children.map((c) => formatVideo(c, selectedLanguageIds)),
    })
  }

  // Standalone: no parents AND not a parent of anything
  const standalone = videos.filter(
    (v) => v.parents.length === 0 && !parentChildrenMap.has(v.documentId),
  )
  if (standalone.length > 0) {
    collections.push({
      title: "Standalone Videos",
      children: standalone.map((c) => formatVideo(c, selectedLanguageIds)),
    })
  }

  return collections
}
```

**Changes from original plan based on reviews:**

- Removed dead `childDocIds` Set (computed but never used)
- Added explicit `CmsCollection[]` type annotation (avoids `any[]` inference)
- Used single-check Map pattern instead of redundant `.set()` on every push
- Reuse `RawVideoNode` type name instead of introducing `FlatVideoNode` (the flat query replaces the nested one entirely)

**Key edge cases to handle:**

- Video with multiple parents → appears in each parent's collection (preserves current behavior)
- Video that is both a parent and a child → becomes a collection AND appears in its parent's collection
- Video with no parents and no children → goes to "Standalone Videos"
- Video whose parent is not in the dataset (unpublished/filtered) → treat as standalone

### Phase 2: Stale-While-Revalidate Cache

Extract a shared SWR cache utility and use it in both the videos and languages routes.

**New file: `apps/manager/src/lib/swr-cache.ts`**

```typescript
type SwrCacheOptions<T> = {
  fetcher: () => Promise<T>
  ttlMs: number
  maxStaleMs: number
  label: string
}

export function createSwrCache<T>({
  fetcher,
  ttlMs,
  maxStaleMs,
  label,
}: SwrCacheOptions<T>) {
  // Single-instance assumption: Railway deploys a single Node.js process.
  // If horizontal scaling is added, move to Redis or Railway KV.
  let cached: T | null = null
  let cachedAt = 0
  let refreshPromise: Promise<void> | null = null

  async function doRefresh(): Promise<void> {
    try {
      cached = await fetcher()
      cachedAt = Date.now()
    } catch (error) {
      console.error(`[${label}] Background refresh failed:`, error)
      // Stale data preserved — do not update cachedAt so next request retries
      throw error
    }
  }

  function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  return {
    async get(): Promise<T> {
      const now = Date.now()
      const age = now - cachedAt
      const isStale = !cached || age >= ttlMs
      const isTooOld = age >= maxStaleMs

      if (isStale) {
        // Deduplicate concurrent refreshes via shared promise
        const promise = refresh()

        // Block if: no cached data yet, OR data exceeds max-stale limit
        if (!cached || isTooOld) {
          await promise
        }
        // Otherwise: return stale data, refresh runs in background
      }

      if (!cached) {
        throw new Error(
          `[${label}] Cache is empty after refresh — upstream may be down`,
        )
      }

      return cached
    },
  }
}
```

**Usage in videos route:**

```typescript
// apps/manager/src/app/api/videos/route.ts
import { createSwrCache } from "@/lib/swr-cache"

const videoCache = createSwrCache({
  fetcher: () => fetchAllPages(/* flat query */),
  ttlMs: 2 * 60_000, // 2 minutes — actively edited content
  maxStaleMs: 30 * 60_000, // 30 minutes — hard limit, block and retry
  label: "video-cache",
})

// In GET handler:
const videoNodes = await videoCache.get()
```

### Research Insights (Phase 2)

**TTL choice (120s, not 300s):**
Architecture review determined that 5 minutes is too long for a content management dashboard where editors actively modify video metadata, subtitles, and variants. The performance benefit of SWR comes from the stale-serve pattern and promise deduplication, not from TTL length. 120s provides freshness while still eliminating most cold loads.

**Max-stale limit (30 min):**
Without a max-stale limit, the cache could serve arbitrarily old data if Strapi is down for hours. A 30-minute hard limit forces blocking requests when data is too old, surfacing upstream failures rather than hiding them.

**Error handling improvements:**

- The `.catch()` handler logs and re-throws so callers awaiting the promise see the failure
- After `await`, a null check throws explicitly instead of using an unsafe `!` assertion
- On error, `cachedAt` is not updated, so the next request immediately retries

**Cache warming via Next.js instrumentation:**
Add fire-and-forget cache warm on server startup to eliminate cold-start penalty after Railway deploys:

```typescript
// apps/manager/src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Warm caches before first request arrives
    // Railway rolling deploys give us a few seconds before traffic routes here
    import("./lib/cache-warmers").then(({ warmCaches }) => {
      void warmCaches()
    })
  }
}
```

**Module-scoped cache is correct for Railway:**
Railway deploys a single `node apps/manager/.next/standalone/apps/manager/server.js` process (confirmed in `railway.toml`). Module-scoped variables persist across requests for the process lifetime. Next.js App Router Route Handlers are NOT serverless — they are long-lived modules in the Node.js runtime.

**References:**

- Next.js 16.2.1 docs: "in-memory cache is isolated to each Next.js process"
- `apps/manager/railway.toml`: single-process deployment
- `apps/manager/src/app/api/languages/route.ts:200-212`: existing SWR + dedup pattern
- `docs/solutions/web/nextjs16-cachecomponents-isr.md`: Apollo is opaque to Next.js cache — manual caching is correct

### Phase 3: Trim Unused Fields

Remove `source` AND `coreId` from variants and subtitles in the GraphQL query. Both verified unused:

- `determineCoverageForItems()` only reads `language.coreId` and `aiGenerated`
- `toVideoItem()` does not reference variant/subtitle `coreId` or `source`
- Client-side `CmsVideo` type does not include either field

### Research Insights (Phase 3)

**Simplicity review assessment:** This phase is the lowest-impact change. Removing two scalar fields from a query that fetches 1056 videos with nested relations produces negligible latency improvement. However, it reduces the response payload and makes the query's intent clearer (only fetch what coverage needs). Worth doing as part of the query rewrite, but should not be a separate phase — fold it into Phase 1's query changes.

## Technical Considerations

- **Architecture**: No schema changes needed. The `parents` relation already exists on the Video content type (`mappedBy: "children"`, bidirectional manyToMany). Only the query and application-layer grouping logic change.
- **Performance**: Expected cold request time: ~1.5s (down from ~4s). With SWR cache, users almost never see cold loads after initial deploy. Cache warming further reduces the window.
- **Correctness**: The current nested query truncates nested relations at 10 items (Strapi v5 GraphQL default). The flat query with `pagination: { limit: -1 }` returns all items. This fixes silent data loss for heavily-translated videos.
- **API contract**: The response shape `{ collections: CmsCollection[] }` remains identical. This is a transparent backend optimization. The frontend `CmsCollection` / `CmsVideo` types at `coverage-report-client.tsx` are unchanged.
- **Single-instance assumption**: Module-scoped cache is correct for Railway's deployment model. If horizontal scaling is ever added, the SWR utility should be migrated to Redis or Railway KV.

### Research Insights (Technical)

**No memoization needed for `formatVideo`:**
Pattern analysis confirmed the coverage computation is O(n \* m) where n=videos, m=variants per video. At 1056 videos with ~10 media items each, this is ~10K iterations — microseconds. Multi-parent duplication (same video in multiple collections) is rare and the computation is request-scoped. Memoization adds complexity for no measurable gain.

**Strapi v5 manyToMany from inverse side is safe:**
The `parents` relation (`mappedBy: "children"`) reads from the same join table as `children` but in reverse. There is no asymmetry in query complexity. `parents { documentId }` only fetches scalar fields, so no recursive resolution occurs.

## Acceptance Criteria

- [ ] Cold `/api/videos` request completes in under 2 seconds
- [ ] Cached requests remain under 100ms
- [ ] Stale-while-revalidate: stale data returned immediately on cache expiry, background refresh runs
- [ ] Concurrent requests during cache refresh are deduplicated (single Strapi query, not thundering herd)
- [ ] Max-stale limit: requests block and retry if cached data exceeds 30 minutes old
- [ ] Background refresh errors are logged and do not crash the process
- [ ] No regression in collection grouping (109 collections, 1056 videos)
- [ ] Videos with multiple parents appear in each parent's collection (preserves current behavior)
- [ ] Videos that are both parents and children are handled correctly (collection header + child entry)
- [ ] Coverage status (subtitles/audio/meta) is accurate — specifically, videos with >10 variants/subtitles now return complete data (correctness fix)
- [ ] Response JSON shape is identical to current format (no frontend changes needed)
- [ ] `source` and `coreId` field removal from variants/subtitles does not break any consumer
- [ ] SWR cache utility is shared between videos and languages routes (no duplication)

## Success Metrics

| Metric                     | Before              | Target                |
| -------------------------- | ------------------- | --------------------- |
| Cold request               | ~4.0s               | <2.0s                 |
| Cache hit                  | ~60ms               | <100ms                |
| Cache miss (SWR)           | ~4.0s (blocking)    | <100ms (stale served) |
| Concurrent miss queries    | N (thundering herd) | 1 (deduplicated)      |
| Cache TTL                  | 60s                 | 120s                  |
| Max stale window           | Unlimited           | 30min                 |
| Nested relation truncation | Silent at 10 items  | All items returned    |

## Dependencies & Risks

- **Low risk**: The `parents` relation exists in the schema and is the inverse of `children`. No Strapi schema migration needed.
- **Low risk (confirmed)**: `pageSize: 5000` is not capped by the GraphQL plugin (`maxLimit: -1`). The full dataset of 1056 videos fits in a single page.
- **Low risk**: `parents` typically has 0-2 entries per video. Even with `pagination: { limit: -1 }`, the data volume is trivial.
- **Low risk**: `source` and `coreId` field removal verified safe against all consumers (coverage computation, `toVideoItem`, client-side `CmsVideo` type).
- **Medium risk**: Verify that `parents` relation is exposed in the GraphQL schema (it should be since `mappedBy` relations are included by default in Strapi v5 GraphQL, but validate before implementing).

## Validation Steps (Pre-Implementation)

Before implementing, run these quick validation queries against local Strapi to confirm assumptions:

1. **Verify `parents` relation works in GraphQL**: Query a known child video and confirm `parents(pagination: { limit: -1 }) { documentId }` returns the expected parent(s).
2. **Confirm nested relation truncation**: Query a video known to have many variants WITHOUT explicit pagination. Expect only 10 results. Then query WITH `pagination: { limit: -1 }` and compare counts. This proves the correctness bug exists.
3. **Confirm pageSize: 5000 returns full dataset**: Check that `fetchAllPages` loops exactly once for 1056 videos.
4. **Benchmark the flat query**: Run the proposed query and compare timing against the current nested query. Expect ~1.5s vs ~4s.

## Affected Files

- `apps/manager/src/app/api/videos/route.ts` — Query, cache, and grouping logic (primary)
- `apps/manager/src/lib/swr-cache.ts` — **New file**: shared SWR cache utility
- `apps/manager/src/instrumentation.ts` — **New or modify**: cache warming on startup
- `apps/manager/src/app/api/languages/route.ts` — Refactor to use shared SWR utility (follow-up)
- `apps/manager/src/cms/strapi-pagination.ts` — Pagination helper (read-only reference)

## Security Considerations

**From security audit — no blocking issues:**

- Cached data is shared across all authenticated requests. All Manager-role users see the same video catalog, so this is correct. If per-user data scoping is ever needed, the cache must be partitioned.
- No auth bypass: authentication runs before cache access on every request.
- No data leakage: `documentId` is used internally for hierarchy reconstruction but not exposed in the response.
- `STRAPI_API_TOKEN` in module scope is standard Next.js server-side pattern, never exposed to client.
- `languageIds` query param is safe — only used for Set membership checks, never interpolated into queries.

## Sources & References

- **Todo**: `todos/001-pending-p2-optimize-videos-graphql-query.md` — original investigation with benchmarks
- **SWR pattern**: `apps/manager/src/app/api/languages/route.ts:200-212` — proven stale-while-revalidate implementation
- **Video schema**: `apps/cms/src/api/video/content-types/video/schema.json:114-135` — children/parents manyToMany self-relation
- **Coverage logic**: `apps/manager/src/app/api/videos/route.ts:131-170` — determineCoverage functions
- **Strapi plugin source**: `@strapi/plugin-graphql@5.36.0` default-config.js — `maxLimit: -1`
- **Strapi utils source**: `@strapi/utils@5.36.0` pagination.js — `STRAPI_DEFAULTS.offset.limit = 10`
- **Learnings**: `docs/solutions/web/nextjs16-cachecomponents-isr.md` — Apollo is opaque to Next.js cache
- **Learnings**: `docs/solutions/platform/videoforge-manager-integration.md` — manager architecture reference
- **Learnings**: `docs/solutions/graphql/server-side-strapi-queries-nextjs.md` — always use `fetchPolicy: "no-cache"` server-side
- **Next.js 16.2.1 docs**: Self-hosting guide — module-scoped cache is per-process, `register()` for startup hooks
