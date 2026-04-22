---
title: "Language cache warm exhausts PostgreSQL connection pool via Strapi N+1"
date: "2026-04-03"
category: "performance-issues"
severity: "critical"
module:
  - "manager"
  - "cms"
tags:
  - "strapi-v5"
  - "graphql"
  - "n-plus-1"
  - "postgresql"
  - "connection-pool"
  - "knex"
  - "raw-sql"
  - "rest-endpoint"
  - "fk-indexes"
  - "api-token-auth"
  - "language-cache"
related:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
related_prs:
  - "#646"
  - "#637"
symptoms:
  - "KnexTimeoutError: pool is probably full during language cache refresh"
  - "Auth checks (/api/users/me) took 167 seconds during cache warm"
  - "/api/auth/local took 73 seconds"
  - "4 parallel GraphQL queries produced ~20K individual DB queries"
root_cause: "Strapi v5 lacks DataLoader so GraphQL relation resolution causes N+1 queries; 6,598 country-language rows with 3 nested relations produced ~20K queries exhausting the 25-connection pool"
---

## Problem

The manager application's language cache warm-up fired 4 parallel GraphQL queries against Strapi v5, producing approximately 20,000 individual database queries due to Strapi's N+1 problem. This exhausted the PostgreSQL connection pool (25 connections), blocking all CMS requests for 30-167 seconds and rendering the entire CMS unresponsive during cache refresh cycles.

