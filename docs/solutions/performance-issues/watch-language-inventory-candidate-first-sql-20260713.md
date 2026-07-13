---
title: "Watch language inventory candidate-first SQL"
date: "2026-07-13"
category: "performance-issues"
module: "apps/admin"
problem_type: "performance_issue"
component: "service_object"
symptoms:
  - "Large-language Watch inventory routes returned a server-render 500 after about 20 seconds"
  - "Direct Admin watchLanguageInventory queries hit PostgreSQL's 10 second statement timeout even with limit 1"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
tags:
  - "watch"
  - "language-inventory"
  - "postgres"
  - "prisma"
  - "partial-index"
  - "candidate-first"
---

# Watch Language Inventory Candidate-First SQL

## Problem

`watchLanguageInventory` powered the public single-language page, but its SQL
did expensive display work before the per-bucket limit could protect it. The
query selected published locales and images across the catalog, constructed all
three inventory buckets, counted and ranked them, and only then retained up to
1,000 rows per bucket.

Production probes made the boundary clear:

- Direct Admin GraphQL failed after about 10.2 seconds with an unexpected-error
  response, matching the query's 10 second PostgreSQL statement timeout.
- The Spanish and English Watch routes returned a plain 500 after about 20
  seconds because metadata and page rendering could each trigger the failing
  inventory read.
- Lower-volume languages could render, which pointed to data volume rather than
  a route-rewrite or GraphQL-contract failure.

## Root Cause

The query began with videos and display metadata even though its selective input
was a language. Existing Watch indexes also began with `video_id`, which is
appropriate for a single-video route but not for discovering every playable
video in one language.

A first candidate-first rewrite exposed a second planner trap during a 25,000-
video stress test. Subtitle-only classification used `NOT EXISTS` against a
materialized playable-audio CTE. PostgreSQL chose a nested-loop anti-join and
rescanned roughly 1,000 audio rows for each of roughly 25,000 candidates. The
query still exceeded the 10 second guard in the cold synthetic run.

## Solution

The final SQL is a staged candidate pipeline:

1. Resolve playable dubs and usable subtitles from `language_id`.
2. Aggregate those sources once per video into `hasAudio` and `hasSubtitle`
   flags. Subtitle-only classification is now a field check, not a CTE rescan.
3. Apply published and indexable video eligibility to that compact candidate
   set.
4. Build collection, audio-video, and subtitle-only candidate rows without
   images or parent-card metadata.
5. Count every eligible row, then pre-limit each bucket by recency while
   retaining the complete boundary-tie group. This preserves the existing
   localized-title tie ordering without localizing the entire bucket.
6. Select the localized ordering title only for that recency-bounded superset,
   apply the exact title/id tie order, and retain the requested page size.
7. Hydrate images, parent metadata, child counts, and fallback audio only for
   final survivors.

Two forward-only partial indexes support the discovery direction:

- `video_dub_watch_inventory_language_idx` leads with `language_id`, follows
  the distinct-video order, and includes `video_edition_id`.
- `video_subtitle_watch_inventory_language_idx` leads with `language_id` and
  covers the direct-video and edition-linked candidate identifiers.

The existing video-leading Watch indexes remain in place for individual video
routes. The GraphQL schema, response DTO, public URL shape, 10 second statement
timeout, and 1,000-item per-bucket contract are unchanged.

## Validation

An isolated PostgreSQL 17 instance applied the complete 47-migration history,
including the new migration. A relational fixture returned the expected one
collection, two Spanish-audio videos, and one Spanish-subtitle-only video with
an English fallback dub.

The larger stress fixture contained 25,000 videos plus 100 duplicate usable
subtitle rows on one edition. It produced 25,004 eligible bucket rows, of which
2,001 were returned after per-bucket caps. Three guarded service executions
completed in:

| Run  | Service duration |
| ---- | ---------------: |
| Cold |         243.0 ms |
| Warm |         204.2 ms |
| Warm |         209.1 ms |

`EXPLAIN (ANALYZE, BUFFERS)` reported 223.5 ms execution time. On this uniform
synthetic distribution PostgreSQL preferred existing generic/video-leading
indexes; the new partial indexes remained available for production's different
playability and subtitle-usability selectivity. Their actual production use is
part of the post-deploy plan check. Before replacing the materialized-CTE anti-
join with per-video flags, the same fixture took roughly 2-3 seconds after
statistics settled and could exceed 10 seconds with a cold stale plan.

Admin validation also passed:

- 3,887 tests passed; 2 database-gated tests were skipped; 1 existing test was
  marked todo.
- ESLint passed.
- TypeScript typecheck passed.
- Prisma validated and the full migration chain applied from an empty database.

The populated local Web route
`/watch/spanish-latin-american.html/videos` returned HTTP 200 in 90-307 ms
across three warm requests. Its direct Admin resolver returned one audio
collection and one audio video in 26 ms. Browser verification showed the
Spanish inventory heading plus the `Easter Explained` and
`La Colección de Jesús` cards, with no browser console warnings or errors.
Visual proof is captured at
`output/playwright/watch-spanish-language-inventory-sql-cards.png` in the local
worktree; the ignored proof artifact is not part of the production bundle.

## Prevention

- Start inventory and faceted-discovery queries from the selective dimension,
  not from the entity table that owns display metadata.
- Do not assume a CTE referenced by `NOT EXISTS` becomes an indexed membership
  check. Verify the real plan; materialized CTE anti-joins can become repeated
  scans.
- Carry compact source flags through candidate aggregation when later buckets
  need set-membership decisions.
- If a display field participates in final ordering, pre-limit by the preceding
  order keys and retain the entire cutoff tie group before loading that field.
- Keep raw-SQL topology tests for stage ordering, but pair them with a real
  PostgreSQL execution and `EXPLAIN`; mocked template tests cannot reveal
  planner behavior.

## Post-Deploy Validation

After the normal Admin-to-Web deployment reaches production:

1. Run direct Admin `watchLanguageInventory` canaries for Spanish and English
   at `limit: 1` and `limit: 1000`.
2. Load the public Spanish and English inventory routes twice to cover cold and
   warm server rendering.
3. Confirm no PostgreSQL `57014` statement timeout, Prisma `P2010`, GraphQL
   unexpected-error response, or Web 500 appears in Admin/Web logs.
4. Treat warm Admin latency above 2 seconds, cold latency above 5 seconds, or a
   changed bucket/count/fallback shape as a rollback or immediate-fix trigger.

## Related

- `docs/roadmap/content-discovery/feat-250-watch-language-inventory-query-performance.md`
- `docs/plans/2026-07-13-003-perf-watch-language-inventory-sql-plan.md`
- `docs/solutions/performance-issues/admin-semantic-db-retrieval-visible-candidate-window.md`
