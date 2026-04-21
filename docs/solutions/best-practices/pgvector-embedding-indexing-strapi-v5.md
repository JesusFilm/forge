---
title: "pgvector Setup and Embedding Indexing in Strapi v5"
problem_type: best_practice
component: database
root_cause: missing_tooling
resolution_type: tooling_addition
severity: high
date: "2026-04-07"
features:
  - "feat-009"
  - "feat-041"
tags:
  - pgvector
  - embeddings
  - vector-search
  - strapi
  - postgresql
  - raw-sql
  - hnsw
  - batch-insert
  - jsonb-array-cast
module: cms
key_files:
  - "apps/cms/src/bootstrap/ensure-pgvector.ts"
  - "apps/cms/src/api/embedding/services/indexer.ts"
  - "apps/cms/src/api/embedding/controllers/embedding.ts"
  - "apps/cms/src/api/scene-embedding/services/indexer.ts"
  - "apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts"
  - "apps/cms/src/index.ts"
related:
  - "docs/solutions/cms/core-sync-bulk-update-temp-table-pattern.md"
  - "docs/solutions/performance-issues/strapi-language-cache-raw-sql-bypass-cms-manager-20260403.md"
  - "docs/solutions/platform/multimodal-scene-analysis-pipeline.md"
  - "docs/solutions/best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md"
  - "docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md"
  - "docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md"
last_updated: "2026-04-15"
---

## Problem

Strapi v5's ORM does not support pgvector's `vector(1536)` column type, but the video content vectorization pipeline requires storing and querying high-dimensional embeddings in PostgreSQL with HNSW indexes. Two tables are needed: `transcript_embeddings` (transcript chunks) and `scene_embeddings` (multimodal scene analysis with metadata arrays).

## What Didn't Work

### 1. Hand-rolled PostgreSQL array literals

Initial implementation built text array syntax via string interpolation:

