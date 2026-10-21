-- Add the explicitly selected Sol identity; retain every historical model/receipt.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_execution_attempt
  DROP CONSTRAINT recommendation_precomputed_execution_attempt_model_id_check,
  ADD CONSTRAINT recommendation_precomputed_execution_attempt_model_id_check
    CHECK (model_id IN ('gpt-6-astra', 'gpt-6.1-sol')) NOT VALID;
ALTER TABLE recommendation_precomputed_execution_attempt
  VALIDATE CONSTRAINT recommendation_precomputed_execution_attempt_model_id_check;

ALTER TABLE recommendation_precomputed_edge_batch_call
  DROP CONSTRAINT recommendation_precomputed_edge_batch_call_model_id_check,
  ADD CONSTRAINT recommendation_precomputed_edge_batch_call_model_id_check
    CHECK (model_id IN ('gpt-6-astra', 'gpt-6.1-sol')) NOT VALID;
ALTER TABLE recommendation_precomputed_edge_batch_call
  VALIDATE CONSTRAINT recommendation_precomputed_edge_batch_call_model_id_check;

COMMIT;
RESET lock_timeout;
RESET statement_timeout;
