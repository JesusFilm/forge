-- Superseded Qwen video embedding migration.
--
-- This migration name was previously introduced by the reverted Qwen rollout.
-- Keep the migration present so Prisma can recover production migration
-- history for 0032_video_embedding_qwen without replaying the original HNSW
-- index build. The next migration, 0033_drop_video_embedding_qwen, removes any
-- Qwen columns or indexes that already exist from a successful or partial 0032.

SELECT 1;