```typescript
// WRONG — vulnerable to injection and malformed arrays
;`{${themes.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`
```

Backslash escaping was incomplete. Values containing `"}`, commas, or literal backslashes could break the array boundary or produce corrupt data.

### 2. Sequential INSERTs in a loop

One INSERT per row, one round-trip per iteration:

```typescript
// WRONG — 500 round-trips for 500 chunks
for (const chunk of chunks) {
  await trx.raw(`INSERT INTO transcript_embeddings ... VALUES (?, ?, ?)`, [...])
}
```

500 round-trips within a transaction causes latency and connection pool strain, especially on Railway where app and DB are separate containers.

### 3. No bootstrap error handling

`CREATE EXTENSION IF NOT EXISTS vector` with no try/catch crashed Strapi on environments without pgvector (local dev, CI). Table DDL with FK references to `videos` also crashed if Strapi hadn't created content-type tables yet.

### 4. No input validation

Controllers checked only "is it an array" — no dimension checks, no finite number validation, no required field checks, no duplicate key detection. Invalid data silently hit the DB and produced opaque 500 errors.

## Solution

### Bootstrap: `ensure-pgvector.ts`

Nested try/catch — one for extension, one for DDL:

```typescript
try {
  await knex.raw("CREATE EXTENSION IF NOT EXISTS vector")
} catch (err) {
  strapi.log.warn(`[pgvector] Extension not available: ${err}`)
  return // Strapi boots without embedding features
}

try {
  await knex.raw(`CREATE TABLE IF NOT EXISTS transcript_embeddings (...)`)
  await knex.raw(`CREATE TABLE IF NOT EXISTS scene_embeddings (...)`)
  // HNSW indexes, B-tree indexes
} catch (err) {
  strapi.log.warn(`[pgvector] Table creation failed: ${err}`)
}
```

### Safe array casting: `?::jsonb::text[]`

```typescript
// CORRECT — PostgreSQL safely parses JSON, then casts to text[]
JSON.stringify(scene.themes ?? []) // binding value
// in SQL: ?::jsonb::text[]
```

PostgreSQL's JSON parser handles all escaping; the cast is atomic. No string interpolation involved.

### Batch multi-row INSERT

```typescript
const BATCH_SIZE = 50 // 5 params/row × 50 = 250 (< 65535 PG limit)

for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
  const batch = chunks.slice(offset, offset + BATCH_SIZE)
  const placeholders: string[] = []
  const bindings: unknown[] = []

  for (const chunk of batch) {
    placeholders.push("(?, ?, ?, ?::vector, ?)")
    bindings.push(
      videoId,
      chunkIndex,
      chunk.text,
      JSON.stringify(chunk.embedding),
      model,
    )
  }

  await trx.raw(
    `INSERT INTO transcript_embeddings (...) VALUES ${placeholders.join(", ")}`,
    bindings,
  )
}
```

Scene embeddings use batch size 30 (15 params/row × 30 = 450). Delete uses `WHERE video_id = ANY(?::int[])` for all affected videos in one statement.

### Controller validation

```typescript
// Embedding dimension + finiteness
chunk.embedding.length !== 1536 ||
  !chunk.embedding.every((v) => Number.isFinite(v))

// Duplicate (videoId, sceneIndex) detection
const seen = new Set<string>()
const key = `${scene.videoId}:${scene.sceneIndex}`
if (seen.has(key)) {
  /* return 400 */
}

// Max batch sizes: 500 chunks, 500 scenes
// Required field checks on every scene object
// FK violations caught → 404 instead of 500
// Stats endpoints → 503 if tables don't exist
```

## Why This Works

1. **Raw SQL tables** sidestep Strapi's ORM limitation — pgvector columns work natively in PostgreSQL, and `strapi.db.connection` (knex) provides direct access.
2. **PG array literal with `?::text[]`** is a parameterized cast — immune to injection. Note: the original `?::jsonb::text[]` approach does not work on PostgreSQL 18+. Use `toPgArray()` helper (see `scene-embedding/services/indexer.ts`).
3. **Multi-row VALUES** reduces round-trips from N to ceil(N/batch_size) while staying under PostgreSQL's 65535 parameter limit.
4. **Graceful degradation** allows Strapi to boot without pgvector — embedding endpoints return 503, everything else works.
5. **Delete-then-insert in transactions** makes re-indexing idempotent — no duplicates, atomic rollback on failure.

## Prevention

### 1. Never interpolate PostgreSQL array or vector literals

```typescript
// Always use parameterized casts
toPgArray(array) → ?::text[]              // for text arrays (PG 18+ compatible)
JSON.stringify(array) → ?::vector         // for vectors
// NOTE: JSON.stringify(array) → ?::jsonb::text[] does NOT work on PG 18+
```

### 2. Calculate batch size from parameter count

```
params_per_row × batch_size < 65535
```

Add 20% safety margin for future column additions. Current values: 50 (5-col table), 30 (15-col table).

### 3. Wrap bootstrap DDL in try/catch

Extension and table creation can fail for many reasons (missing extension, missing FK target table, permissions). Always degrade gracefully — log and continue.

### 4. Validate at the API boundary, not in the service

Controllers should reject invalid data before touching the database. Check: embedding dimensions, finite numbers, required fields, duplicate keys, max batch sizes.

### 5. Use HNSW over IVFFlat for incremental inserts

HNSW doesn't require periodic rebuilds. IVFFlat index quality degrades as data is added without rebuilding.

**Caveat — filtered queries**: a global HNSW index works only for _unfiltered_ nearest-neighbour queries. The moment you add `WHERE column = ?` on the indexed table (e.g., `WHERE locale = ?`), pgvector's planner cost model gets the answer wrong and silently picks Seq Scan + Top-N Sort instead of HNSW. The fix is per-locale (or per-filter-value) **partial HNSW indexes** plus the `hnsw.iterative_scan = relaxed_order` GUC at connection level. See [pgvector HNSW index bypassed by planner when WHERE filter on indexed table](../performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md) for the empirical comparison and the production fix shipped in PR #777.

### 6. Both embedding tables need FK CASCADE

`video_id REFERENCES videos(id) ON DELETE CASCADE` on both tables prevents orphaned embeddings when videos are deleted.

### 7. See the query-time companion doc for read patterns

This doc covers the **write** side (bootstrap, indexing, batch INSERT). For **read** patterns (cosine similarity queries, locale-aware filtering, DISTINCT ON dedup, parent-child exclusion, custom GraphQL resolvers), see [pgvector Recommendation Query API](pgvector-recommendation-query-locale-graphql-strapi-v5.md).

### 8. Keep storage scope aligned with retrieval grain

For PR sequencing and table naming decisions across transcript, scene, and future video profile vectors, see [Vector embedding storage scope and PR sequencing](vector-embedding-storage-scope-sequencing-2026-04-11.md).
