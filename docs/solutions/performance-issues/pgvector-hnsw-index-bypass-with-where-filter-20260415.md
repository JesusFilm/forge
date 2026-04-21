---
title: "pgvector HNSW index bypassed by planner when WHERE filter on indexed table"
category: "performance-issues"
problem_type: "performance_issue"
component: "database"
root_cause: "missing_index"
resolution_type: "code_fix"
severity: "medium"
module: "apps/cms,apps/admin"
tags:
  - pgvector
  - hnsw
  - postgresql
  - query-planner
  - partial-index
  - semantic-search
  - experience-embeddings
  - scene-embeddings
  - cms
  - admin
date: "2026-04-15"
last_updated: "2026-04-20"
related_prs:
  - "JesusFilm/forge#777"
  - "JesusFilm/forge#798"
related_docs:
  - "docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md"
  - "docs/solutions/best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md"
  - "docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md"
  - "docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
---

# pgvector HNSW index bypassed by planner when WHERE filter on indexed table

## Problem

PostgreSQL's query planner silently bypasses pgvector HNSW indexes when a `WHERE` clause filters on a column belonging to the same indexed table. The planner's cost model for HNSW + post-filter is too pessimistic, so it chooses `Seq Scan + Top-N Sort` even when HNSW would be 5–10× faster — and at scale, **94× faster**.

## Symptoms

- Query latency **178ms** with JOIN at 10K rows (seqscan + nested loop), vs **19.8ms** without JOIN.
- `EXPLAIN ANALYZE` shows the planner choosing a sequential scan with post-filter instead of the HNSW index:

```
Seq Scan on experience_embeddings ee
  Filter: ((locale)::text = 'en'::text)
  Rows Removed by Filter: 8000
  ->  Sort Method: top-N heapsort  Memory: 32kB
```

Instead of the expected:

```
Index Scan using experience_embeddings_hnsw on experience_embeddings ee
  Order By: (embedding <=> $1)
```

The problematic query in `apps/cms/src/api/search/services/experience-semantic-search.ts`:

```sql
SELECT ee.experience_id, e.slug, e.title, e.meta_description,
  1 - (ee.embedding <=> ?::vector) AS similarity
FROM experience_embeddings ee
JOIN experiences e ON e.id = ee.experience_id AND e.published_at IS NOT NULL
WHERE ee.locale = ?
ORDER BY ee.embedding <=> ?::vector
LIMIT ?
```

The HNSW index `experience_embeddings_hnsw` exists. The planner just refuses to use it because of the `WHERE locale = ?` predicate.

## What Didn't Work

Five strategies tested locally with `EXPLAIN ANALYZE` on a 10K-row synthetic table (pgvector 0.8.2, PostgreSQL 16):

| #   | Strategy                                                         | Result                                                                                                              | Time     |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `SET hnsw.iterative_scan = relaxed_order` alone                  | Planner still picked Seq Scan — GUC only affects HNSW scans _when chosen_, doesn't influence the planner's decision | 13ms     |
| 2   | Subquery wrapping (HNSW in inner SELECT, locale filter in outer) | Worked standalone (7.35ms) but JOIN to `experiences` flattened the planner's view; `MATERIALIZED` CTE also failed   | 76–178ms |
| 3   | `SET hnsw.ef_search = 500` (bigger search window)                | Still Seq Scan — same root cause as #1                                                                              | 16ms     |
| 4   | `SET enable_seqscan = off`                                       | Forced HNSW (20ms with JOIN) but heavy-handed escape hatch affecting all queries on the connection                  | 20ms     |
| 5   | Multi-locale partial index (`WHERE locale IN ('en','es','fr')`)  | Worked (1.91ms) but a REINDEX is needed whenever locales evolve                                                     | 1.91ms   |

The recurring lesson: **the GUCs (`iterative_scan`, `ef_search`) only modulate HNSW scans the planner has already chosen.** They do not change the planner's choice. Restructuring the SQL helps when standalone but the planner re-flattens it as soon as a JOIN appears downstream.

## Solution

Two coordinated changes — **no SQL changes in the search service itself**:

### 1. Per-locale partial HNSW indexes

File: `apps/cms/src/bootstrap/ensure-pgvector.ts`

```sql
-- Keep the global HNSW as a fallback for unknown locales
CREATE INDEX IF NOT EXISTS experience_embeddings_hnsw
  ON experience_embeddings USING hnsw (embedding vector_cosine_ops);

-- Add a partial HNSW per Phase 1 locale
CREATE INDEX IF NOT EXISTS experience_embeddings_hnsw_en
  ON experience_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE locale = 'en';

CREATE INDEX IF NOT EXISTS experience_embeddings_hnsw_es
  ON experience_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE locale = 'es';

CREATE INDEX IF NOT EXISTS experience_embeddings_hnsw_fr
  ON experience_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE locale = 'fr';
```

