-- Preserve all original unknown usage and immutable acknowledgements. Permit
-- one replacement per reviewed incident, including seven calls in one catalog.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;
ALTER TABLE recommendation_precomputed_edge_batch_call
  ADD CONSTRAINT precomputed_edge_reviewed_recovery_scope_check CHECK (
    recovery_replacement_call_id IS NULL OR
    (generation_id = 'subscription-astra-budget2-20261008-v4'
      AND call_id = '8ab8a620-1608-4115-812e-200bb2fb4b6d'::uuid) OR
    (generation_id = 'production-astra-catalog-20261013-v6'
      AND call_id IN ('0f532ef1-3358-42b8-859b-61957633f591'::uuid,'16540542-b0cd-4000-a1cf-300c11f5d721'::uuid,'1b52ddfd-6ec9-48c8-b87f-1f290c2e8125'::uuid,'1c9be609-c76c-4828-8934-6e976ca135ce'::uuid,'23b3b0a0-af22-4f40-b499-790d84a3cb2c'::uuid,'6cf1da28-020c-4ad2-9572-3bc4c91af9d5'::uuid,'beeba49b-0f6f-4d70-87c0-4d36a9e81f16'::uuid))
  );
DROP INDEX precomputed_edge_recovery_replacement_idx;
CREATE UNIQUE INDEX precomputed_edge_recovery_replacement_idx
  ON recommendation_precomputed_edge_batch_call(generation_id, recovery_replacement_call_id)
  WHERE recovery_replacement_call_id IS NOT NULL;
COMMIT;
RESET lock_timeout;
RESET statement_timeout;
