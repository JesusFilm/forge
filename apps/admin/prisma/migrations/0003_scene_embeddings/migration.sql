-- Scene embeddings (R1 of admin migration playbook).
--
-- Port of apps/cms's scene_embeddings multimodal analysis table. Scenes
-- attach to VideoEdition (timecodes follow the edition's cut, matching
-- the VideoSubtitle pattern). Per-locale descriptions + embeddings live
-- on VideoSceneLocale so semantic search matches the user's language
-- without leaning on multilingual-embedding-model approximation.
--
-- Source data comes from apps/manager's multimodal scene analysis
-- pipeline ({assetId}/scene-analysis.json in Railway S3). Embeddings
-- are regenerated in admin (vectors are not cached in S3); regeneration
-- cost is <$0.01 at current catalog scale, so we trade cost for schema
-- independence from cms's incompatible table shape.
--
-- `embedding` is NULL until the sceneEmbeddingBackfill workflow runs.
-- Partial HNSW index excludes NULLs. Per-locale partial indexes exist
-- in addition to the global partial index because pgvector's planner
-- bypasses HNSW when a WHERE predicate is present on the same table —
-- see docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md.
-- The global index catches unknown locales; per-locale indexes
-- accelerate `WHERE locale = ?` queries at scale.

-- =============================================================================
-- video_scene — language-agnostic scene timecodes + chapter metadata
-- =============================================================================

CREATE TABLE "video_scene" (
    "id"               TEXT             PRIMARY KEY,
    "video_edition_id" TEXT             NOT NULL,
    "video_id"         TEXT             NOT NULL,
    "scene_index"      INTEGER          NOT NULL,
    "start_seconds"    DOUBLE PRECISION NOT NULL,
    "end_seconds"      DOUBLE PRECISION,
    "chapter_title"    TEXT,
    "created_at"       TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ      NOT NULL,
    CONSTRAINT "video_scene_video_edition_id_fkey"
        FOREIGN KEY ("video_edition_id") REFERENCES "video_edition"("id") ON DELETE CASCADE,
    CONSTRAINT "video_scene_video_id_fkey"
        FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "video_scene_video_edition_id_scene_index_key"
    ON "video_scene"("video_edition_id", "scene_index");

CREATE INDEX "video_scene_video_id_idx"
    ON "video_scene"("video_id");

-- =============================================================================
-- video_scene_locale — per-locale description + embedding
-- =============================================================================

CREATE TABLE "video_scene_locale" (
    "id"                TEXT         PRIMARY KEY,
    "video_scene_id"    TEXT         NOT NULL,
    "locale"            TEXT         NOT NULL,
    "source_text"       TEXT         NOT NULL,
    "description"       TEXT         NOT NULL,
    "themes"            TEXT[]       NOT NULL DEFAULT '{}',
    "bible_verses"      TEXT[]       NOT NULL DEFAULT '{}',
    "demographics"      TEXT[]       NOT NULL DEFAULT '{}',
    "spiritual_context" TEXT[]       NOT NULL DEFAULT '{}',
    "embedding"         vector(1536),
    "model"             TEXT         NOT NULL DEFAULT 'text-embedding-3-small',
    "dimensions"        INTEGER      NOT NULL DEFAULT 1536,
    "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "video_scene_locale_video_scene_id_fkey"
        FOREIGN KEY ("video_scene_id") REFERENCES "video_scene"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "video_scene_locale_video_scene_id_locale_key"
    ON "video_scene_locale"("video_scene_id", "locale");

CREATE INDEX "video_scene_locale_locale_idx"
    ON "video_scene_locale"("locale");

-- HNSW partial indexes — NULL embeddings excluded. Global fallback for
-- locales outside Phase 1 (en/es/fr); per-locale indexes accelerate
-- `WHERE locale = ? ORDER BY embedding <=> ?` at scale.
CREATE INDEX "video_scene_locale_embedding_hnsw"
    ON "video_scene_locale" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL;

CREATE INDEX "video_scene_locale_embedding_hnsw_en"
    ON "video_scene_locale" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL AND "locale" = 'en';

CREATE INDEX "video_scene_locale_embedding_hnsw_es"
    ON "video_scene_locale" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL AND "locale" = 'es';

CREATE INDEX "video_scene_locale_embedding_hnsw_fr"
    ON "video_scene_locale" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL AND "locale" = 'fr';
