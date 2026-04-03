---
title: "fix: Bypass GraphQL N+1 for language/geo cache with custom CMS REST endpoint"
type: fix
status: completed
date: 2026-04-03
origin: docs/brainstorms/2026-04-03-manager-language-cache-performance-requirements.md
---

# fix: Bypass GraphQL N+1 for language/geo cache with custom CMS REST endpoint

## Overview

Create a custom CMS REST endpoint (`/api/language-geo`) that returns all language, country, continent, and country-language data in a single SQL query using raw knex. Update the manager's language route to call this endpoint instead of 4 parallel GraphQL queries that produce ~20K individual DB queries via Strapi v5's unpatched N+1 problem.

## Problem Frame

The manager's language cache warm fires 4 parallel GraphQL queries on startup and every 24h. The `countryLanguages_connection` query returns 6,598 rows, each with nested `language`, `country`, and `country.continent` relations. Strapi v5 GraphQL has no DataLoader batching — every nested relation fires a separate `findOne` DB query. This produces ~20K queries, exhausts the 25-connection PostgreSQL pool, and blocks all other CMS requests (auth checks took 73-167 seconds during a language cache refresh).

This is the same N+1 pattern fixed for video coverage in PR #637. (see origin: `docs/brainstorms/2026-04-03-manager-language-cache-performance-requirements.md`)

## Requirements Trace

- R1. Language/geo data fetch must not exhaust the CMS connection pool
- R2. Language cache refresh must complete in under 5 seconds (currently 30s+)
- R3. Auth checks (`/api/users/me`) must remain responsive during language cache refresh
- R4. Language picker must still show all ~4,560 languages grouped by continent and country with speaker counts

## Scope Boundaries

