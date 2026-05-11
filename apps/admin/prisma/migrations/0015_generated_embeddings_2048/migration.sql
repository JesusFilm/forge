-- Generated admin embeddings now use OpenRouter's free NVIDIA model, which
-- returns 2048-dimensional vectors. Existing generated vectors were 1536
-- dimensions and cannot be cast to 2048 without changing their meaning, so
-- drop them and let the embedding backfill regenerate.
--
-- Transcript chunk embeddings intentionally stay vector(1536) because admin
-- copies those vectors from manager artifacts instead of generating them.

DROP INDEX IF EXISTS "experience_locale_embedding_hnsw";

DROP INDEX IF EXISTS "video_scene_locale_embedding_hnsw";
DROP INDEX IF EXISTS "video_scene_locale_embedding_hnsw_en";
DROP INDEX IF EXISTS "video_scene_locale_embedding_hnsw_es";
DROP INDEX IF EXISTS "video_scene_locale_embedding_hnsw_fr";

ALTER TABLE "experience_locale"
ALTER COLUMN "embedding" TYPE vector(2048)
USING NULL::vector(2048);

ALTER TABLE "video_scene_locale"
ALTER COLUMN "embedding" TYPE vector(2048)
USING NULL::vector(2048);

ALTER TABLE "video_scene_locale"
ALTER COLUMN "model" SET DEFAULT 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
ALTER COLUMN "dimensions" SET DEFAULT 2048;

UPDATE "video_scene_locale"
SET
  "model" = 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
  "dimensions" = 2048;
