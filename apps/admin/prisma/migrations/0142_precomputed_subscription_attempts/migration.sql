-- Bounded provenance for explicitly started local subscription attempts.
-- Existing generations and one-source call receipts remain unattributed legacy.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_generation
  ADD COLUMN execution_backend text,
  ADD CONSTRAINT precomputed_generation_execution_backend_check
    CHECK (execution_backend IS NULL OR execution_backend = 'codex_chatgpt_subscription');

CREATE TABLE recommendation_precomputed_execution_attempt (
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  invocation text NOT NULL CHECK (invocation IN ('start', 'resume')),
  account_ref text NOT NULL CHECK (account_ref ~ '^[A-Za-z0-9:_-]{8,128}$'),
  backend text NOT NULL CHECK (backend = 'codex_chatgpt_subscription'),
  billing_basis text NOT NULL CHECK (billing_basis = 'included_subscription'),
  auth_method text NOT NULL CHECK (auth_method = 'chatgpt'),
  model_id text NOT NULL CHECK (model_id = 'gpt-6-astra'),
  identity_observed_at timestamp(3) NOT NULL,
  allowance_observed_at timestamp(3) NOT NULL,
  weekly_remaining_percent numeric(5,2) NOT NULL
    CHECK (weekly_remaining_percent BETWEEN 0 AND 100),
  five_hour_kind text NOT NULL CHECK (five_hour_kind IN ('limited', 'not_applicable')),
  five_hour_remaining_percent numeric(5,2)
    CHECK (five_hour_remaining_percent IS NULL OR five_hour_remaining_percent BETWEEN 0 AND 100),
  started_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at timestamp(3),
  end_reason text CHECK (end_reason IS NULL OR end_reason IN ('completed', 'paused', 'interrupted_by_manual_resume')),
  PRIMARY KEY (generation_id, attempt_id),
  CHECK ((five_hour_kind = 'limited' AND five_hour_remaining_percent IS NOT NULL) OR
         (five_hour_kind = 'not_applicable' AND five_hour_remaining_percent IS NULL)),
  CHECK ((ended_at IS NULL AND end_reason IS NULL) OR
         (ended_at IS NOT NULL AND end_reason IS NOT NULL AND ended_at >= started_at))
);
CREATE UNIQUE INDEX precomputed_one_open_execution_attempt_idx
  ON recommendation_precomputed_execution_attempt (generation_id)
  WHERE ended_at IS NULL;

ALTER TABLE recommendation_precomputed_model_call
  ADD COLUMN attempt_id uuid;
ALTER TABLE recommendation_precomputed_model_call
  ADD CONSTRAINT precomputed_model_call_execution_attempt_fk
  FOREIGN KEY (generation_id, attempt_id)
  REFERENCES recommendation_precomputed_execution_attempt(generation_id, attempt_id)
  ON DELETE RESTRICT NOT VALID;

COMMIT;
RESET lock_timeout;
RESET statement_timeout;
