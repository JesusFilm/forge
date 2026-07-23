---
id: "feat-304"
title: "Watch sitemap shard size limits"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "sitemap"
  - "observability"
---

## Problem

Watch child sitemaps are byte-aware but currently fill to a 45 MB default.
Twenty-one of the 22 production children are within roughly 17 KB of that
ceiling, leaving little headroom beneath the 50 MB search-engine limit as
canonical and reciprocal `hreflang` coverage grows (FGE-17).

## Entry Points - Read These First

1. `docs/plans/2026-07-23-002-fix-watch-sitemap-shard-limits-plan.md` -
   implementation decisions, verified baseline, and acceptance trace.
2. `apps/web/src/lib/watch-sitemap.ts` - serialized-byte partitioning and XML
   rendering.
3. `apps/web/src/lib/watch-sitemap.test.ts` - current chunk and alternate-set
   coverage.
4. `apps/web/src/app/sitemap.xml/route.ts` and
   `apps/web/src/app/sitemap/[id]/route.ts` - public index and child handlers.
5. `docs/solutions/performance-issues/watch-hreflang-sitemap-manifest-20260612.md`
   - sitemap ownership and revalidation constraints.

## Grep These

- `DEFAULT_MAX_SITEMAP_BYTES`
- `getWatchSitemapChunks`
- `renderWatchSitemapIndex`
- `renderWatchSitemapChunk`
- `watch_seo_manifest`

## What To Build

1. Cap every Watch child sitemap at 35,000,000 uncompressed UTF-8 bytes and
   fewer than 50,000 canonical entries.
2. Fail closed on duplicate canonicals, invalid limits, incomplete reciprocal
   alternate sets, or an unsplittable oversized entry.
3. Log structured generation failures and return controlled 503 responses.
4. Add a repeatable production/preview audit for HTTP, XML, size, counts,
   uniqueness, self-inclusion, reciprocity, and index coverage.
5. Record the production baseline, modeled repartition, and post-deploy
   Search Console and Bing verification procedure.

## Constraints

- Keep `/watch/sitemap.xml` and `/watch/sitemap/{id}.xml` stable while the child
  count changes.
- Preserve sitemap XML as the only Watch `hreflang` source of truth.
- Keep complete alternate sets on every canonical entry.
- Do not log sitemap payloads, canonical URLs, or alternate values.
- Do not add deployment-time network work to normal Watch page rendering.

## Verification

- Focused generator and route tests cover byte, URL, uniqueness, reciprocal
  alternate, index, 503, and structured-log behavior.
- The audit command passes against a deployed preview and canonical production.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
- Production follow-up records successful Google Search Console and Bing
  Webmaster Tools processing.

## Plan

Implementation plan:
`docs/plans/2026-07-23-002-fix-watch-sitemap-shard-limits-plan.md`
