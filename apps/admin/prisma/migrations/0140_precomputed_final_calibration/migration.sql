-- An independently signed final-horizon receipt is append-only and retained
-- only while its frozen experiment remains retained.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE recommendation_precomputed_final_calibration (
  experiment_id varchar(191) PRIMARY KEY
    REFERENCES recommendation_precomputed_experiment(id) ON DELETE CASCADE,
  generation_id text NOT NULL,
  configuration_digest char(64) NOT NULL
    CHECK (configuration_digest ~ '^[a-f0-9]{64}$'),
  policy_digest char(64) NOT NULL
    CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  final_at timestamptz NOT NULL,
  source_id varchar(191) NOT NULL,
  source_run_id varchar(191) NOT NULL,
  key_id varchar(191) NOT NULL,
  public_key_digest char(64) NOT NULL
    CHECK (public_key_digest ~ '^[a-f0-9]{64}$'),
  assertion varchar(8192) NOT NULL,
  assertion_digest char(64) NOT NULL
    CHECK (assertion_digest ~ '^[a-f0-9]{64}$'),
  loss_upper_bound double precision NOT NULL
    CHECK (loss_upper_bound >= 0 AND loss_upper_bound <= 1),
  observed_at timestamptz NOT NULL,
  actor_id varchar(191) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (starts_at < ends_at AND ends_at <= final_at),
  CHECK (expires_at > created_at)
);
CREATE INDEX precomputed_final_calibration_expiry_idx
  ON recommendation_precomputed_final_calibration (expires_at);

CREATE FUNCTION recommendation_precomputed_final_calibration_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Precomputed final calibration is immutable';
END $$;
CREATE TRIGGER recommendation_precomputed_final_calibration_immutable_trigger
  BEFORE UPDATE ON recommendation_precomputed_final_calibration
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_final_calibration_immutable();

COMMIT;
