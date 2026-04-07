---
id: "feat-041"
title: "Video Vectorization — Scene Embeddings Table + Indexing"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-05-11"
duration: 7
depends_on:
  - "feat-009"
  - "feat-040"
blocks:
  - "feat-042"
  - "feat-044"
  - "feat-045"
tags:
  - "cms"
  - "pgvector"
---

## Problem

Scene descriptions need to be embedded and stored in pgvector for similarity queries. This requires a new `scene_embeddings` table (separate from feat-009's `video_embeddings`) and an indexing service.

## Entry Points — Read These First

1. `apps/cms/src/bootstrap.ts` or `apps/cms/src/index.ts` — where pgvector extension and tables are created (feat-009 pattern)
2. `apps/manager/src/services/embeddings.ts` — existing text embedding pipeline
3. `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md` — full schema in Storage Schema section

## Grep These

- `video_embeddings` in `apps/cms/src/` — feat-009 table creation pattern to follow
- `strapi.db.connection.raw` in `apps/cms/src/` — raw SQL execution pattern

## What To Build

1. **Bootstrap SQL** — add to CMS bootstrap alongside feat-009's table:

   ```sql
   CREATE TABLE IF NOT EXISTS scene_embeddings (
     id            SERIAL PRIMARY KEY,
     video_id      INTEGER NOT NULL,
     core_id       TEXT,
     mux_asset_id  TEXT NOT NULL,
     playback_id   TEXT NOT NULL,
     scene_index   INTEGER NOT NULL,
     start_seconds FLOAT NOT NULL,
     end_seconds   FLOAT,
     description   TEXT NOT NULL,              -- concatenated extraction (all signals) — embedded
     themes        TEXT[] DEFAULT '{}',        -- felt needs: {"forgiveness","redemption","grief"}
     bible_verses  TEXT[] DEFAULT '{}',        -- {"Matthew 6:14-15","Ephesians 4:32"}
     demographics  TEXT[] DEFAULT '{}',        -- {"youth","student"} — may be empty
     chapter_title TEXT,
     embedding     vector(1536) NOT NULL,
     model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',
     language      TEXT NOT NULL DEFAULT 'en',
     created_at    TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(video_id, scene_index)
   );

   CREATE INDEX IF NOT EXISTS scene_embeddings_hnsw
     ON scene_embeddings USING hnsw (embedding vector_cosine_ops);
   CREATE INDEX IF NOT EXISTS scene_embeddings_video_id
     ON scene_embeddings(video_id);
   CREATE INDEX IF NOT EXISTS scene_embeddings_language
     ON scene_embeddings(language);
   ```

2. **Indexing service**: `apps/cms/src/api/scene-embedding/services/indexer.ts`
   - Accept scene descriptions + embeddings + video metadata
   - Upsert rows (delete existing for video_id + insert within transaction)
   - Return count indexed

## Constraints

- Follow exact same pattern as feat-009 for raw SQL in Strapi
- HNSW index, not IVFFlat
- Table name may need adjustment based on Strapi's actual `videos` table name

## Verification

- `\d scene_embeddings` shows table with vector(1536) column
- Insert test data → HNSW index used in EXPLAIN ANALYZE of similarity query
- Upsert is idempotent — re-indexing same video replaces rows
