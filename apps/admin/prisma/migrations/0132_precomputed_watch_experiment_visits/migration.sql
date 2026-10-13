-- Private, fixed-cohort Watch test. No public serving or experiment pointer changes.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE recommendation_precomputed_experiment (
  id varchar(191) PRIMARY KEY,
  generation_id text NOT NULL REFERENCES recommendation_precomputed_generation(id) ON DELETE RESTRICT,
  control_manifest_id varchar(191) NOT NULL REFERENCES recommendation_strategy_manifest(id) ON DELETE RESTRICT,
  challenger_manifest_id varchar(191) NOT NULL REFERENCES recommendation_strategy_manifest(id) ON DELETE RESTRICT,
  control_manifest_digest char(64) NOT NULL CHECK (control_manifest_digest ~ '^[a-f0-9]{64}$'),
  control_routing_digest char(64) NOT NULL CHECK (control_routing_digest ~ '^[a-f0-9]{64}$'),
  source_set_digest char(64) NOT NULL CHECK (source_set_digest ~ '^[a-f0-9]{64}$'),
  assignment_policy_version varchar(64) NOT NULL,
  eligibility_policy_version varchar(64) NOT NULL,
  delivery_policy_version varchar(64) NOT NULL,
  configuration_digest char(64) NOT NULL CHECK (configuration_digest ~ '^[a-f0-9]{64}$'),
  state varchar(32) NOT NULL DEFAULT 'private_test' CHECK (state IN ('private_test', 'closed')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT recommendation_precomputed_experiment_window_check
    CHECK (starts_at < ends_at AND expires_at >= ends_at),
  CONSTRAINT recommendation_precomputed_experiment_challenger_check
    CHECK (challenger_manifest_id = 'precomputed-watch-preview-v1')
);
CREATE UNIQUE INDEX recommendation_precomputed_experiment_one_private_idx
  ON recommendation_precomputed_experiment(state) WHERE state = 'private_test';
CREATE INDEX recommendation_precomputed_experiment_window_idx
  ON recommendation_precomputed_experiment(state, starts_at, ends_at);
CREATE INDEX recommendation_precomputed_experiment_expiry_idx
  ON recommendation_precomputed_experiment(expires_at);

CREATE FUNCTION recommendation_precomputed_experiment_freeze() RETURNS trigger
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
  IF OLD.state = 'closed' AND NEW.state <> 'closed' THEN
    RAISE EXCEPTION 'Closed precomputed experiment cannot reopen';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recommendation_precomputed_experiment_freeze_trigger
  BEFORE UPDATE ON recommendation_precomputed_experiment
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_experiment_freeze();

CREATE TABLE recommendation_precomputed_visit (
  id uuid PRIMARY KEY,
  experiment_id varchar(191) NOT NULL REFERENCES recommendation_precomputed_experiment(id) ON DELETE RESTRICT,
  browser_unit_digest char(64) CHECK (browser_unit_digest IS NULL OR browser_unit_digest ~ '^[a-f0-9]{64}$'),
  consent_binding_digest char(64) CHECK (consent_binding_digest IS NULL OR consent_binding_digest ~ '^[a-f0-9]{64}$'),
  source_video_id varchar(191) NOT NULL,
  locale varchar(32) NOT NULL,
  audio_language_slug varchar(64) NOT NULL,
  eligibility varchar(24) NOT NULL CHECK (eligibility IN ('eligible', 'excluded')),
  qualification varchar(40) NOT NULL CHECK (qualification IN ('unverified_browser', 'unknown_signal', 'declared_automation', 'private_preview')),
  exclusion_reason varchar(64),
  arm "RecommendationExperimentArm",
  delivery_result varchar(32) NOT NULL DEFAULT 'not_attempted'
    CHECK (delivery_result IN ('not_attempted', 'served', 'fallback', 'empty', 'unavailable')),
  actual_strategy varchar(64),
  delivery_request_id varchar(191),
  fallback_reason varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT recommendation_precomputed_visit_shape_check CHECK (
    (eligibility = 'eligible' AND browser_unit_digest IS NOT NULL AND consent_binding_digest IS NOT NULL AND arm IS NOT NULL
      AND exclusion_reason IS NULL)
    OR (eligibility = 'excluded' AND arm IS NULL AND browser_unit_digest IS NULL AND consent_binding_digest IS NULL
      AND exclusion_reason IS NOT NULL AND delivery_result = 'not_attempted')
  ),
  CONSTRAINT recommendation_precomputed_visit_retention_check
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '29 days')
);
CREATE INDEX recommendation_precomputed_visit_report_idx
  ON recommendation_precomputed_visit(experiment_id, eligibility, arm, created_at);
CREATE INDEX recommendation_precomputed_visit_expiry_idx
  ON recommendation_precomputed_visit(expires_at, id);

CREATE TABLE recommendation_precomputed_visit_request (
  request_id varchar(191) PRIMARY KEY REFERENCES recommendation_request(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES recommendation_precomputed_visit(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '29 days')
);
CREATE INDEX recommendation_precomputed_visit_request_visit_idx
  ON recommendation_precomputed_visit_request(visit_id, created_at);
CREATE INDEX recommendation_precomputed_visit_request_expiry_idx
  ON recommendation_precomputed_visit_request(expires_at);

COMMIT;