The global HNSW index is kept as a fallback for unknown locales — queries with `WHERE locale = 'xx'` (no partial match) fall back to seqscan, still functional, just slower at scale. Adding a new locale = single `CREATE INDEX` line.

### 2. Connection-level GUCs for iterative scan

File: `apps/cms/config/database.ts` — extend the existing `afterCreate` hook:

```typescript
afterCreate(
  conn: { query: (sql: string, cb: () => void) => void },
  cb: () => void,
) {
  const statementTimeout = env.int("DATABASE_STATEMENT_TIMEOUT", 30000)
  const idleTxTimeout = env.int("DATABASE_IDLE_IN_TRANSACTION_TIMEOUT", 60000)
  conn.query(
    `SET statement_timeout = ${statementTimeout};
     SET idle_in_transaction_session_timeout = ${idleTxTimeout};
     SET hnsw.iterative_scan = relaxed_order;
     SET hnsw.max_scan_tuples = 20000;`,
    cb,
  )
}
```

- `hnsw.iterative_scan = relaxed_order` lets the partial index keep fetching past the default `ef_search = 40` window when LIMIT requires more candidates.
- `relaxed_order` allows HNSW to return rows out of strict distance order during iteration — safe because the outer `ORDER BY` re-sorts.
- `hnsw.max_scan_tuples = 20000` caps the iterative scan so it cannot run away on pathological queries.

Set once per connection in the pool's `afterCreate` hook → **zero per-query overhead**.

### Verification

Production-shaped query (`JOIN + LIMIT 60`) on a 10K-row synthetic `experience_embeddings`:

| Locale                  | Plan                                         | Time       |
| ----------------------- | -------------------------------------------- | ---------- |
| `en` (partial index)    | `Index Scan using ..._hnsw_en` + Nested Loop | **1.90ms** |
| `de` (no partial index) | Seq Scan + Hash Join (graceful fallback)     | 17.55ms    |
| baseline (before fix)   | Seq Scan + Sort + Nested Loop                | 178ms      |

**94× faster** for indexed locales.

## Why This Works

The root cause is pgvector's broken cost model for HNSW + post-filter. When the planner sees:

```
WHERE ee.locale = 'en' ORDER BY ee.embedding <=> ? LIMIT 60
```

it estimates the cost of scanning the HNSW index _and then_ discarding rows that fail the locale predicate. Because HNSW doesn't natively understand locale, the planner assumes it may need to scan many index entries to find enough matching rows — and its cost estimate balloons past the seqscan alternative.

Partial indexes sidestep this entirely:

1. The index definition `WHERE locale = 'en'` means **every row in the index already satisfies the locale predicate**. There is no post-filter.
2. PostgreSQL's planner sees `WHERE locale = 'en'` in the query and recognizes that the partial index `..._hnsw_en WHERE locale = 'en'` covers exactly the matching rows. The locale filter is "free."
3. The cost model is never asked the pessimistic question — the answer is implicitly "all rows in this index match."
4. The `Index Scan` returns rows directly from the partial HNSW in approximate distance order; the outer `ORDER BY` does a final sort on a small result set.

`iterative_scan` is the second half: even with a matching partial index, default HNSW returns at most `ef_search = 40` candidates per pass. Without it, `LIMIT 60` would only see 40 results. With `iterative_scan = relaxed_order`, HNSW keeps fetching until the LIMIT (capped by `max_scan_tuples`) is satisfied.

## Prevention

### When to reach for partial indexes with pgvector

- **Any time you combine `WHERE column = ?` with `ORDER BY embedding <=> ?` on the same table.** If the filtered column is not part of the HNSW index, the planner will likely bypass it.
- **Cardinality matters.** Partial indexes work best for low-cardinality filter columns (locales, content types, status flags). High-cardinality columns (user IDs, slugs) would create too many indexes — use a different approach (e.g., a covering composite index, or pre-filter via a separate query).
- **Existing scene_embeddings query is unaffected** because its locale filter lives on a JOINed table (`languages.bcp_47`), not on `scene_embeddings` itself. The HNSW index on `scene_embeddings.embedding` is unconstrained by JOINs to other tables.

### Signs of the seqscan problem in EXPLAIN ANALYZE

Look for these red flags:

