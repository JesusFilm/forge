---
title: "fix: Optimize manager video coverage query performance"
type: fix
status: active
date: 2026-04-02
origin: docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md
---

# fix: Optimize manager video coverage query performance

## Overview

Replace the manager's 414K-row GraphQL fetch with a custom CMS REST endpoint that computes per-video coverage counts via SQL aggregation. Benchmarked at 60-660ms (vs 22-47s today). Also revert the `maxLimit: 100` GraphQL regression and fix language pagination.

## Problem Frame

The manager's `/api/videos` endpoint fetches all video variant rows (414K) and subtitle rows (20K) through Strapi GraphQL to compute per-video coverage status in JavaScript. This saturates the CMS for 22-47 seconds during every cache refresh, blocking `/api/users/me` auth checks behind it. Users sign in, see the dashboard briefly, then get logged out when their auth check exceeds the 5s timeout. (see origin: `docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md`)

## Requirements Trace

- R1. Coverage counts `{ human, ai, none }` per video per coverage type, filtered by selected languages
- R2. Collections show their own coverage, not rolled up from children
- R3. Standalone videos returned separately
- R4. Coverage computed server-side via SQL, not by fetching raw rows
- R5. Cache refresh must not block auth checks
- R6. Language picker shows all available languages
- R7. Revert `maxLimit: 100` from PR #626

## Scope Boundaries

- Coverage snapshots (daily stats bar) are out of scope
- No visual design changes to the coverage report UI
- Metadata coverage stays as a single boolean (`aiMetadata`)
- The `coverage-report-client.tsx` component changes are limited to data consumption — visual layout stays the same

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/coverage-snapshot/services/coverage-snapshot.ts` — existing SQL aggregation pattern using `strapi.db.connection` (knex) with `BOOL_OR(NOT COALESCE(m.ai_generated, false))` per (video, language) pair. This is the direct template for the new endpoint.
- `apps/cms/src/api/data-snapshot/` — example of custom CMS REST endpoints with controller/routes/services/middleware structure
- `apps/manager/src/app/api/videos/route.ts` — current route handler, SWR cache, GraphQL query, and coverage computation
- `apps/manager/src/lib/swr-cache.ts` — shared SWR cache utility (module-scoped, single-process)
- `apps/manager/src/features/coverage/coverage-report-client.tsx` — frontend component consuming `/api/videos`
- `videos_children_lnk` table — `video_id` (parent) → `inv_video_id` (child) with ordering columns

### Institutional Learnings

- Strapi v5 GraphQL has no DataLoader batching — each nested relation fires N+1 queries (see `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`)
- All queries must filter `published_at IS NOT NULL` to avoid double-counting draft rows
- Custom CMS endpoints need explicit route files for REST exposure; use `strapi.db.connection` for raw knex
- The `maxLimit: 100` set in PR #626 caps GraphQL pagination to 100/page, breaking the intentional `pageSize: 5000` — must be reverted

### Benchmark Results (production data)

| Query                                                    | Time                |
| -------------------------------------------------------- | ------------------- |
| All videos, all languages, subtitles + variants coverage | **660ms**           |
| All videos, single language filter (English)             | **60ms**            |
| Current GraphQL fetch (414K rows through ORM)            | **22,000-47,000ms** |

## Key Technical Decisions

- **Custom CMS REST endpoint over GraphQL**: The CMS already has precedent for raw SQL endpoints (`coverage-snapshot`, `data-snapshot`, `core-sync`). A custom endpoint avoids GraphQL N+1 entirely and returns exactly the data needed. (see origin decisions)
- **Coverage computed per-request with language param**: The SQL is fast enough (60-660ms) that per-request computation is viable. The manager SWR cache stores the result for 2 minutes. Changing the language filter triggers a fresh fetch (~60ms for filtered, ~660ms for global). This is acceptable given the current 22-47s baseline.
- **Language cache TTL increased to 24 hours**: Language/geo data changes only during core sync (rare). The current 5-minute TTL causes unnecessary CMS load for data that's essentially static.
- **`none` count for language-filtered requests**: When languages are selected, `none` = number of selected languages minus (human + ai). For global mode (no filter), `none` is 0 (we only count languages that have content).

## Open Questions

### Resolved During Planning

- **Where to compute coverage?** Custom CMS REST endpoint with raw SQL. Follows existing `coverage-snapshot` pattern. SQL benchmarks confirm sub-second performance.
- **How to handle language filtering?** Accept `languageIds` query parameter. SQL uses `l.core_id = ANY($1)` for filtered, omits clause for global. Frontend passes selected languages, gets back counts.
- **How to serve all languages?** Revert `maxLimit: 100` (R7). The `pageSize: 5000` in `fetchAllPages` will work again as intended. Additionally, increase language cache TTL from 5 min to 24 hours since geo data rarely changes.
- **How to handle `none` count?** Computed as: `selectedLanguages.length - (human + ai)` on the manager side. No SQL needed for this — the manager knows how many languages were selected.

### Deferred to Implementation

- Exact knex parameterization syntax for the `ANY($1::text[])` language filter — validate during implementation
- Whether `videos_children_lnk.video_id` is the parent or child — verify with a quick DB query during implementation
- Whether the images query (thumbnail/videoStill) should stay in the GraphQL query or move to a SQL join in the new endpoint

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
Browser                    Manager (Next.js)                CMS (Strapi)
  |                              |                              |
  |-- GET /api/videos            |                              |
  |   ?languageIds=529,21028     |                              |
  |                              |-- GET /api/video-coverage     |
  |                              |   ?languageIds=529,21028     |
  |                              |                              |-- SQL: video metadata
  |                              |                              |-- SQL: subtitle coverage (CTE)
  |                              |                              |-- SQL: variant coverage (CTE)
  |                              |                              |-- SQL: parent-child links
  |                              |<--- JSON: videos[] with -----+
  |                              |     per-video coverage counts
  |                              |
  |                              |-- Reconstruct collections
  |                              |   from parent-child links
  |                              |-- Compute `none` counts
  |<--- JSON: { collections,  --+
  |     standalone }             |
```