- Video coverage endpoint already fixed (PR #637) — not in scope
- No changes to the language picker UI
- No changes to the country-language data model
- No changes to the SWR cache utility (`src/lib/swr-cache.ts`)

## Context & Research

### Relevant Code and Patterns

- **Video coverage endpoint (the template):**
  - Route: `apps/cms/src/api/video-coverage/routes/video-coverage.ts`
  - Controller: `apps/cms/src/api/video-coverage/controllers/video-coverage.ts`
  - Service: `apps/cms/src/api/video-coverage/services/video-coverage.ts`
- **Current language route:** `apps/manager/src/app/api/languages/route.ts` — 4 parallel GraphQL queries, transforms into `{ continents, countries, languages }` shape
- **Manager video route (consumption pattern):** `apps/manager/src/app/api/videos/route.ts` — calls `fetch(${STRAPI_URL}/api/video-coverage)` with Bearer token
- **Cache warming:** `apps/manager/src/instrumentation.ts`
- **SWR cache:** `apps/manager/src/lib/swr-cache.ts`
- **Env config:** `apps/manager/src/config/env.ts`

### Database Schema (Strapi v5 conventions)

All tables use `published_at IS NOT NULL` to filter out draft rows.

| Table               | Key columns                                 | Link tables                                                                                                                                    |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `continents`        | `id`, `core_id`, `name`, `published_at`     | —                                                                                                                                              |
| `countries`         | `id`, `core_id`, `name`, `published_at`     | `countries_continent_lnk` (`country_id`, `continent_id`)                                                                                       |
| `languages`         | `id`, `core_id`, `name`, `published_at`     | —                                                                                                                                              |
| `country_languages` | `id`, `core_id`, `speakers`, `published_at` | `country_languages_language_lnk` (`country_language_id`, `language_id`), `country_languages_country_lnk` (`country_language_id`, `country_id`) |

### Institutional Learnings

- **`docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md`**: Strapi v5 GraphQL has no DataLoader. Proven escape hatch: custom REST endpoint with raw knex. Always filter `published_at IS NOT NULL`. Result: 60ms with filter, 660ms global (down from 22-47s).
- **`docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`**: Strapi v5 GraphQL silently truncates nested relations to 10 items unless `pagination: { limit: -1 }` is passed.
- **`docs/solutions/performance-issues/swr-cache-failure-backoff-manager-20260331.md`**: SWR cache has failure backoff (circuit breaker) — no changes needed there.

## Key Technical Decisions

- **Single denormalized SQL query**: Join all 4 tables + 3 link tables in one query returning ~6,598 rows. Aggregate in the CMS service layer (not the manager) to return the exact `{ continents, countries, languages }` shape the manager expects. This minimizes data transfer and keeps aggregation close to the data.
- **Aggregate in CMS service, not SQL**: Use JS aggregation in the service layer rather than SQL `GROUP BY` / `json_agg`. The video-coverage endpoint uses this pattern, it's simpler to maintain, and the row count (6,598) is small enough that in-memory aggregation is fast.
- **`auth: false` on route**: Same as video-coverage. The manager authenticates via its API token at the application level, not through Strapi's built-in auth middleware.
- **Return `coreId` as primary identifier**: The manager uses `coreId` (falling back to `documentId`) as the canonical ID. The endpoint should return `coreId` to match the existing data contract.

## Open Questions

### Resolved During Planning

- **Should aggregation happen in SQL or JS?** JS in the CMS service. Simpler, follows video-coverage pattern, ~6.6K rows is trivial to aggregate in memory.
- **Should the endpoint return raw rows or the aggregated shape?** Aggregated shape matching current contract. Keeps the manager route change minimal (swap fetch source, remove transform logic).

### Deferred to Implementation

- **Exact column aliasing in the SQL query**: Will be finalized when writing the service, verifying against actual DB column names.
- **Whether `document_id` fallback is still needed**: The current code falls back to `documentId` when `coreId` is absent. Will verify during implementation whether any rows lack `core_id`.

## Implementation Units

- [x] **Unit 1: Create CMS `/api/language-geo` endpoint**

  **Goal:** New custom REST endpoint that returns all language/geo data in a single SQL query, aggregated into the `{ continents, countries, languages }` shape.

  **Requirements:** R1, R2

  **Dependencies:** None

  **Files:**
  - Create: `apps/cms/src/api/language-geo/routes/language-geo.ts`
  - Create: `apps/cms/src/api/language-geo/controllers/language-geo.ts`
  - Create: `apps/cms/src/api/language-geo/services/language-geo.ts`

  **Approach:**
  - Route: single GET at `/language-geo`, `auth: false`, handler `"language-geo.index"`
  - Controller: get knex via `(strapi.db as any).connection`, delegate to service, set `ctx.body`
  - Service: single SQL query joining `country_languages` → `languages`, `countries`, `continents` through their link tables. Filter `published_at IS NOT NULL` on all content tables. Return raw rows, then aggregate in JS to produce:
    ```
    {
      continents: [{ id, name }],
      countries: [{ id, name, continentId }],
      languages: [{ id, englishLabel, nativeLabel, countryIds, continentIds, countrySpeakers }]
    }
    ```
  - Use `core_id` as the `id` field, with `document_id` fallback

  **Patterns to follow:**
  - `apps/cms/src/api/video-coverage/` — identical 3-file structure (route/controller/service)
  - `(strapi.db as any).connection` for knex access with eslint-disable comment
  - `type KnexInstance = any` pattern from video-coverage service

  **Test scenarios:**
  - Returns all continents (6), countries (240), languages (~2,280) with correct structure
  - `countrySpeakers` map correctly aggregates speaker counts per language per country
  - `continentIds` and `countryIds` on each language reflect actual country-language junction data
  - No draft rows included (only `published_at IS NOT NULL`)
  - Query executes in single digit milliseconds against production data volume

  **Verification:**
  - `curl http://localhost:1337/api/language-geo` returns valid JSON with correct counts
  - CMS logs show a single SQL query (no N+1 traces from `association.js`)
  - Response shape matches the existing `languageCache` data contract

- [x] **Unit 2: Update manager language route to use new REST endpoint**

  **Goal:** Replace 4 parallel GraphQL queries with a single fetch to `/api/language-geo`.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `apps/manager/src/app/api/languages/route.ts`

  **Approach:**
  - Replace the `fetchLanguageData()` function internals: swap Apollo GraphQL queries for a single `fetch(\`${env.STRAPI_URL}/api/language-geo\`)` call with Bearer token header
  - Remove the 4 GraphQL query definitions (`GET_CONTINENTS`, `GET_COUNTRIES_CONNECTION`, `GET_LANGUAGES_CONNECTION`, `GET_COUNTRY_LANGUAGES_CONNECTION`)
  - Remove the in-memory aggregation/transform logic (now handled by CMS endpoint)
  - Keep the SWR cache wrapper, TTL settings, and export unchanged
  - Follow the pattern in `apps/manager/src/app/api/videos/route.ts` for REST consumption

  **Patterns to follow:**
  - `apps/manager/src/app/api/videos/route.ts` — fetch from CMS REST endpoint with Bearer token, parse JSON response
  - Use `env.STRAPI_URL` from `src/config/env.ts`, never hardcode

  **Test scenarios:**
  - Language picker still shows all languages grouped by continent and country
  - Speaker counts are accurate
  - Cache warming succeeds on startup without pool exhaustion
  - Stale-while-revalidate behavior unchanged

  **Verification:**
  - Manager language API returns same data shape as before
  - No GraphQL language queries appear in CMS logs during cache refresh
  - Auth endpoints (`/api/users/me`) respond in normal time during language cache warm
  - Language cache refresh completes in under 5 seconds

## System-Wide Impact

- **Connection pool relief:** Removing ~20K individual queries frees the PostgreSQL connection pool for concurrent requests. This directly unblocks auth checks (R3).
- **Error propagation:** The SWR cache already has failure backoff (30s circuit breaker). If the new endpoint fails, the cache serves stale data within `maxStaleMs` (48h). No changes needed.
- **Cache warming order:** `instrumentation.ts` warms video, coverage, and language caches. The language cache will now complete faster, reducing the startup window where the pool is under pressure.
- **API surface:** No other consumers use the language GraphQL queries being removed — they are defined locally in the manager's route file.

## Risks & Dependencies

- **Strapi v5 link table naming**: The plan assumes link table columns based on the core-sync service evidence. If column names differ, the SQL query will need adjustment — verify with a quick `\d` or `SELECT` during implementation.
- **CMS deployment ordering**: The CMS endpoint (Unit 1) must be deployed before the manager update (Unit 2). In a monorepo deploy, both ship together, but if Railway deploys them independently, the CMS must go first.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-03-manager-language-cache-performance-requirements.md](docs/brainstorms/2026-04-03-manager-language-cache-performance-requirements.md)
- **Video coverage fix (pattern):** PR #637, `apps/cms/src/api/video-coverage/`
- **Learning:** `docs/solutions/performance-issues/manager-video-coverage-sql-aggregation-20260402.md`
- **Learning:** `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`
- **Learning:** `docs/solutions/performance-issues/swr-cache-failure-backoff-manager-20260331.md`
