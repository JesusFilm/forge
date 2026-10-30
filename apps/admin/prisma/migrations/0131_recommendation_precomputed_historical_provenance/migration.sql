-- History is an optional private build input. Existing content-only rows stay valid.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_generation
  ADD COLUMN historical_provenance jsonb;
ALTER TABLE recommendation_precomputed_generation
  DROP CONSTRAINT recommendation_precomputed_generation_input_mode_check;
ALTER TABLE recommendation_precomputed_generation
  ADD CONSTRAINT recommendation_precomputed_generation_input_mode_check
  CHECK (input_mode IN ('fixture', 'content_only', 'historical_fixture', 'historical_analytics'));

COMMIT;
RESET lock_timeout;
RESET statement_timeout;
