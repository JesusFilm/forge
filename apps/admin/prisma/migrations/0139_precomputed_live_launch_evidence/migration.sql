-- Default-off launch evidence. A completed build keeps its original capacity
-- preflight; refreshes for live traffic are separate, append-only receipts.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE recommendation_precomputed_experiment
  ADD COLUMN live_evidence jsonb;

CREATE OR REPLACE FUNCTION recommendation_precomputed_experiment_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id, OLD.generation_id, OLD.control_manifest_id,
      OLD.challenger_manifest_id, OLD.control_manifest_digest, OLD.control_routing_digest,
      OLD.source_set_digest, OLD.assignment_policy_version,
      OLD.eligibility_policy_version, OLD.delivery_policy_version,
      OLD.configuration_digest, OLD.live_evidence, OLD.starts_at, OLD.ends_at, OLD.expires_at)
     IS DISTINCT FROM
     (NEW.id, NEW.generation_id, NEW.control_manifest_id,
      NEW.challenger_manifest_id, NEW.control_manifest_digest, NEW.control_routing_digest,
      NEW.source_set_digest, NEW.assignment_policy_version,
      NEW.eligibility_policy_version, NEW.delivery_policy_version,
      NEW.configuration_digest, NEW.live_evidence, NEW.starts_at, NEW.ends_at, NEW.expires_at)
  THEN
    RAISE EXCEPTION 'Precomputed experiment configuration is immutable';
  END IF;
  IF NEW.state <> OLD.state AND
     NOT (OLD.state IN ('private_test', 'public_ready') AND NEW.state = 'closed') THEN
    RAISE EXCEPTION 'Precomputed experiment state transition is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE recommendation_precomputed_launch_capacity_receipt (
  id uuid PRIMARY KEY,
  generation_id text NOT NULL,
  actor_id varchar(191) NOT NULL,
  measurement jsonb NOT NULL,
  receipt_digest char(64) NOT NULL CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
  status varchar(16) NOT NULL CHECK (status IN ('passed', 'insufficient')),
  measured_at timestamptz NOT NULL,
  observed_db_bytes bigint NOT NULL CHECK (observed_db_bytes >= 0),
  projected_bytes bigint NOT NULL CHECK (projected_bytes >= 0),
  available_after_reserve_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX precomputed_launch_capacity_generation_idx
  ON recommendation_precomputed_launch_capacity_receipt (generation_id, created_at DESC);
CREATE INDEX precomputed_launch_capacity_expiry_idx
  ON recommendation_precomputed_launch_capacity_receipt (expires_at);
CREATE FUNCTION recommendation_precomputed_launch_capacity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Precomputed launch capacity receipt is immutable';
END $$;
CREATE TRIGGER recommendation_precomputed_launch_capacity_immutable_trigger
  BEFORE UPDATE ON recommendation_precomputed_launch_capacity_receipt
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_launch_capacity_immutable();

COMMIT;
