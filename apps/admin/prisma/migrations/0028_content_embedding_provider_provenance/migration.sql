-- Add internal content-embedding provider provenance for the AI Gateway
-- migration. Nullable columns preserve existing vectors and do not change
-- pgvector dimensions, indexes, GraphQL exposure, or public search contracts.

ALTER TABLE "video_transcript"
  ADD COLUMN "embedding_provider" text,
  ADD COLUMN "embedding_native_dimensions" integer,
  ADD COLUMN "embedding_transform_version" text;

ALTER TABLE "video_scene_locale"
  ADD COLUMN "embedding_provider" text,
  ADD COLUMN "embedding_native_dimensions" integer,
  ADD COLUMN "embedding_transform_version" text;

ALTER TABLE "experience_locale"
  ADD COLUMN "embedding_native_dimensions" integer,
  ADD COLUMN "embedding_transform_version" text;

-- Preserve idempotent legacy ingest semantics for rows that already existed
-- before provider provenance was introduced. Legacy OpenAI rows were 1536
-- native/final dimensions with no transform.
UPDATE "video_transcript"
SET
  "embedding_provider" = CASE
    WHEN "model" IN ('openai/text-embedding-3-small', 'text-embedding-3-small') THEN 'openai'
    ELSE "embedding_provider"
  END,
  "embedding_native_dimensions" = "dimensions"
WHERE "embedding_provider" IS NULL
  AND "embedding_transform_version" IS NULL;

UPDATE "video_scene_locale"
SET
  "embedding_provider" = CASE
    WHEN "model" IN ('openai/text-embedding-3-small', 'text-embedding-3-small') THEN 'openai'
    ELSE "embedding_provider"
  END,
  "embedding_native_dimensions" = "dimensions"
WHERE "embedding_provider" IS NULL
  AND "embedding_transform_version" IS NULL;

UPDATE "experience_locale"
SET "embedding_native_dimensions" = "embedding_dimensions"
WHERE "embedding_native_dimensions" IS NULL
  AND "embedding_dimensions" IS NOT NULL
  AND "embedding_transform_version" IS NULL;
