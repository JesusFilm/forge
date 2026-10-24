ALTER TABLE "video_transcript"
  ADD COLUMN IF NOT EXISTS "source_artifact_key" TEXT,
  ADD COLUMN IF NOT EXISTS "source_content_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "source_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "source_generated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "generation_mode" TEXT,
  ADD COLUMN IF NOT EXISTS "mastra_run_id" TEXT,
  ADD COLUMN IF NOT EXISTS "chunking_version" TEXT;

-- Plain B-tree indexes match the Prisma schema's @@index declarations. This
-- transcript metadata table is small enough for the repo's existing
-- non-concurrent migration style; keep this represented in schema.prisma so
-- future Prisma diffs do not treat the indexes as drift.
CREATE INDEX IF NOT EXISTS "video_transcript_source_content_hash_idx"
  ON "video_transcript"("source_content_hash");

CREATE INDEX IF NOT EXISTS "video_transcript_mastra_run_id_idx"
  ON "video_transcript"("mastra_run_id");
