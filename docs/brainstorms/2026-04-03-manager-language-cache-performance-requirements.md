---
date: 2026-04-03
topic: manager-language-cache-performance
---

# Manager Language Cache Performance

## Problem Frame

The manager's language cache fetches continent, country, language, and country-language data from the CMS via 4 parallel GraphQL queries on every cache refresh (every 24h and on startup). The `countryLanguages_connection` query returns 6,598 rows with nested relations (`country { coreId, continent { coreId } }`, `language { coreId }`). Strapi v5 GraphQL has no DataLoader batching — each nested relation on each row fires a separate `findOne` DB query. This produces ~20K individual DB queries, exhausting the 25-connection pool and blocking all other CMS requests (including auth checks) for the duration.

This is the same N+1 pattern that caused the video coverage performance issue (PR #637), but for the language/geo data path.

## Evidence

- CMS logs show `KnexTimeoutError: pool is probably full` during language cache warm
- GraphQL association resolver stack traces (`association.js:59 → entity-manager load → findOne`)
- `/api/users/me` took 167 seconds during a language cache refresh
- `/api/auth/local` took 73 seconds
- Tables: 6,598 country-languages, 2,280 languages, 240 countries, 6 continents

## Current Implementation

- `apps/manager/src/app/api/languages/route.ts` — 4 parallel GraphQL queries via Apollo
- `apps/manager/src/instrumentation.ts` — warms on startup alongside video and coverage caches
- SWR cache: 24h TTL, 48h maxStale

## Requirements

- R1. Language/geo data fetch must not exhaust the CMS connection pool
- R2. Language cache refresh must complete in under 5 seconds (currently can take 30s+ and block everything)
- R3. Auth checks (`/api/users/me`) must remain responsive during language cache refresh
- R4. Language picker must still show all ~4,560 languages grouped by continent and country with speaker counts

## Suggested Approach

Follow the same pattern as the video-coverage fix: create a custom CMS REST endpoint (`/api/language-geo`) that returns all the data in a single SQL query using raw knex, bypassing GraphQL entirely. The SQL would join `country_languages`, `languages`, `countries`, and `continents` in one query — milliseconds instead of 20K individual queries.

## Scope Boundaries

- Video coverage endpoint is already fixed (PR #637) — not in scope
- No changes to the language picker UI
- No changes to the country-language data model

## Next Steps

-> `/ce:plan` for structured implementation planning
