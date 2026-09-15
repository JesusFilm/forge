-- Formal review follow-up: preserve immutable projection evidence while making
-- privacy/retention foreign-key cleanup executable on already-applied U19/U30
-- schemas. No serving authority or traffic is changed.

CREATE OR REPLACE FUNCTION "prevent_recommendation_profile_projection_child_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The qualified contribution remains immutable. PostgreSQL may clear only
  -- its direct source FK when the already-expired/raw outcome is purged. The
  -- one-way source digest and every bounded evidence field remain unchanged.
  IF TG_TABLE_NAME = 'recommendation_profile_projection_contribution'
    AND OLD."source_outcome_id" IS NOT NULL
    AND NEW."source_outcome_id" IS NULL
    AND (to_jsonb(NEW) - 'source_outcome_id')
      IS NOT DISTINCT FROM (to_jsonb(OLD) - 'source_outcome_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published profile projection children are immutable';
END;
$$;

ALTER TABLE "recommendation_profile_projection_run"
  DROP CONSTRAINT "recommendation_profile_projection_run_terminal_check",
  ADD CONSTRAINT "recommendation_profile_projection_run_terminal_check" CHECK (
    (
      "state" = 'completed'
      AND "completed_at" IS NOT NULL
      AND "failure_reason" IS NULL
    )
    OR (
      "state" IN ('failed', 'fenced')
      AND "completed_at" IS NOT NULL
      AND "failure_reason" IS NOT NULL
    )
    OR "state" IN ('pending', 'claimed')
  );

COMMENT ON COLUMN "recommendation_outcome_revision"."learning_eligible" IS
  'Compatibility field fixed false on immutable outcomes. Current learning eligibility is derived only from the current recommendation_eligibility_decision revision.';
COMMENT ON COLUMN "recommendation_content_action"."learning_eligible" IS
  'Compatibility field fixed false at ingestion. Current learning eligibility is derived only from the current recommendation_eligibility_decision revision.';
COMMENT ON COLUMN "recommendation_profile_projection_run"."projection_id" IS
  'Published generation lineage while retained; privacy/retention deletion may detach this FK without rewriting terminal workflow truth.';