```
Seq Scan on <table_with_embedding>
  Filter: (<non-embedding_column> = ...)
  Rows Removed by Filter: <large number>
```

```
Sort Method: top-N heapsort
  Sort Key: (embedding <=> ...)
```

If you see `Sort Method: top-N heapsort` on an embedding distance, the HNSW index was **not used**. A working HNSW query shows `Index Scan using <hnsw_index_name>` with `Order By: (embedding <=> ...)`.

### What to grep for in future pgvector code

```bash
# Embedding queries with WHERE — likely candidates for partial indexes
grep -rn 'ORDER BY.*<=>\|ORDER BY.*<#>\|ORDER BY.*<->' apps/cms/src/

# Audit existing HNSW index definitions
grep -rn 'USING hnsw' apps/cms/src/
```

For every match of the first pattern, ask: "Does the WHERE clause filter the same table the HNSW index lives on?" If yes, the partial-index pattern is needed.

### Suggested EXPLAIN-based regression test

Add an integration test that verifies the planner picks the HNSW index. Catches regressions from schema changes, pgvector upgrades, or PostgreSQL version bumps:

```typescript
it("uses HNSW partial index for locale-filtered similarity search", async () => {
  const result = await knex.raw(
    `EXPLAIN (FORMAT JSON)
     SELECT ee.experience_id,
       1 - (ee.embedding <=> ?::vector) AS similarity
     FROM experience_embeddings ee
     WHERE ee.locale = ?
     ORDER BY ee.embedding <=> ?::vector
     LIMIT 60`,
    [testEmbedding, "en", testEmbedding],
  )

  const plan = JSON.stringify(result.rows[0])
  expect(plan).toContain("Index Scan")
  expect(plan).toContain("experience_embeddings_hnsw_en")
  expect(plan).not.toContain("Seq Scan")
})
```

`EXPLAIN` (not `EXPLAIN ANALYZE`) only inspects the plan without executing — fast and safe for CI. If pgvector or PostgreSQL ever changes the planner behavior, this test fails before latency regresses in production.

### Documentation hygiene

Cross-reference this doc from any pgvector-related learning that recommends an HNSW index without discussing filter degradation. The four most relevant existing docs to refresh:

- `docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md` — section 5 ("Use HNSW over IVFFlat") should add a caveat about WHERE filter degradation.
- `docs/solutions/best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md` — the "45ms execution time...HNSW handles it efficiently" claim is true at 1,965 rows but degrades at scale.
- `docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md` — the experience_embeddings table doc should reference the partial-index strategy.

## Second proof-point (2026-04-20): VideoSceneLocale in apps/admin

PR #798 (R1 of admin migration playbook) adopted the same partial-HNSW-per-locale pattern for the new `video_scene_locale` table in `apps/admin`. The decision to mirror the pattern was pre-verified via this learning; the review phase surfaced no new planner surprises. Relevant artifacts:

- Schema: `apps/admin/prisma/migrations/0003_scene_embeddings/migration.sql` creates four partial indexes on `video_scene_locale.embedding`: one global fallback (`WHERE embedding IS NOT NULL`) plus per-locale variants for `en`, `es`, `fr`.
- Search path (to land in R4): will use the same `SET LOCAL hnsw.ef_search` pattern inside a Prisma `$transaction` as `apps/admin/src/services/experience.search.ts`.
- Same operational cliff: adding a fourth locale (e.g. `pt`) requires a follow-up migration to add `video_scene_locale_embedding_hnsw_pt`. The global fallback catches unknown locales but returns to seq-scan performance — fine for low-traffic locales, watchable via latency dashboards if a new locale becomes popular.

Two things this second application confirmed:

1. **The pattern ports cleanly across Prisma and Strapi.** Admin uses `Unsupported("vector(1536)")?` nullable columns with `::vector` raw-SQL casts; cms uses raw-SQL tables entirely outside Strapi's ORM. The partial-index shape (`WHERE embedding IS NOT NULL AND locale = '...'`) is identical in both DDL flavors.
2. **NULL-excluded partials compose with nullable columns correctly.** Both tables leave `embedding` nullable until a workflow populates it; the partial indexes only include rows where the embedding exists, so inserts without embeddings cost zero index maintenance.

Confidence in the pattern is now high enough to treat it as the default for any new `pgvector` column that will be filtered by another column of the same table. If you're adding a new vector table and there's any chance you'll filter by locale / status / type / owner / tenant, bake the per-filter partial indexes into the initial migration rather than waiting for the latency regression.

- `docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md` — the architectural search doc should mention HNSW filter performance as a known operational concern.
