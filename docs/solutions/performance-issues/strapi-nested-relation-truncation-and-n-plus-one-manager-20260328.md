---
module: Manager
date: 2026-03-28
problem_type: performance_issue
component: service_object
symptoms:
  - "GET /api/videos cold request takes ~4s due to nested GraphQL query"
  - "Strapi v5 GraphQL silently truncates nested relations to 10 items"
  - "Coverage dashboard shows 'none' for languages that actually have content"
  - "Cache miss blocks request with no stale-while-revalidate or deduplication"
root_cause: wrong_api
resolution_type: code_fix
severity: critical
tags:
  [
    graphql,
    strapi,
    n-plus-one,
    pagination,
    swr-cache,
    nested-relations,
    performance,
    correctness,
  ]
---

# Troubleshooting: Strapi v5 GraphQL Nested Relation Truncation and N+1 Query Performance

## Problem

The `/api/videos` endpoint in apps/manager took ~4s on cold requests due to a deeply nested GraphQL query. More critically, Strapi v5 GraphQL silently truncates nested relation results to **10 items** by default, causing incomplete coverage data for heavily-translated videos.

## Environment

- Module: Manager (apps/manager)
- Stack: Next.js 16+ App Router, Strapi v5 with GraphQL plugin, Apollo Client
- Affected Component: `apps/manager/src/app/api/videos/route.ts`
- Date: 2026-03-28

## Symptoms

- Cold dashboard load at `/dashboard/coverage` takes ~4s
- The `children` manyToMany self-relation accounts for ~2.5s of the ~4s
- Videos with >10 variants or subtitles show incorrect coverage status ("none" instead of "human"/"ai")
- Multiple simultaneous requests on cache expiry each independently query Strapi (thundering herd)
- No stale-while-revalidate — every cache miss blocks the request

## What Didn't Work

**Direct solution:** Root cause was identified through source code analysis of `@strapi/plugin-graphql@5.36.0` and `@strapi/utils@5.36.0`.

Key investigation finding: The REST API `maxLimit: 100` in `config/api.ts` does NOT apply to GraphQL. The GraphQL plugin has its own separate `maxLimit` (defaults to `-1`, unlimited). However, **nested relations without explicit pagination default to `limit: 10`** (hardcoded in `@strapi/utils/dist/pagination.js`).

## Solution

Three changes applied together:

### 1. Flatten the GraphQL query

Replaced nested `children { ... variants { ... } subtitles { ... } }` with a flat query. All videos fetched at top level with `parents { documentId }` for hierarchy reconstruction in application code.

```graphql
# Before (nested, ~4s, truncated at 10 items per relation):
videos_connection(pagination: { page: 1, pageSize: 5000 }) {
  nodes {
    documentId, coreId, title, label, slug, aiMetadata
    images { thumbnail, videoStill }
    children {
      documentId, coreId, title, label, slug, aiMetadata
      variants { coreId, source, aiGenerated, language { coreId } }
      subtitles { coreId, source, aiGenerated, language { coreId } }
    }
    variants { coreId, source, aiGenerated, language { coreId } }
    subtitles { coreId, source, aiGenerated, language { coreId } }
  }
}

# After (flat, ~1.5s, explicit unlimited pagination):
videos_connection(pagination: { page: 1, pageSize: 5000 }) {
  nodes {
    documentId, coreId, title, label, slug, aiMetadata
    images(pagination: { limit: -1 }) { thumbnail, videoStill }
    parents(pagination: { limit: -1 }) { documentId }
    variants(pagination: { limit: -1 }) { aiGenerated, language { coreId } }
    subtitles(pagination: { limit: -1 }) { aiGenerated, language { coreId } }
  }
}
```

Hierarchy reconstruction done in a single O(n) pass using a `parentChildrenMap`:

```typescript
const parentChildrenMap = new Map<string, RawVideoNode[]>()
for (const video of videoNodes) {
  for (const parent of video.parents ?? []) {
    let children = parentChildrenMap.get(parent.documentId)
    if (!children) {
      children = []
      parentChildrenMap.set(parent.documentId, children)
    }
    children.push(video)
  }
}
```

### 2. Shared SWR cache utility

Extracted a generic `createSwrCache<T>()` utility to `src/lib/swr-cache.ts` with:

- TTL-based staleness check
- Max-stale hard limit (blocks if data is too old)
- Promise deduplication (prevents thundering herd)
- Background refresh (stale data served immediately)
- Error handling (logs, re-throws, preserves stale data)
- `warm()` method for pre-deploy cache warming

### 3. Cache warming via Next.js instrumentation

`src/instrumentation.ts` fires a best-effort cache warm on server startup, eliminating cold-start penalty after Railway deploys.

## Why This Works

1. **Root cause — N+1 resolution**: Strapi v5's GraphQL plugin has no DataLoader-style batching. Each nested relation (children, variants, subtitles) fires a separate DB query per parent entity. With 1056 videos, the `children` self-join alone generates 1000+ queries.

2. **Root cause — silent truncation**: `@strapi/utils/dist/pagination.js` applies `STRAPI_DEFAULTS.offset.limit = 10` to any relation field without explicit pagination. This is separate from the REST `maxLimit` and the GraphQL `maxLimit`. Passing `pagination: { limit: -1 }` with the GraphQL plugin's default `maxLimit: -1` returns all items.

3. **Flat query eliminates both**: By querying all videos at the top level, each video's variants/subtitles are resolved as direct relations (not nested inside children), and the N+1 for the children self-join is eliminated entirely. The lightweight `parents { documentId }` field provides the data needed for O(n) hierarchy reconstruction.

4. **SWR cache eliminates user-visible latency**: Even with the flat query at ~1.5s, the stale-while-revalidate pattern means users almost never see loading times — stale data is served instantly while a background refresh runs.

## Prevention

- **Always pass explicit `pagination` on Strapi v5 GraphQL nested relations.** Without it, Strapi defaults to `limit: 10`. Use `pagination: { limit: -1 }` for server-to-server queries where you need all results.
- **Do not assume REST API limits apply to GraphQL.** The `config/api.ts` `maxLimit` only affects REST. The GraphQL plugin has its own `maxLimit` (default `-1`).
- **Avoid deeply nested GraphQL queries against Strapi.** Each nesting level multiplies the N+1 problem. Prefer flat queries with application-side joins.
- **Use the shared `createSwrCache` utility** for any API route that caches Strapi data. It handles TTL, max-stale, deduplication, and error cases correctly.
- **Check the `@strapi/utils/dist/pagination.js` source** when debugging unexpected data truncation — the defaults are hardcoded there, not in Strapi's config files.

## Related Issues

No related issues documented yet.
