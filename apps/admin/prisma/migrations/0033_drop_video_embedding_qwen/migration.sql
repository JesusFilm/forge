-- Forward-only revert of 0032_video_embedding_qwen.
--
-- Keep 0032 in the migration chain so production databases with a recorded
-- 0032 state can recover cleanly, then remove the Qwen-only artifacts from
-- the live schema to match the reverted Prisma schema.

DROP INDEX IF EXISTS "video_scene_locale_embedding_qwen_hnsw_fr";
DROP INDEX IF EXISTS "video_scene_locale_embedding_qwen_hnsw_es";
DROP INDEX IF EXISTS "video_scene_locale_embedding_qwen_hnsw_en";
DROP INDEX IF EXISTS "video_scene_locale_embedding_qwen_hnsw";

DROP INDEX IF EXISTS "video_transcript_chunk_embedding_qwen_hnsw_fr";
DROP INDEX IF EXISTS "video_transcript_chunk_embedding_qwen_hnsw_es";
DROP INDEX IF EXISTS "video_transcript_chunk_embedding_qwen_hnsw_en";
DROP INDEX IF EXISTS "video_transcript_chunk_embedding_qwen_hnsw";

ALTER TABLE "video_scene_locale" DROP COLUMN IF EXISTS "embedding_qwen";
ALTER TABLE "video_transcript_chunk" DROP COLUMN IF EXISTS "embedding_qwen";
