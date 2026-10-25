-- An expired request can cascade through its eligibility decision while a
-- published projection contribution still has its own retention lifetime.
-- The FK clears source_eligibility_decision_id; clear its companion revision
-- in that same RI-triggered update so the exact-pair CHECK remains valid.
-- Preserve the retained digest/observation and every other immutable field.
CREATE OR REPLACE FUNCTION "prevent_recommendation_profile_projection_child_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'recommendation_profile_projection_contribution' THEN
    IF OLD."source_outcome_id" IS NOT NULL
      AND NEW."source_outcome_id" IS NULL
      AND (to_jsonb(NEW) - 'source_outcome_id')
        IS NOT DISTINCT FROM (to_jsonb(OLD) - 'source_outcome_id') THEN
      RETURN NEW;
    END IF;

    IF pg_trigger_depth() > 1
      AND OLD."source_eligibility_decision_id" IS NOT NULL
      AND NEW."source_eligibility_decision_id" IS NULL
      AND NEW."source_eligibility_revision"
        IS NOT DISTINCT FROM OLD."source_eligibility_revision"
      AND (to_jsonb(NEW) - ARRAY[
        'source_eligibility_decision_id', 'source_eligibility_revision'
      ]) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[
        'source_eligibility_decision_id', 'source_eligibility_revision'
      ])
      AND NOT EXISTS (
        SELECT 1 FROM "recommendation_eligibility_decision"
        WHERE "id" = OLD."source_eligibility_decision_id"
      ) THEN
      NEW."source_eligibility_revision" := NULL;
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'published profile projection children are immutable';
END;
$$;
