---
id: "feat-250"
title: "Watch language inventory query performance"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-13"
duration: 1
depends_on:
  - "feat-192"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "performance"
  - "postgres"
---

## Problem

Large-language Watch inventory routes fail during server rendering because
Admin's `watchLanguageInventory` SQL exceeds its 10 second statement timeout.
Production probes for Spanish and English return a plain 500 after about 20
seconds, while the direct Admin GraphQL query fails after about 10.2 seconds
even with `limit: 1`. The current SQL builds locale and image selections across
the published catalog, computes every bucket row and window count, and applies
the per-bucket limit only at the end.

## Entry Points - Read These First

1. `docs/plans/2026-07-13-003-perf-watch-language-inventory-sql-plan.md` -
   implementation plan and performance contract.
2. `apps/admin/src/services/video.service.ts` - current inventory SQL and
   timeout boundary.
3. `apps/admin/src/services/video.service.test.ts` - result mapping and SQL
   invariant coverage.
4. `apps/admin/prisma/migrations/0035_watch_video_query_indexes/migration.sql` -
   existing Watch query index conventions.
5. `docs/solutions/performance-issues/admin-semantic-db-retrieval-visible-candidate-window.md` -
   bounded-survivor hydration pattern.

## What To Build

1. Add partial indexes that support language-first playable dub and subtitle
   candidate scans.
2. Rewrite `watchLanguageInventory` to derive compact language-specific
   candidates before localized metadata and image hydration.
3. Preserve audio collection, audio video, subtitle-only, counts, promoted
   ordering, fallback audio language, and per-bucket cap semantics.
4. Keep the existing GraphQL contract and 10 second SQL timeout unchanged.
5. Add SQL topology assertions and focused service tests that prevent
   corpus-wide enrichment from moving ahead of the candidate bound again.

## Constraints

- Do not solve the failure by increasing the statement or Web request timeout.
- Do not fetch full dub graphs or change public Watch URL shapes.
- Do not change the Admin GraphQL schema or generated GraphQL artifacts.
- Keep migrations forward-only and compatible with normal Admin deployment.
- Preserve safe empty inventory behavior for unknown language slugs.

## Verification

- `pnpm --filter @forge/admin test -- src/services/video.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint -- src/services/video.service.ts src/services/video.service.test.ts`
- `DATABASE_URL=postgresql://forge:forge@localhost:5432/forge_admin pnpm --filter @forge/admin exec prisma validate`
- Browser smoke for `/watch/spanish-latin-american.html/videos` against the
  implementation environment, including a screenshot and page-load timing.
- Post-deploy direct Admin and Watch canaries for Spanish and English: no
  timeout, stable bucket/count behavior, and an Admin response target below 2
  seconds warm and 5 seconds cold.

## Completion Note - 2026-07-13

Admin now discovers playable dubs and usable subtitles from the requested
language, aggregates audio/subtitle membership once per candidate video, and
bounds each bucket before card-image, parent, child-count, and fallback-audio
hydration. Language-leading partial indexes support the new discovery direction
without replacing the existing video-leading Watch indexes.

An isolated PostgreSQL 17 database applied all 47 migrations and returned the
expected collection, audio-video, and subtitle-only shapes. A 25,000-video
stress fixture completed the guarded service call in 204-243 ms, and focused
Admin tests, the full Admin suite, lint, typecheck, and Prisma validation passed.
The populated local Spanish route returned HTTP 200 in 90-307 ms across warm
requests; the direct GraphQL resolver returned in 26 ms, and browser proof
showed both Spanish inventory cards with no console warnings or errors.

The normal Admin-to-Web deployment reached production at `f0a04a6d` through
PR #1548. Direct Admin canaries returned the unchanged English inventory
(1,092 total: 109 collections and 983 audio videos) in 623-668 ms and Spanish
inventory (689 total: 62 collections, 625 audio videos, and 2 subtitle-only
videos) in 520-644 ms. The first uncached `/watch/videos` request returned HTTP
200 in 7.85 seconds with the expected `/watch/en/en/videos` rewrite; three
repeat requests returned HTTP 200 in 1.03-1.48 seconds. A bounded production-log
check found no subsequent PostgreSQL `57014` statement timeout, and neither the
Admin canaries nor the Watch route reproduced the GraphQL error or Web 500.
An isolated production browser session rendered the English page in 1.24
seconds and the Spanish page in 7.31 seconds cold / 514 ms warm. Both pages
showed the expected inventory headings and section counts with no browser
console or page errors. Visual proof is captured locally at
`output/playwright/watch-videos-production-restored.png`.
