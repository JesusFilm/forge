-- Additive, default-incumbent manual authority for saved Watch recommendations.
-- This migration does not activate an A/B test or promote a generation.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE recommendation_precomputed_experiment
  DROP CONSTRAINT recommendation_precomputed_experiment_state_check;
ALTER TABLE recommendation_precomputed_experiment
  ADD CONSTRAINT recommendation_precomputed_experiment_state_check
  CHECK (state IN ('private_test', 'public_ready', 'closed'));
CREATE OR REPLACE FUNCTION recommendation_precomputed_experiment_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id, OLD.generation_id, OLD.control_manifest_id,
      OLD.challenger_manifest_id, OLD.control_manifest_digest, OLD.control_routing_digest,
      OLD.source_set_digest, OLD.assignment_policy_version,
      OLD.eligibility_policy_version, OLD.delivery_policy_version,
      OLD.configuration_digest, OLD.starts_at, OLD.ends_at, OLD.expires_at)
     IS DISTINCT FROM
     (NEW.id, NEW.generation_id, NEW.control_manifest_id,
      NEW.challenger_manifest_id, NEW.control_manifest_digest, NEW.control_routing_digest,
      NEW.source_set_digest, NEW.assignment_policy_version,
      NEW.eligibility_policy_version, NEW.delivery_policy_version,
      NEW.configuration_digest, NEW.starts_at, NEW.ends_at, NEW.expires_at)
  THEN
    RAISE EXCEPTION 'Precomputed experiment configuration is immutable';
  END IF;
  IF NEW.state <> OLD.state AND
     NOT (OLD.state IN ('private_test', 'public_ready') AND NEW.state = 'closed') THEN
    RAISE EXCEPTION 'Precomputed experiment state transition is invalid';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE recommendation_precomputed_visit
  DROP CONSTRAINT recommendation_precomputed_visit_qualification_check;
ALTER TABLE recommendation_precomputed_visit
  ADD CONSTRAINT recommendation_precomputed_visit_qualification_check
  CHECK (qualification IN (
    'unverified_browser', 'unknown_signal', 'declared_automation',
    'private_preview', 'fixture_human', 'verified_human'
  ));

CREATE TABLE recommendation_precomputed_public_control (
  id varchar(64) PRIMARY KEY CHECK (id = 'precomputed-watch-public-control'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  mode varchar(16) NOT NULL DEFAULT 'incumbent'
    CHECK (mode IN ('incumbent', 'ab', 'promoted')),
  active_experiment_id varchar(191)
    REFERENCES recommendation_precomputed_experiment(id) ON DELETE RESTRICT,
  retained_experiment_id varchar(191)
    REFERENCES recommendation_precomputed_experiment(id) ON DELETE RESTRICT,
  report_revision integer,
  report_evidence_digest char(64)
    CHECK (report_evidence_digest IS NULL OR report_evidence_digest ~ '^[a-f0-9]{64}$'),
  authority varchar(32)
    CHECK (authority IS NULL OR authority IN ('isolated_fixture', 'live_verified')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_precomputed_public_control_shape_check CHECK (
    (mode = 'incumbent' AND active_experiment_id IS NULL AND
      report_revision IS NULL AND report_evidence_digest IS NULL AND authority IS NULL)
    OR (mode = 'ab' AND active_experiment_id IS NOT NULL AND
      retained_experiment_id IS NULL AND report_revision IS NULL AND
      report_evidence_digest IS NULL AND authority IS NOT NULL)
    OR (mode = 'promoted' AND active_experiment_id IS NOT NULL AND
      retained_experiment_id IS NULL AND report_revision IS NOT NULL AND
      report_revision > 0 AND report_evidence_digest IS NOT NULL AND authority IS NOT NULL)
  )
);
INSERT INTO recommendation_precomputed_public_control (id)
VALUES ('precomputed-watch-public-control');

CREATE FUNCTION recommendation_precomputed_public_control_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Precomputed public control requires one version step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recommendation_precomputed_public_control_version_trigger
  BEFORE UPDATE ON recommendation_precomputed_public_control
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_public_control_version();

CREATE TABLE recommendation_precomputed_public_control_event (
  id uuid PRIMARY KEY,
  control_version integer NOT NULL UNIQUE CHECK (control_version > 1),
  action varchar(32) NOT NULL CHECK (action IN ('start', 'promote', 'rollback', 'release_retained')),
  actor_id varchar(191) NOT NULL,
  reason_code varchar(64),
  experiment_id varchar(191),
  generation_id text,
  report_revision integer,
  report_evidence_digest char(64)
    CHECK (report_evidence_digest IS NULL OR report_evidence_digest ~ '^[a-f0-9]{64}$'),
  authority varchar(32)
    CHECK (authority IS NULL OR authority IN ('isolated_fixture', 'live_verified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX recommendation_precomputed_public_control_event_expiry_idx
  ON recommendation_precomputed_public_control_event (expires_at, control_version);
CREATE FUNCTION recommendation_precomputed_public_control_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Precomputed public control audit is immutable';
END $$;
CREATE TRIGGER recommendation_precomputed_public_control_event_immutable_trigger
  BEFORE UPDATE ON recommendation_precomputed_public_control_event
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_public_control_event_immutable();

COMMIT;
