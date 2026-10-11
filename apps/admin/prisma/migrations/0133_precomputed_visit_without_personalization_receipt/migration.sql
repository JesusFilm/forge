BEGIN;

-- Contextual recommendations and click analytics remain eligible without a
-- personalization receipt. Retain the nullable legacy column for old rows;
-- browser_unit_digest is the server-bound experiment identity for new visits.
ALTER TABLE recommendation_precomputed_visit
  DROP CONSTRAINT recommendation_precomputed_visit_shape_check;
ALTER TABLE recommendation_precomputed_visit
  ADD CONSTRAINT recommendation_precomputed_visit_shape_check CHECK (
    (eligibility = 'eligible' AND browser_unit_digest IS NOT NULL AND arm IS NOT NULL
      AND exclusion_reason IS NULL)
    OR (eligibility = 'excluded' AND arm IS NULL AND browser_unit_digest IS NULL AND consent_binding_digest IS NULL
      AND exclusion_reason IS NOT NULL AND delivery_result = 'not_attempted')
  );

COMMIT;
