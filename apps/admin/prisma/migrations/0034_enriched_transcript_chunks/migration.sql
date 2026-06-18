-- Enriched transcript semantic search v2.
--
-- Add nullable/source-defaulted fields so existing transcript embeddings remain
-- readable while new Mastra transcript runs can store the structured metadata
-- that used to live only in scene evidence.

ALTER TABLE "video_transcript"
  ADD COLUMN "source_kind" TEXT,
  ADD COLUMN "source_language_id" TEXT,
  ADD COLUMN "source_language_slug" TEXT,
  ADD COLUMN "source_subtitle_id" TEXT,
  ADD COLUMN "source_format" TEXT,
  ADD COLUMN "source_url" TEXT;

ALTER TABLE "video_transcript_chunk"
  ADD COLUMN "raw_source_text" TEXT,
  ADD COLUMN "embedding_input_text" TEXT,
  ADD COLUMN "felt_needs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "bible_verses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "content_summary" TEXT,
  ADD COLUMN "tone" TEXT,
  ADD COLUMN "demographics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "spiritual_context" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "extraction_metadata" JSONB;

CREATE INDEX "video_transcript_source_kind_idx"
  ON "video_transcript"("source_kind");

CREATE INDEX "video_transcript_source_language_id_idx"
  ON "video_transcript"("source_language_id");
