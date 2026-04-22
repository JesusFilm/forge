-- Transcript embeddings (R2 of admin migration playbook).
--
-- Mirrors R1's scene_embeddings shape (0003) with one material
-- divergence: vectors are REUSED from apps/manager's
-- {assetId}/embeddings.json artifact rather than regenerated. Manager's
-- enrichment pipeline already calls the provider and stores vectors in
-- the artifact (apps/manager/src/services/embeddings.ts
-- `EmbeddingsResult.chunks[].embedding`); admin copies them verbatim.
-- Zero OpenRouter spend on R2 backfill.
--
-- Parent `video_transcript` carries artifact-level metadata
-- (model, dimensions, chunking strategy, generatedAt) keyed by
-- (video_edition_id, language). Child `video_transcript_chunk` carries
-- one row per chunk, with `language` denormalized from the parent so
-- per-language partial HNSW indexes filter on the same table — pgvector
-- bypasses HNSW when the WHERE filter column lives on a joined table.
-- See docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md.
--
-- `embedding` is NULL until the transcriptEmbeddingBackfill workflow
-- runs. Three per-language partial HNSW indexes cover the Phase 1
-- languages (en/es/fr); a global partial index catches unknown
-- languages. All partial indexes exclude NULL embeddings.

-- =============================================================================
-- video_transcript — per-edition, per-language artifact metadata
-- =============================================================================

CREATE TABLE "video_transcript" (
    "id"                TEXT         PRIMARY KEY,
    "video_edition_id"  TEXT         NOT NULL,
    "video_id"          TEXT         NOT NULL,
    "language"          TEXT         NOT NULL,
    "model"             TEXT         NOT NULL,
    "dimensions"        INTEGER      NOT NULL,
    "chunking_type"     TEXT         NOT NULL,
    "max_chunk_tokens"  INTEGER      NOT NULL,
    "overlap_tokens"    INTEGER      NOT NULL,
    "total_chunks"      INTEGER      NOT NULL,
    "total_tokens"      INTEGER      NOT NULL,
    "generated_at"      TIMESTAMPTZ  NOT NULL,
    "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "video_transcript_video_edition_id_fkey"
        FOREIGN KEY ("video_edition_id") REFERENCES "video_edition"("id") ON DELETE CASCADE,
    CONSTRAINT "video_transcript_video_id_fkey"
        FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "video_transcript_video_edition_id_language_key"
    ON "video_transcript"("video_edition_id", "language");

CREATE INDEX "video_transcript_video_id_idx"
    ON "video_transcript"("video_id");

CREATE INDEX "video_transcript_language_idx"
    ON "video_transcript"("language");

-- =============================================================================
-- video_transcript_chunk — per-chunk text + vector embedding
-- =============================================================================

CREATE TABLE "video_transcript_chunk" (
    "id"            TEXT             PRIMARY KEY,
    "transcript_id" TEXT             NOT NULL,
    "language"      TEXT             NOT NULL,
    "chunk_index"   INTEGER          NOT NULL,
    "chunk_id"      TEXT             NOT NULL,
    "text"          TEXT             NOT NULL,
    "token_count"   INTEGER          NOT NULL,
    "start_seconds" DOUBLE PRECISION,
    "end_seconds"   DOUBLE PRECISION,
    "embedding"     vector(1536),
    "model"         TEXT             NOT NULL DEFAULT 'text-embedding-3-small',
    "dimensions"    INTEGER          NOT NULL DEFAULT 1536,
    "created_at"    TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ      NOT NULL,
    CONSTRAINT "video_transcript_chunk_transcript_id_fkey"
        FOREIGN KEY ("transcript_id") REFERENCES "video_transcript"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "video_transcript_chunk_transcript_id_chunk_index_key"
    ON "video_transcript_chunk"("transcript_id", "chunk_index");

CREATE INDEX "video_transcript_chunk_language_idx"
    ON "video_transcript_chunk"("language");

-- HNSW partial indexes — NULL embeddings excluded. Global fallback for
-- languages outside Phase 1 (en/es/fr); per-language indexes accelerate
-- `WHERE language = ? ORDER BY embedding <=> ?` at scale.
CREATE INDEX "video_transcript_chunk_embedding_hnsw"
    ON "video_transcript_chunk" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL;

CREATE INDEX "video_transcript_chunk_embedding_hnsw_en"
    ON "video_transcript_chunk" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL AND "language" = 'en';

CREATE INDEX "video_transcript_chunk_embedding_hnsw_es"
    ON "video_transcript_chunk" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL AND "language" = 'es';

CREATE INDEX "video_transcript_chunk_embedding_hnsw_fr"
    ON "video_transcript_chunk" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL AND "language" = 'fr';
