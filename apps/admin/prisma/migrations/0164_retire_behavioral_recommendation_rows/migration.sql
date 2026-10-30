-- Release B: keep the retired schema compatible while a separately admitted
-- operator drains its rows. Release A must already serve on every Admin role.
-- No data is deleted by this migration.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

-- The retirement operator detaches historical experiment exposure before
-- deleting its profile. Keep the live privacy FK action unchanged. A detached
-- profile unit must stay fenced, never relabelled as an anonymous session.
ALTER TABLE recommendation_experiment_assignment
  ADD CONSTRAINT recommendation_experiment_assignment_retirement_privacy_check
  CHECK (
    (unit_kind = 'anonymous_session' AND profile_id IS NULL AND privacy_generation IS NULL)
    OR (unit_kind = 'anonymous_profile' AND profile_id IS NOT NULL AND privacy_generation > 0)
    OR (unit_kind = 'anonymous_profile' AND profile_id IS NULL AND privacy_generation IS NULL
      AND state = 'fenced' AND fenced_at IS NOT NULL
      AND fence_reason IS NOT NULL)
  ) NOT VALID;
ALTER TABLE recommendation_experiment_assignment
  DROP CONSTRAINT recommendation_experiment_assignment_privacy_check;

-- A paired shadow detachment preserves composition observations. Every other
-- mutation retains the original fencing behavior.
CREATE OR REPLACE FUNCTION fence_composition_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.projection_profile_id IS NOT NULL
    AND NEW.projection_profile_id IS NULL AND NEW.privacy_generation IS NULL
    AND (to_jsonb(NEW) - 'projection_profile_id' - 'privacy_generation')
      IS NOT DISTINCT FROM
        (to_jsonb(OLD) - 'projection_profile_id' - 'privacy_generation')
  THEN RETURN NEW; END IF;
  IF NEW.state <> 'published' OR NEW.generation <> OLD.generation
    OR NEW.request_id <> OLD.request_id OR NEW.evaluation_id <> OLD.evaluation_id
    OR NEW.projection_profile_id IS DISTINCT FROM OLD.projection_profile_id
    OR NEW.privacy_generation IS DISTINCT FROM OLD.privacy_generation
    OR NEW.context_projection_digest IS DISTINCT FROM OLD.context_projection_digest
    OR NEW.context_projection_ref IS DISTINCT FROM OLD.context_projection_ref
    OR NEW.context_projection_version <> OLD.context_projection_version
    OR NEW.sampling_digest <> OLD.sampling_digest OR NEW.sample_ordinal <> OLD.sample_ordinal
    OR NEW.eligibility_version <> OLD.eligibility_version
    OR NEW.retention_policy_version <> OLD.retention_policy_version
    OR NEW.expires_at < OLD.expires_at
  THEN DELETE FROM recommendation_composition_observation WHERE run_id = OLD.id; END IF;
  RETURN NEW;
END $$;
-- Preserve existing FK delete actions for live profile withdrawal and ordinary
-- expiry. The retirement operator itself refuses implicit cascades/set-null.

-- Behavioral products are retired. Their old row guards would reject the
-- owner's approved drain or recreate co-watch suppression from retained raw
-- episodes. Remove the triggers at schema level, never via session settings.
DROP TRIGGER cowatch_source_changed ON recommendation_cowatch_source_contribution;
DROP TRIGGER cowatch_pair_changed ON recommendation_cowatch_contribution;
DROP TRIGGER cowatch_edge_changed ON recommendation_cowatch_edge;
DROP TRIGGER cowatch_profile_changed ON recommendation_profile;
DROP TRIGGER cowatch_suppression_immutable ON recommendation_cowatch_suppression;
DROP TRIGGER cowatch_authority_immutable ON recommendation_cowatch_trial_authority;
DROP TRIGGER cowatch_refresh_attempt_immutable ON recommendation_cowatch_refresh_attempt;
DROP TRIGGER cowatch_refresh_grant_immutable ON recommendation_cowatch_refresh_grant;
DROP TRIGGER cowatch_generation_removed ON recommendation_cowatch_generation;

-- A distinct receipt is necessary: workflow_run and retention_run do not
-- uniquely identify an acknowledged retirement page after a lost COMMIT reply.
CREATE TABLE recommendation_behavioral_retirement_batch (
  batch_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  phase varchar(80) NOT NULL,
  deleted_count integer NOT NULL CHECK (deleted_count >= 0 AND deleted_count <= 100),
  updated_count integer NOT NULL CHECK (updated_count >= 0 AND updated_count <= 100),
  CONSTRAINT recommendation_behavioral_retirement_one_action_check
    CHECK (deleted_count = 0 OR updated_count = 0),
  source_commit char(40) NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT recommendation_behavioral_retirement_operation_sequence_key
    UNIQUE (operation_id, sequence)
);
CREATE INDEX recommendation_behavioral_retirement_operation_idx
  ON recommendation_behavioral_retirement_batch(operation_id, committed_at);

COMMIT;
