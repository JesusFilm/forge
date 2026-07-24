---
id: "feat-310"
title: "Watch canonical-only sitemap routes"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-304"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "sitemap"
---

## Problem

FGE-44 found 51,772 contextual parent/child URLs in the production Watch
sitemaps. Those pages correctly canonicalize to standalone Video/language URLs,
which already appear separately, so the sitemap advertises duplicate route
identities.

## Entry Points - Read These First

1. `docs/plans/2026-07-24-002-fix-watch-canonical-sitemap-routes-plan.md`
2. `apps/web/src/lib/watch-sitemap.ts`
3. `apps/admin/src/services/watch-seo-manifest.service.ts`
4. `apps/web/src/lib/watch-sitemap-audit.ts`
5. `docs/roadmap/platform/feat-179-watch-contextual-video-canonical.md`

## Grep These

- `episodeRouteGroups`
- `createWatchSitemapGroups`
- `createWatchSitemapEntries`
- `WatchSitemapAuditSession`
- `watchEpisodePath`

## What To Build

1. Project Watch sitemap entries from canonical `videoRouteGroups` only.
2. Preserve contextual Watch routes for viewer navigation and metadata.
3. Enforce that every contextual child/language pair has a standalone
   canonical Video group before Admin publishes a manifest.
4. Detect contextual route leakage across every sitemap child and alternate.
5. Preserve FGE-17 byte, URL, uniqueness, graph, and controlled-failure limits.

## Constraints

- Keep `/watch/sitemap.xml` and `/watch/sitemap/{id}.xml` stable.
- Keep `episodeRouteGroups` in the Admin/Web manifest contract.
- Do not change contextual page routing or canonical metadata.
- Do not bypass the normal PR-to-main deployment flow.

## Verification

- Focused Admin and Web tests cover canonical completeness, multiple
  contextual parents, contextual-only manifests, reciprocal alternates, and
  complete-child leak detection.
- Existing contextual page-routing and navigation tests pass.
- The deployed preview audit reports no contextual sitemap route and samples
  at least one self-canonical page per shard.
- `pnpm --filter @forge/admin test -- watch-seo-manifest.service.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`

## Plan

Implementation plan:
`docs/plans/2026-07-24-002-fix-watch-canonical-sitemap-routes-plan.md`
