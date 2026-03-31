---
id: "feat-009"
title: "pgvector Setup and Embedding Indexing"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-04-07"
duration: 14
depends_on:
  - "feat-002"
blocks:
  - "feat-010"
tags:
  - "cms"
  - "pgvector"
  - "infrastructure"
---

## Entry Points — Read These First

1. `apps/manager/src/services/embeddings.ts` — `EmbeddingsResult` type: `{ model: string, dimensions: number, chunks: Array<{ text: string, embedding: number[] }> }`. Dimensions = 1536, model = `text-embedding-3-small`.
2. `apps/manager/src/services/storage.ts` — `downloadArtifact(assetId, 'embeddings.json')` to read existing embeddings
3. `apps/cms/config/database.ts` — Strapi database configuration (PostgreSQL on Railway)
4. `apps/cms/src/api/core-sync/services/` — look at any file here for raw SQL patterns using `strapi.db.connection.raw()`

## Grep These

- `strapi.db.connection` in `apps/cms/src/` — how to execute raw SQL in Strapi
- `dimensions` in `apps/manager/src/services/embeddings.ts` — confirms 1536
- `text-embedding-3-small` in `apps/manager/src/services/embeddings.ts` — model name
- `bootstrap` in `apps/cms/src/` — lifecycle hook for running setup SQL

## What To Build

1. Enable pgvector extension — add to Strapi bootstrap (`apps/cms/src/bootstrap.ts` or `apps/cms/src/index.ts`):

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

2. Create embeddings table via bootstrap SQL (not a Strapi content type — vector columns aren't supported by Strapi's ORM):

   ```sql
   CREATE TABLE IF NOT EXISTS video_embeddings (
     id SERIAL PRIMARY KEY,
     video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
     chunk_index INTEGER NOT NULL,
     chunk_text TEXT NOT NULL,
     embedding vector(1536) NOT NULL,
     model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
     created_at TIMESTAMP DEFAULT NOW(),
     UNIQUE(video_id, chunk_index)
   );

   CREATE INDEX IF NOT EXISTS video_embeddings_embedding_idx
     ON video_embeddings USING hnsw (embedding vector_cosine_ops);
   ```

3. Indexing service — new file: `apps/cms/src/api/embedding/services/indexer.ts`

   ```typescript
   export async function indexVideoEmbeddings(
     videoId: number,
     assetId: string,
   ): Promise<{ chunksIndexed: number }>
   ```

   - Download `embeddings.json` from S3 for the given asset
   - Upsert rows into `video_embeddings` (delete existing + insert, within a transaction)
   - Return chunk count

4. Batch indexing endpoint — `POST /api/embeddings/index-all` that iterates all videos with enrichment artifacts and indexes them. For initial backfill.

5. Hook into enrichment completion — after Vlad's metadata sync step, trigger embedding indexing. This can be a webhook or direct call.

## Constraints

- Do NOT use a Strapi content type for embeddings. pgvector columns don't work with Strapi's ORM. Use raw SQL.
- Do NOT store embeddings as JSON in a Strapi field. They must be in a proper vector column for nearest-neighbor queries.
- Railway PostgreSQL supports pgvector — verify with `SELECT * FROM pg_extension WHERE extname = 'vector'` after enabling.
- HNSW index, not IVFFlat — better for incremental inserts (no need to rebuild).
- The `videos` table name may differ in Strapi — check with `SELECT tablename FROM pg_tables WHERE tablename LIKE '%video%'` to find the actual table name.

## Verification

- `SELECT * FROM pg_extension WHERE extname = 'vector'` → returns vector extension
- `\d video_embeddings` → shows table with vector(1536) column
- Run `indexVideoEmbeddings(videoId, assetId)` for a test video → rows inserted
- ```sql
  SELECT v.id, ve.chunk_text, ve.embedding <=> '[query_vector]' AS distance
  FROM video_embeddings ve JOIN videos v ON v.id = ve.video_id
  ORDER BY distance LIMIT 5;
  ```
  → returns 5 nearest chunks
