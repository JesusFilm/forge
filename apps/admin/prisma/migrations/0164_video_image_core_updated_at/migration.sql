-- Carry Core's own `updatedAt` for each image row so incremental Core sync
-- can detect an image edit whose parent video wasn't touched, instead of
-- relying on the parent video's updatedAt to gate the nested images query.
ALTER TABLE "video_image"
  ADD COLUMN IF NOT EXISTS "core_updated_at" TIMESTAMP(3);