## Implementation Units

- [ ] **Unit 1: Revert `maxLimit: 100` from GraphQL config**

  **Goal:** Remove the GraphQL pagination cap that broke `pageSize: 5000` and caused 11-page sequential fetching.

  **Requirements:** R7

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/config/plugins.ts`

  **Approach:**
  - Remove the `maxLimit: 100` line added in PR #626
  - The GraphQL plugin defaults to `maxLimit: -1` (unlimited), which is the intended behavior

  **Patterns to follow:**
  - The previous plan (`docs/plans/2026-03-28-002-fix-optimize-videos-graphql-query-plan.md`) explicitly documented that GraphQL `maxLimit` defaults to `-1` and `pageSize: 5000` is intentional

  **Verification:**
  - `apps/cms/config/plugins.ts` has no `maxLimit` in the graphql config
  - Language and video pagination return full pages at `pageSize: 5000`

- [ ] **Unit 2: Add CMS `/api/video-coverage` REST endpoint**

  **Goal:** Create a custom Strapi REST endpoint that returns all published videos with their metadata, parent-child links, and per-video coverage counts computed via SQL aggregation.

  **Requirements:** R1, R2, R4

  **Dependencies:** None (can be built in parallel with Unit 1)

  **Files:**
  - Create: `apps/cms/src/api/video-coverage/routes/video-coverage.ts`
  - Create: `apps/cms/src/api/video-coverage/controllers/video-coverage.ts`
  - Create: `apps/cms/src/api/video-coverage/services/video-coverage.ts`

  **Approach:**
  - Follow the exact pattern from `apps/cms/src/api/coverage-snapshot/` — controller/routes/services, knex via `strapi.db.connection`
  - Accept optional `languageIds` query parameter (comma-separated `core_id` values)
  - Service runs two materialized CTEs: one for subtitle coverage, one for variant coverage
  - Each CTE computes per-video `COUNT(DISTINCT l.core_id) FILTER (WHERE has_human/ai)` grouped by `v.document_id`
  - Main query joins videos with both CTEs and returns: `document_id`, `core_id`, `title`, `label`, `slug`, `ai_metadata`, image fields, parent document IDs (from `videos_children_lnk`), and coverage counts
  - Filter `published_at IS NOT NULL` on all tables
  - When `languageIds` is provided, add `AND l.core_id = ANY($1)` to both CTEs
  - Auth: use the same API token auth that the manager already uses for GraphQL calls (Strapi API token in `Authorization: Bearer` header — no custom middleware needed since Strapi's built-in API token auth covers custom routes when `auth: false` is NOT set)

  **Technical design:** _(directional guidance, not implementation specification)_

  ```
  Response shape:
  {
    videos: [
      {
        documentId, coreId, title, label, slug, aiMetadata,
        thumbnailUrl, videoStillUrl,
        parentDocumentIds: string[],
        coverage: {
          subtitles: { human: N, ai: N },
          audio: { human: N, ai: N }
        }
      }
    ]
  }
  ```

  Note: `meta` coverage (aiMetadata) is already on the video row — no SQL aggregation needed. The `none` count for language-filtered requests is computed on the manager side.

  **Patterns to follow:**
  - `apps/cms/src/api/coverage-snapshot/services/coverage-snapshot.ts` — knex raw SQL with `BOOL_OR`, link table joins, `published_at` filtering
  - `apps/cms/src/api/data-snapshot/routes/data-snapshot.ts` — custom route file structure

  **Test scenarios:**
  - No `languageIds` param → returns global coverage (all languages)
  - Single language → returns coverage for that language only
  - Multiple languages → returns coverage counts across selected languages
  - Video with no subtitles/variants → coverage counts are 0
  - Only published videos returned (no draft rows)

  **Verification:**
  - Endpoint returns all ~1083 published videos with coverage data
  - Response time < 1s with language filter, < 2s without
  - Coverage counts match manual SQL verification for a sample video

- [ ] **Unit 3: Update manager `/api/videos` to use new CMS endpoint**

  **Goal:** Replace the GraphQL-based video fetch with a call to the new CMS REST endpoint. Update the response shape to include coverage counts.

  **Requirements:** R1, R2, R3, R4, R5

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `apps/manager/src/app/api/videos/route.ts`
  - Modify: `apps/manager/src/lib/strapi-pagination.ts` (may no longer be needed for videos)
  - Modify: `apps/manager/src/instrumentation.ts` (cache warming)

  **Approach:**
  - Replace `GET_VIDEOS_CONNECTION` GraphQL query and `fetchAllPages` loop with a single `fetch()` call to the CMS `/api/video-coverage` endpoint
  - Pass `languageIds` from the request query string through to the CMS endpoint
  - The SWR cache fetcher now calls the REST endpoint instead of GraphQL
  - Keep the parent-child hierarchy reconstruction logic (grouping into collections + standalone), but use `parentDocumentIds` from the response instead of a separate `parents` GraphQL field
  - Remove the `determineCoverage` and `determineCoverageForItems` functions — coverage comes pre-computed from CMS
  - Compute `none` count on the manager side: for language-filtered requests, `none = selectedLanguages.length - (human + ai)` per coverage type per video. For global, `none = 0`
  - Update response shape: change `coverage: { subtitles: "human", audio: "human", meta: "human" }` to `coverage: { subtitles: { human, ai, none }, audio: { human, ai, none }, meta: { human, ai, none } }`
  - For `meta` coverage: derive from `aiMetadata` boolean — `{ human: aiMetadata === false ? 1 : 0, ai: aiMetadata === true ? 1 : 0, none: aiMetadata == null ? 1 : 0 }`

  **Patterns to follow:**
  - `apps/manager/src/cms/client.ts` — how the manager makes authenticated calls to CMS
  - Existing SWR cache usage in `apps/manager/src/app/api/videos/route.ts`

  **Test scenarios:**
  - Dashboard loads without auth timeout (primary success criterion)
  - Language filter change returns updated coverage counts
  - No language filter returns global coverage
  - Collections correctly grouped from parent-child links
  - Standalone videos (no parents, no children) in separate array
  - Cache warm on startup completes in < 5s

  **Verification:**
  - `videoCache` refresh completes in < 2s (vs 22-47s today)
  - CMS `/api/users/me` responds in < 1s during cache refresh
  - Dashboard loads and stays logged in through navigation

- [ ] **Unit 4: Update frontend to consume coverage counts**

  **Goal:** Update the coverage report client component to handle the new `{ human, ai, none }` count format instead of the current single `"human" | "ai" | "none"` string.

  **Requirements:** R1

  **Dependencies:** Unit 3

  **Files:**
  - Modify: `apps/manager/src/features/coverage/coverage-report-client.tsx`

  **Approach:**
  - Update the `CoverageStatus` type or add a new `CoverageCounts` type: `{ human: number, ai: number, none: number }`
  - Update how each video's `coverageStatus` is derived for the active report type — from a direct string to a derived status from counts (e.g., `counts.human > 0 ? "human" : counts.ai > 0 ? "ai" : "none"` for the traffic light)
  - The `CoverageBar` component already accepts `counts: { human, ai, none }` — feed it the counts directly from the API instead of computing them from statuses
  - Collection-level coverage counts: aggregate children's counts for the collection's coverage bar
  - No visual changes — same traffic lights, same bar proportions, same color scheme

  **Patterns to follow:**
  - Existing `CoverageBar` component props (already accepts count objects)
  - Existing `REPORT_CONFIG` for report type switching

  **Test scenarios:**
  - Report type switching (subtitles/audio/meta) still works instantly
  - Coverage bar shows correct proportions from counts
  - Language filter change triggers refetch and updates counts
  - Collection bar aggregates children counts correctly

  **Verification:**
  - Dashboard renders the same visual output as before for the same data
  - Switching report types is instant (no refetch)
  - Switching languages triggers a refetch and updates within ~1s

- [ ] **Unit 5: Increase language cache TTL and fix language pagination**

  **Goal:** Increase the language cache TTL from 5 minutes to 24 hours (geo data rarely changes) and ensure all 4,560 languages are served.

  **Requirements:** R6

  **Dependencies:** Unit 1 (maxLimit revert enables pageSize: 5000 to work)

  **Files:**
  - Modify: `apps/manager/src/app/api/languages/route.ts`

  **Approach:**
  - Change `ttlMs` from `5 * 60_000` (5 min) to `24 * 60 * 60_000` (24 hours)
  - Keep `maxStaleMs` at `60 * 60_000` (1 hour) or increase proportionally
  - With Unit 1's maxLimit revert, the existing `pageSize: 5000` in `fetchAllPages` will fetch all languages in 1 page instead of being capped at 100/page

  **Verification:**
  - Language picker shows all ~4,560 languages
  - Language cache only refreshes once per 24 hours (check log frequency)

## System-Wide Impact

- **Interaction graph:** The new CMS endpoint is called by the manager's `/api/videos` route handler. No other consumers need changes. The existing GraphQL schema is untouched.
- **Error propagation:** If the CMS endpoint returns an error, the SWR cache serves stale data (existing behavior). The manager should log the error and surface it only if stale data exceeds `maxStaleMs`.
- **State lifecycle risks:** The SWR cache stores language-agnostic or language-specific data depending on the request. Concurrent requests with different language filters will trigger cache refreshes, but the SWR deduplication handles this.
- **API surface parity:** The frontend is the only consumer of `/api/videos`. No other apps call this endpoint.
- **Auth check impact:** With cache refresh dropping from 22-47s to <2s, auth checks via `/api/users/me` are no longer blocked. This directly resolves the session expiry symptom.

## Risks & Dependencies

- **CMS endpoint auth**: The new REST endpoint must be accessible with the same Strapi API token the manager already uses. Strapi's built-in API token middleware should handle this by default for custom routes, but needs verification during implementation.
- **`videos_children_lnk` column semantics**: Need to verify whether `video_id` is the parent and `inv_video_id` is the child. A quick DB query during implementation will confirm.
- **`maxStaleMs` for language cache**: Increasing TTL to 24h means `maxStaleMs` should also be increased (to e.g. 48h) to avoid blocking requests if the CMS is briefly unavailable during the daily refresh window.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md](docs/brainstorms/2026-04-02-manager-coverage-query-performance-requirements.md)
- Related code: `apps/cms/src/api/coverage-snapshot/services/coverage-snapshot.ts` (SQL pattern)
- Related plan: `docs/plans/2026-03-28-002-fix-optimize-videos-graphql-query-plan.md` (prior optimization, documents maxLimit behavior)
- Related PRs: #626 (pool fix that introduced maxLimit regression), #627 (NULL boolean backfill)
