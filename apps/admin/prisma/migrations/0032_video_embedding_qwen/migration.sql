-- Content embeddings gateway migration (U2).
--
-- Adds a PARALLEL `embedding_qwen vector(1536)` column to the two
-- video-content embedding tables — `video_scene_locale` and
-- `video_transcript_chunk` — alongside the existing `embedding` column.
-- This is purely additive and forward-only: the existing `embedding`
-- column and its HNSW indexes are untouched, so the live OpenAI-vector
-- search path keeps working while the Jesus Film AI Gateway (Qwen) vectors
-- are backfilled into the new column behind a source toggle.
--
-- The new per-locale (en/es/fr) + global-fallback partial HNSW indexes
-- mirror the existing `embedding` indexes EXACTLY (same `vector_cosine_ops`
-- ops class, same per-locale/per-language WHERE predicates, same
-- NULL-exclusion) so the Qwen retrieval path inherits the same planner
-- behavior — including the per-locale guard against pgvector's
-- "HNSW + WHERE locale = ?" planner bypass.
-- See docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md.
--
-- `experience_locale` is deliberately OUT OF SCOPE for this migration.
-- The `vector` extension is already installed (the existing `embedding`
-- columns use it); do NOT re-create it.
--
-- Railway Postgres has constrained shared memory. pgvector's HNSW index
-- builder reserves maintenance_work_mem even when this additive column is still
-- NULL for all rows, so keep the build below the default 64MB segment request.
SET maintenance_work_mem = '16MB';

-- =============================================================================
-- video_scene_locale — parallel Qwen embedding column + per-locale HNSW
-- =============================================================================

ALTER TABLE "video_scene_locale" ADD COLUMN "embedding_qwen" vector(1536);

-- HNSW partial indexes — NULL embeddings excluded. Global fallback for
-- locales outside Phase 1 (en/es/fr); per-locale indexes accelerate
-- `WHERE locale = ? ORDER BY embedding_qwen <=> ?` at scale.
CREATE INDEX IF NOT EXISTS "video_scene_locale_embedding_qwen_hnsw"
    ON "video_scene_locale" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "video_scene_locale_embedding_qwen_hnsw_en"
    ON "video_scene_locale" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL AND "locale" = 'en';

CREATE INDEX IF NOT EXISTS "video_scene_locale_embedding_qwen_hnsw_es"
    ON "video_scene_locale" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL AND "locale" = 'es';

CREATE INDEX IF NOT EXISTS "video_scene_locale_embedding_qwen_hnsw_fr"
    ON "video_scene_locale" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL AND "locale" = 'fr';

-- =============================================================================
-- video_transcript_chunk — parallel Qwen embedding column + per-language HNSW
-- =============================================================================

ALTER TABLE "video_transcript_chunk" ADD COLUMN "embedding_qwen" vector(1536);

-- HNSW partial indexes — NULL embeddings excluded. Global fallback for
-- languages outside Phase 1 (en/es/fr); per-language indexes accelerate
-- `WHERE language = ? ORDER BY embedding_qwen <=> ?` at scale.
CREATE INDEX IF NOT EXISTS "video_transcript_chunk_embedding_qwen_hnsw"
    ON "video_transcript_chunk" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "video_transcript_chunk_embedding_qwen_hnsw_en"
    ON "video_transcript_chunk" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL AND "language" = 'en';

CREATE INDEX IF NOT EXISTS "video_transcript_chunk_embedding_qwen_hnsw_es"
    ON "video_transcript_chunk" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL AND "language" = 'es';

CREATE INDEX IF NOT EXISTS "video_transcript_chunk_embedding_qwen_hnsw_fr"
    ON "video_transcript_chunk" USING hnsw ("embedding_qwen" vector_cosine_ops)
    WHERE "embedding_qwen" IS NOT NULL AND "language" = 'fr';
