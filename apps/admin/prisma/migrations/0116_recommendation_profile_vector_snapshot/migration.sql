-- Additive, unrevised storage for exact content-only profile medoid vectors.
-- Existing inline vectors remain readable; no retained row is rewritten.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

CREATE TABLE "recommendation_profile_vector_snapshot" (
  "digest" char(64) PRIMARY KEY,
  "embedding" vector(1536) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recommendation_profile_vector_snapshot_digest_check"
    CHECK ("digest" ~ '^[a-f0-9]{64}$')
);

CREATE FUNCTION "prevent_recommendation_profile_vector_snapshot_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'profile vector snapshots are immutable';
END;
$$;

CREATE TRIGGER "recommendation_profile_vector_snapshot_immutable"
BEFORE UPDATE ON "recommendation_profile_vector_snapshot" FOR EACH ROW
EXECUTE FUNCTION "prevent_recommendation_profile_vector_snapshot_update"();

ALTER TABLE "recommendation_profile_interest"
  ALTER COLUMN "embedding" DROP NOT NULL,
  ADD COLUMN "vector_digest" char(64);

ALTER TABLE "recommendation_profile_interest"
  ADD CONSTRAINT "recommendation_profile_interest_vector_shape_check"
    CHECK (("embedding" IS NULL) <> ("vector_digest" IS NULL)) NOT VALID,
  ADD CONSTRAINT "recommendation_profile_interest_vector_digest_fkey"
    FOREIGN KEY ("vector_digest")
    REFERENCES "recommendation_profile_vector_snapshot"("digest")
    ON DELETE RESTRICT NOT VALID;

CREATE INDEX "recommendation_profile_interest_vector_digest_idx"
  ON "recommendation_profile_interest"("vector_digest")
  WHERE "vector_digest" IS NOT NULL;

COMMIT;