This is the second occurrence of this pattern. The first was the video-coverage query (PR #637).

## Evidence

- CMS logs during language cache warm: `KnexTimeoutError: Knex: Timeout acquiring a connection. The pool is probably full.`
- `/api/users/me` response time: **167 seconds** (normally <50ms)
- `/api/auth/local` response time: **73 seconds**
- Dataset sizes driving the explosion:
  - `country_languages`: 6,598 rows
  - `languages`: 2,280 rows
  - `countries`: 240 rows
  - `continents`: 6 rows
- The `countryLanguages_connection` GraphQL query with nested `language`, `country`, and `country.continent` relations was the primary offender: 6,598 rows x 3 nested relations = ~20K individual `findOne` queries.

## Root Cause

Strapi v5's GraphQL implementation lacks DataLoader-style batching. Every nested relation on every row in a collection query fires a separate `findOne` database call:

```
6,598 country_language rows
  x 1 findOne for language
  x 1 findOne for country
  x 1 findOne for country.continent
= ~19,794 additional DB queries (on top of the base queries)
```

Four such GraphQL queries ran in parallel during cache warm, instantly saturating the connection pool. Every other CMS request then queued behind the pool.

## Solution

### Part 1: Custom CMS REST endpoint (`/api/language-geo`)

Created a custom Strapi v5 API following the route/controller/service pattern established by the video-coverage fix (PR #637).

**File structure:**

```
apps/cms/src/api/language-geo/
  routes/language-geo.ts       -- GET /language-geo
  controllers/language-geo.ts  -- knex access, delegates to service
  services/language-geo.ts     -- single SQL query + JS aggregation
```

**Single SQL query replacing ~20K:**

```sql
SELECT
  l.core_id AS lang_core_id, l.name AS lang_name, cl.speakers,
  c.core_id AS country_core_id, c.name AS country_name,
  ct.core_id AS continent_core_id, ct.name AS continent_name
FROM country_languages cl
JOIN country_languages_language_lnk cll ON cll.country_language_id = cl.id
JOIN country_languages_country_lnk clc ON clc.country_language_id = cl.id
JOIN languages l ON l.id = cll.language_id AND l.published_at IS NOT NULL
JOIN countries c ON c.id = clc.country_id AND c.published_at IS NOT NULL
JOIN countries_continent_lnk ccl ON ccl.country_id = c.id
JOIN continents ct ON ct.id = ccl.continent_id AND ct.published_at IS NOT NULL
WHERE cl.published_at IS NOT NULL
```

**Critical Strapi v5 details:**

- Relations are stored in `_lnk` junction tables, not as FK columns on the content type table. You must join through `country_languages_language_lnk`, `country_languages_country_lnk`, etc.
- Naming convention: `{plural_content_type}_{relation_field}_lnk` with columns `{singular_content_type}_id` and `{target_singular}_id`.
- Always filter `published_at IS NOT NULL` on every content table -- Strapi v5 stores both draft and published rows.

JS aggregation in the service transforms flat SQL rows into `{ continents, countries, languages }` using Maps keyed on `core_id`.

### Part 2: Manager route update

Replaced 4 GraphQL queries and ~175 lines of pagination/aggregation logic with a single `fetch()`:

```typescript
const response = await fetch(`${env.STRAPI_URL}/api/language-geo`, {
  headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
  signal: AbortSignal.timeout(10_000),
})
const data = (await response.json()) as CmsLanguageGeo
```

SWR cache unchanged (24h TTL, 48h maxStale). Cache warming via `instrumentation.ts` unchanged.

### Part 3: Link table FK indexes

Strapi v5 auto-creates `_lnk` junction tables but does **not** create indexes on their FK columns. Added a migration (`2026.04.03T00.00.00.add-link-table-fk-indexes.ts`) covering all FK columns in link tables used by both `language-geo` and `video-coverage` endpoints. Uses `CREATE INDEX IF NOT EXISTS` and `hasTable` checks for safety.

### Part 4: Auth fix

Removed `auth: false` from both `language-geo` and `video-coverage` route configs. Strapi's default API token auth now validates the Bearer token the manager already sends. Previously both endpoints were unauthenticated -- anyone who could reach the CMS could query them.

## Result

| Metric                      | Before                            | After            |
| --------------------------- | --------------------------------- | ---------------- |
| DB queries per cache warm   | ~20,000                           | 1                |
| CMS blocked during warm     | 30-167s                           | 0s               |
| `/api/users/me` during warm | 167s                              | <50ms            |
| Language cache response     | Multiple paginated GQL roundtrips | Single REST call |
| Connection pool errors      | `KnexTimeoutError` on every warm  | None             |

## Reusable Pattern: Strapi v5 Performance Escape Hatch

This is now documented in `apps/cms/CLAUDE.md`. For any query touching large datasets with nested relations:

1. **Identify:** GraphQL query returning >100 rows with nested relations.
2. **Calculate:** `rows x nested_relations = DB queries`. If >1,000, build a custom endpoint.
3. **Implement:** Route/controller/service in `apps/cms/src/api/{name}/` with raw SQL joining through `_lnk` tables.
4. **Index:** Add FK indexes on all `_lnk` tables involved.
5. **Filter:** Always include `published_at IS NOT NULL` on every content table.
6. **Auth:** Do not set `auth: false` -- let Strapi validate the API token.
7. **Consume:** Replace GraphQL calls in the consumer with a single `fetch()`.

Current endpoints using this pattern: `video-coverage` (PR #637), `language-geo` (PR #646).

## Prevention

### When to Use GraphQL vs Custom REST

| Use GraphQL                               | Use Custom REST with Raw SQL     |
| ----------------------------------------- | -------------------------------- |
| Single-entity fetches by ID or slug       | Queries returning >200 rows      |
| Small collections with 1 level of nesting | Aggregation/reporting queries    |
| Client-facing pages (small data)          | Queries joining 3+ tables        |
| CRUD from CMS admin UI                    | Dashboard or bulk data endpoints |

**Hard rule:** If a query's result set scales with editorial content volume, it must not use Strapi's GraphQL resolver.

### Code Review Red Flags

- Any GraphQL query fetching a collection with nested relations and no pagination limit
- Queries nesting more than one level of relations
- New content types with link tables lacking explicit FK indexes
- Any query used in dashboard, reporting, or aggregation context

### CMS Log Patterns Indicating N+1

- `KnexTimeoutError: pool is probably full`
- Duration spikes (>100ms per query) in bursts of hundreds within seconds
- `pg_stat_activity` showing dozens of identical `SELECT ... WHERE id = $1` queries

### Checklist for New Custom REST Endpoints

- [ ] No `auth: false` -- use Strapi's built-in API token auth
- [ ] Raw SQL via `(strapi.db as any).connection.raw()`, not `entityService`
- [ ] FK indexes on all `_lnk` table columns used in JOINs
- [ ] `published_at IS NOT NULL` on every content table in the query
- [ ] Cross-reference comment linking CMS return type and consumer type
- [ ] Error logging with labeled prefix (e.g., `[api/languages]`)
- [ ] `AbortSignal.timeout()` on the consumer's fetch call

## Related Documentation

- [`manager-video-coverage-sql-aggregation-20260402.md`](manager-video-coverage-sql-aggregation-20260402.md) -- First instance of this pattern (PR #637)
- [`strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`](strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md) -- Original N+1 diagnosis
- [`swr-cache-failure-backoff-manager-20260331.md`](swr-cache-failure-backoff-manager-20260331.md) -- SWR cache circuit breaker (no changes needed)
- [`docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md`](../cms/core-sync-bulk-update-temp-table-pattern.md) -- Complementary raw knex patterns
- PR #646: Language cache performance fix
- PR #637: Video coverage performance fix
