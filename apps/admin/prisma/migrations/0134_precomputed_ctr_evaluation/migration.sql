-- Compact, bounded experiment evidence. Every child is removed with its
-- frozen experiment after the ordinary 365-day configuration horizon.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

-- A request issued immediately before raw visit expiry may outlive the visit.
-- This 16-byte marker keeps its private provenance after the thin link cascades,
-- so a later selection can never silently become ordinary public evidence.
ALTER TABLE recommendation_request ADD COLUMN private_precomputed_visit_id uuid;
UPDATE recommendation_request request
SET private_precomputed_visit_id = link.visit_id
FROM recommendation_precomputed_visit_request link
WHERE link.request_id = request.id;
CREATE FUNCTION recommendation_precomputed_mark_private_request() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_expiry timestamptz;
  visit_expiry timestamptz;
BEGIN
  SELECT expires_at INTO request_expiry FROM recommendation_request WHERE id = NEW.request_id;
  SELECT expires_at INTO visit_expiry FROM recommendation_precomputed_visit WHERE id = NEW.visit_id;
  IF request_expiry IS NULL OR visit_expiry IS NULL OR request_expiry < visit_expiry
     OR NEW.expires_at > request_expiry OR NEW.expires_at > visit_expiry THEN
    RAISE EXCEPTION 'Private request must outlive its raw visit and link';
  END IF;
  UPDATE recommendation_request
  SET private_precomputed_visit_id = NEW.visit_id
  WHERE id = NEW.request_id
    AND (private_precomputed_visit_id IS NULL OR private_precomputed_visit_id = NEW.visit_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private precomputed request visit conflict';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recommendation_precomputed_mark_private_request_trigger
  AFTER INSERT ON recommendation_precomputed_visit_request
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_mark_private_request();

CREATE TABLE recommendation_precomputed_ctr_policy (
  experiment_id varchar(191) PRIMARY KEY REFERENCES recommendation_precomputed_experiment(id) ON DELETE CASCADE,
  version varchar(64) NOT NULL,
  method varchar(64) NOT NULL CHECK (method = 'fixed-horizon-cluster-delta-t-v1'),
  settings jsonb NOT NULL,
  late_event_cutoff_hours integer NOT NULL CHECK (late_event_cutoff_hours BETWEEN 0 AND 672),
  settings_digest char(64) NOT NULL CHECK (settings_digest ~ '^[a-f0-9]{64}$'),
  authority varchar(32) NOT NULL CHECK (authority IN ('fixture_only', 'prelaunch_agreed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendation_precomputed_ctr_archived_visit (
  visit_id uuid PRIMARY KEY,
  experiment_id varchar(191) NOT NULL REFERENCES recommendation_precomputed_experiment(id) ON DELETE CASCADE
);
CREATE INDEX recommendation_precomputed_ctr_archived_visit_experiment_idx
  ON recommendation_precomputed_ctr_archived_visit(experiment_id);

CREATE TABLE recommendation_precomputed_ctr_cluster (
  experiment_id varchar(191) NOT NULL REFERENCES recommendation_precomputed_experiment(id) ON DELETE CASCADE,
  browser_unit_digest char(64) NOT NULL CHECK (browser_unit_digest ~ '^[a-f0-9]{64}$'),
  arm "RecommendationExperimentArm" NOT NULL,
  eligible_visits bigint NOT NULL DEFAULT 0 CHECK (eligible_visits >= 0),
  clicked_visits bigint NOT NULL DEFAULT 0 CHECK (clicked_visits >= 0 AND clicked_visits <= eligible_visits),
  PRIMARY KEY (experiment_id, browser_unit_digest)
);

CREATE TABLE recommendation_precomputed_ctr_totals (
  experiment_id varchar(191) NOT NULL REFERENCES recommendation_precomputed_experiment(id) ON DELETE CASCADE,
  arm varchar(16) NOT NULL CHECK (arm IN ('control', 'challenger', 'excluded')),
  eligible_visits bigint NOT NULL DEFAULT 0 CHECK (eligible_visits >= 0),
  clicked_visits bigint NOT NULL DEFAULT 0 CHECK (clicked_visits >= 0 AND clicked_visits <= eligible_visits),
  accepted_selections bigint NOT NULL DEFAULT 0 CHECK (accepted_selections >= 0),
  qualified_impressions bigint NOT NULL DEFAULT 0 CHECK (qualified_impressions >= 0),
  matched_selections bigint NOT NULL DEFAULT 0 CHECK (matched_selections >= 0),
  served_visits bigint NOT NULL DEFAULT 0 CHECK (served_visits >= 0),
  empty_visits bigint NOT NULL DEFAULT 0 CHECK (empty_visits >= 0),
  unavailable_visits bigint NOT NULL DEFAULT 0 CHECK (unavailable_visits >= 0),
  not_attempted_visits bigint NOT NULL DEFAULT 0 CHECK (not_attempted_visits >= 0),
  actual_fallback_visits bigint NOT NULL DEFAULT 0 CHECK (actual_fallback_visits >= 0),
  private_recovery_attempt_visits bigint NOT NULL DEFAULT 0 CHECK (private_recovery_attempt_visits >= 0),
  unlinked_delivered_visits bigint NOT NULL DEFAULT 0 CHECK (unlinked_delivered_visits >= 0),
  excluded_automation bigint NOT NULL DEFAULT 0 CHECK (excluded_automation >= 0),
  excluded_preview bigint NOT NULL DEFAULT 0 CHECK (excluded_preview >= 0),
  excluded_unknown bigint NOT NULL DEFAULT 0 CHECK (excluded_unknown >= 0),
  excluded_outside_cohort bigint NOT NULL DEFAULT 0 CHECK (excluded_outside_cohort >= 0),
  excluded_other bigint NOT NULL DEFAULT 0 CHECK (excluded_other >= 0),
  unversioned_archived_visits bigint NOT NULL DEFAULT 0 CHECK (unversioned_archived_visits >= 0),
  PRIMARY KEY (experiment_id, arm)
);

CREATE TABLE recommendation_precomputed_ctr_report (
  experiment_id varchar(191) NOT NULL REFERENCES recommendation_precomputed_experiment(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 33),
  policy_digest char(64) NOT NULL CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest char(64) NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  as_of timestamptz NOT NULL,
  is_final boolean NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_precomputed_ctr_final_slot_check CHECK (revision <> 33 OR is_final),
  PRIMARY KEY (experiment_id, revision)
);
CREATE UNIQUE INDEX recommendation_precomputed_ctr_one_final_idx
  ON recommendation_precomputed_ctr_report(experiment_id) WHERE is_final;

CREATE FUNCTION recommendation_precomputed_ctr_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Precomputed CTR policy and report revisions are immutable';
END $$;
CREATE TRIGGER recommendation_precomputed_ctr_policy_immutable_trigger
  BEFORE UPDATE ON recommendation_precomputed_ctr_policy
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_ctr_immutable();
CREATE TRIGGER recommendation_precomputed_ctr_report_immutable_trigger
  BEFORE UPDATE ON recommendation_precomputed_ctr_report
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_ctr_immutable();

-- The compact UUID-only marker survives raw visit expiry. It blocks an old
-- client navigation UUID from creating a second denominator contribution.
CREATE FUNCTION recommendation_precomputed_ctr_reject_archived_visit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recommendation_precomputed_ctr_archived_visit WHERE visit_id = NEW.id) THEN
    RAISE EXCEPTION 'Archived precomputed visit cannot be re-admitted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recommendation_precomputed_ctr_reject_archived_visit_trigger
  BEFORE INSERT ON recommendation_precomputed_visit
  FOR EACH ROW EXECUTE FUNCTION recommendation_precomputed_ctr_reject_archived_visit();

COMMIT;
