CREATE TABLE "recommendation_curated_generation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "version" VARCHAR(128) NOT NULL UNIQUE,
  "source_digest" CHAR(64) NOT NULL,
  "validation_version" VARCHAR(96) NOT NULL,
  "source_manifest" JSONB NOT NULL,
  "coverage_report" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sealed_at" TIMESTAMP(3)
);

CREATE TABLE "recommendation_curated_pool" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generation_id" TEXT NOT NULL REFERENCES "recommendation_curated_generation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "locale" VARCHAR(35) NOT NULL,
  "audio_language_slug" VARCHAR(191) NOT NULL,
  "core_language_id" VARCHAR(191) NOT NULL,
  "pool_key" VARCHAR(64) NOT NULL,
  "video_ids" TEXT[] NOT NULL,
  CONSTRAINT "recommendation_curated_pool_size_check" CHECK (cardinality("video_ids") BETWEEN 0 AND 512),
  CONSTRAINT "recommendation_curated_pool_context_key" UNIQUE ("generation_id", "locale", "audio_language_slug", "pool_key")
);

CREATE TABLE "recommendation_curated_membership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generation_id" TEXT NOT NULL REFERENCES "recommendation_curated_generation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "video_id" VARCHAR(191) NOT NULL,
  "core_video_id" VARCHAR(191) NOT NULL,
  "theme_keys" TEXT[] NOT NULL,
  "editorial_rank" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL,
  CONSTRAINT "recommendation_curated_membership_video_key" UNIQUE ("generation_id", "video_id"),
  CONSTRAINT "recommendation_curated_membership_rank_check" CHECK ("editorial_rank" BETWEEN 1 AND 512),
  CONSTRAINT "recommendation_curated_membership_themes_check" CHECK (cardinality("theme_keys") <= 8)
);

CREATE TABLE "recommendation_curated_pointer" (
  "id" VARCHAR(96) NOT NULL PRIMARY KEY,
  "generation_id" TEXT NOT NULL REFERENCES "recommendation_curated_generation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "previous_generation_id" TEXT REFERENCES "recommendation_curated_generation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recommendation_curated_pointer_identity_check" CHECK ("id" = 'watch-user-curated-pools-v1'),
  CONSTRAINT "recommendation_curated_pointer_revision_check" CHECK ("revision" > 0)
);

-- A generation is assembled and sealed within one transaction. Historical
-- content and its report cannot be edited after sealing or after publication.
CREATE FUNCTION recommendation_curated_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.sealed_at IS NOT NULL THEN
      RAISE EXCEPTION 'sealed curated generation is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.sealed_at IS NOT NULL
     OR NEW.sealed_at IS NULL
     OR (to_jsonb(NEW) - 'sealed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'sealed_at') THEN
    RAISE EXCEPTION 'curated generation only permits its first seal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommendation_curated_generation_immutable
BEFORE UPDATE OR DELETE ON recommendation_curated_generation
FOR EACH ROW EXECUTE FUNCTION recommendation_curated_generation_immutable();

CREATE FUNCTION recommendation_curated_child_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_generation TEXT;
  sealed TIMESTAMP(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_generation := NEW.generation_id;
  ELSE
    target_generation := OLD.generation_id;
  END IF;
  SELECT sealed_at INTO sealed FROM recommendation_curated_generation
    WHERE id = target_generation FOR SHARE;
  IF sealed IS NOT NULL THEN
    RAISE EXCEPTION 'sealed curated generation membership is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.generation_id IS DISTINCT FROM OLD.generation_id THEN
    RAISE EXCEPTION 'curated generation membership cannot move';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommendation_curated_pool_immutable
BEFORE INSERT OR UPDATE OR DELETE ON recommendation_curated_pool
FOR EACH ROW EXECUTE FUNCTION recommendation_curated_child_immutable();

CREATE TRIGGER recommendation_curated_membership_immutable
BEFORE INSERT OR UPDATE OR DELETE ON recommendation_curated_membership
FOR EACH ROW EXECUTE FUNCTION recommendation_curated_child_immutable();

CREATE FUNCTION recommendation_curated_pointer_validated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM recommendation_curated_generation
    WHERE id = NEW.generation_id AND sealed_at IS NOT NULL
      AND validation_version = 'curated-admin-eligibility-v1'
      AND coverage_report->>'passed' = 'true'
  ) THEN
    RAISE EXCEPTION 'curated serving pointer requires a sealed passing generation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recommendation_curated_pointer_validated
BEFORE INSERT OR UPDATE ON recommendation_curated_pointer
FOR EACH ROW EXECUTE FUNCTION recommendation_curated_pointer_validated();
