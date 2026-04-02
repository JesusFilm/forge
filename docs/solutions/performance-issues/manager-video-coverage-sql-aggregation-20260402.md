---
module: manager, cms
problem_type: performance_issue
severity: critical
date: 2026-04-02
pr: "#637"
---

# Manager Video Coverage: SQL Aggregation vs GraphQL N+1

## Problem

The manager's `/api/videos` endpoint fetched all 414K video variant rows + 20K subtitle rows through Strapi GraphQL to compute per-video coverage status (human/ai/none) in JavaScript. A single cache refresh took 22-47 seconds and saturated the CMS, blocking `/api/users/me` auth checks. Users would sign in, see the dashboard, then get logged out when their auth check exceeded the 5s timeout.

## Root Cause

Strapi v5 GraphQL has no DataLoader batching. Each nested relation (`variants`, `subtitles`) fires separate DB queries per parent video — classic N+1. With `pagination: { limit: -1 }` on nested relations, the entire variant/subtitle tables were loaded through the ORM layer for every cache refresh.

Additionally, PR #626 accidentally introduced `maxLimit: 100` on the GraphQL config, which capped top-level pagination to 100/page. This turned a single-page fetch (`pageSize: 5000`) into 11 sequential round-trip pages, each taking ~2s.

## Solution

Created a custom CMS REST endpoint (`/api/video-coverage`) that computes per-video coverage counts via SQL aggregation using raw knex (`strapi.db.connection`). The SQL uses materialized CTEs to:

1. Group subtitles by (video, language), determine human vs AI with `BOOL_OR(NOT COALESCE(ai_generated, true))`
2. Same for variants
3. Join with video metadata, parent-child links, and images
4. Return pre-computed `{ human: N, ai: N }` counts per video

**Benchmark:** 60ms with language filter, 660ms global — down from 22-47 seconds.

## Key Patterns

- **Follow the `coverage-snapshot` service pattern** for raw SQL endpoints in Strapi v5: controller/routes/services structure, `(strapi.db as any).connection` for knex
- **Always filter `published_at IS NOT NULL`** in Strapi v5 SQL queries — every published document has both a draft and published row
- **`videos_children_lnk`**: `video_id` = parent, `inv_video_id` = child
- **`video_images_video_lnk`**: joins images to videos; use `DISTINCT ON (v.document_id)` to get one image per video
- **Language filtering via `l.core_id = ANY(?)`** with knex parameterized bindings works for variable-length language ID arrays
- **`none` count computed client-side**: `selectedLanguages.length - human - ai` — no SQL needed for this

## Additional Fixes in Same PR

- **Reverted `maxLimit: 100`** from GraphQL config (PR #626 regression) — GraphQL defaults to `maxLimit: -1` (unlimited), and `pageSize: 5000` is intentional
- **Language cache TTL 5min → 24h** — geo data changes only during core sync
- **Language pill X button** was only updating draft state without navigating — needed to also call `applyUrlParams` immediately
- **Collection tile as first square** in grid, with `(collection)` suffix in detail view
- **Dashed border** on tiles with partial coverage (some languages covered, some not)
- **Coverage count pills** in hover detail bar (green/purple/red)
- **Search by name or ID** with yellow highlight on matching tiles
- **Collection type filter** dropdown
- **Coverage segment filter** as custom dropdown (native `<select>` has inconsistent styling across browsers)

## What NOT to Do

- Don't set `maxLimit` on the Strapi GraphQL plugin config unless you intend to cap ALL paginated queries — it applies globally, not per-query
- Don't use native `<select>` for custom-styled dropdowns — build a button+menu component instead for cross-browser consistency
- Don't assume `disabled` buttons show `title` tooltips — they don't in all browsers; wrap in a `<span>` with the tooltip instead
