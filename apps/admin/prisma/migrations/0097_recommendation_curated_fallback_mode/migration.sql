BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE recommendation_personalization_decision
  DROP CONSTRAINT recommendation_personalization_execution_mode_check,
  ADD CONSTRAINT recommendation_personalization_execution_mode_check CHECK (
    execution_mode IS NULL OR
    (lane = 'semantic_control' AND execution_mode = 'semantic_contextual') OR
    (lane = 'profile_challenger' AND execution_mode = 'hybrid_personalized') OR
    (lane = 'semantic_fallback' AND execution_mode IN ('semantic_fallback', 'curated_fallback'))
  ) NOT VALID;

ALTER TABLE recommendation_personalization_decision
  VALIDATE CONSTRAINT recommendation_personalization_execution_mode_check;
COMMIT;
