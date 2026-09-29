-- Additive, inactive protocol and aggregate authority. No enrollment or activation.
SET lock_timeout = '2s';
SET statement_timeout = '15s';
-- Preserve the legacy audit contract. Only the exact new study policy has the
-- shorter predeclared raw-evidence horizon; neither branch extends retention.
ALTER TABLE recommendation_experiment DROP CONSTRAINT recommendation_experiment_retention_check;
ALTER TABLE recommendation_experiment ADD CONSTRAINT recommendation_experiment_retention_check CHECK (
  CASE WHEN evaluation_policy_version = 'profile-study-governance-v1'
    THEN retention_days = 29 AND expires_at < starts_at + interval '29 days'
    ELSE retention_days = 365 END
);
ALTER TABLE recommendation_experiment_evaluation DROP CONSTRAINT recommendation_experiment_evaluation_retention_check;
ALTER TABLE recommendation_experiment_evaluation ADD CONSTRAINT recommendation_experiment_evaluation_retention_check CHECK (
  CASE WHEN evaluation_policy_version = 'profile-study-governance-v1'
    THEN retention_days = 29 AND expires_at < window_start + interval '29 days'
    ELSE retention_days = 365 END
);

CREATE TABLE recommendation_study (
  experiment_id varchar(191) PRIMARY KEY REFERENCES recommendation_experiment(id) ON DELETE CASCADE,
  protocol jsonb NOT NULL CHECK (jsonb_typeof(protocol) = 'object'),
  protocol_digest char(64) NOT NULL CHECK (protocol_digest ~ '^[a-f0-9]{64}$'),
  prepared_by_id varchar(191) NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  activation_id uuid UNIQUE,
  activation_input_digest char(64) CHECK (activation_input_digest ~ '^[a-f0-9]{64}$'),
  activated_at timestamptz,
  enrolled_count integer NOT NULL DEFAULT 0 CHECK (enrolled_count >= 0),
  privacy_revision integer NOT NULL DEFAULT 0 CHECK (privacy_revision >= 0),
  expires_at timestamptz NOT NULL,
  CHECK ((activation_id IS NULL) = (activated_at IS NULL) AND (activation_id IS NULL) = (activation_input_digest IS NULL))
);
CREATE INDEX recommendation_study_expires_at_idx ON recommendation_study(expires_at);
CREATE TABLE recommendation_study_evidence (
  id uuid PRIMARY KEY,
  study_id varchar(191) NOT NULL REFERENCES recommendation_study(experiment_id) ON DELETE CASCADE,
  protocol_digest char(64) NOT NULL CHECK (protocol_digest ~ '^[a-f0-9]{64}$'),
  kind varchar(32) NOT NULL CHECK (kind IN ('readiness','outcomes')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  input_digest char(64) NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  reviewed_by_id varchar(191) NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX recommendation_study_evidence_study_id_reviewed_at_idx ON recommendation_study_evidence(study_id, reviewed_at);
CREATE INDEX recommendation_study_evidence_expires_at_idx ON recommendation_study_evidence(expires_at);
CREATE TABLE recommendation_study_evaluation (
  evaluation_id text PRIMARY KEY REFERENCES recommendation_experiment_evaluation(id) ON DELETE CASCADE,
  study_id varchar(191) NOT NULL REFERENCES recommendation_study(experiment_id) ON DELETE CASCADE,
  protocol_digest char(64) NOT NULL CHECK (protocol_digest ~ '^[a-f0-9]{64}$'),
  experiment_generation integer NOT NULL CHECK (experiment_generation > 0),
  privacy_revision integer NOT NULL CHECK (privacy_revision >= 0),
  published_by_id varchar(191) NOT NULL,
  evidence_id uuid NOT NULL REFERENCES recommendation_study_evidence(id) ON DELETE CASCADE,
  mode varchar(32) NOT NULL CHECK (mode IN ('calibration','efficacy')),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX recommendation_study_evaluation_study_id_idx ON recommendation_study_evaluation(study_id);
CREATE INDEX recommendation_study_evaluation_expires_at_idx ON recommendation_study_evaluation(expires_at);
CREATE FUNCTION protect_recommendation_study_protocol() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.expires_at <= clock_timestamp() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'study protocol is retained until expiry';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['activation_id','activation_input_digest','activated_at','enrolled_count','privacy_revision'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['activation_id','activation_input_digest','activated_at','enrolled_count','privacy_revision'])
     OR NEW.enrolled_count < OLD.enrolled_count OR NEW.privacy_revision < OLD.privacy_revision
     OR (OLD.activation_id IS NOT NULL AND (NEW.activation_id IS DISTINCT FROM OLD.activation_id OR NEW.activation_input_digest IS DISTINCT FROM OLD.activation_input_digest OR NEW.activated_at IS DISTINCT FROM OLD.activated_at)) THEN
    RAISE EXCEPTION 'study protocol is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recommendation_study_protocol_immutable BEFORE UPDATE OR DELETE ON recommendation_study FOR EACH ROW EXECUTE FUNCTION protect_recommendation_study_protocol();
CREATE TRIGGER recommendation_study_evidence_immutable BEFORE UPDATE OR DELETE ON recommendation_study_evidence FOR EACH ROW EXECUTE FUNCTION prevent_recommendation_experiment_evaluation_mutation();
CREATE TRIGGER recommendation_study_evaluation_immutable BEFORE UPDATE OR DELETE ON recommendation_study_evaluation FOR EACH ROW EXECUTE FUNCTION prevent_recommendation_experiment_evaluation_mutation();
CREATE FUNCTION account_recommendation_study_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE recommendation_study SET enrolled_count = enrolled_count + 1, privacy_revision = privacy_revision + 1 WHERE experiment_id = NEW.experiment_id;
    RETURN NEW;
  END IF;
  -- Includes erasure and raw expiry; never recreate erased subject data.
  IF TG_OP = 'DELETE' THEN
    UPDATE recommendation_study SET privacy_revision = privacy_revision + 1 WHERE experiment_id = OLD.experiment_id;
    RETURN OLD;
  END IF;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    UPDATE recommendation_study SET privacy_revision = privacy_revision + 1 WHERE experiment_id = OLD.experiment_id;
    IF NEW.experiment_id IS DISTINCT FROM OLD.experiment_id THEN
      UPDATE recommendation_study SET enrolled_count = enrolled_count + 1, privacy_revision = privacy_revision + 1 WHERE experiment_id = NEW.experiment_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recommendation_study_assignment_accounting AFTER INSERT OR UPDATE OR DELETE ON recommendation_experiment_assignment FOR EACH ROW EXECUTE FUNCTION account_recommendation_study_assignment();
-- Also invalidate when profile authority itself changes, including a direct
-- expiry or generation fence before assignment cleanup can execute.
CREATE FUNCTION fence_recommendation_study_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.privacy_generation IS DISTINCT FROM OLD.privacy_generation OR NEW.token_digest IS DISTINCT FROM OLD.token_digest OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    UPDATE recommendation_study SET privacy_revision = privacy_revision + 1
    WHERE experiment_id IN (SELECT experiment_id FROM recommendation_experiment_assignment WHERE profile_id = OLD.id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recommendation_study_profile_fence BEFORE UPDATE OR DELETE ON recommendation_profile FOR EACH ROW EXECUTE FUNCTION fence_recommendation_study_profile();
-- privacy_revision is a conservative input-authority epoch, including privacy,
-- enrollment and outcome/source mutation. A published snapshot captures it.
COMMENT ON COLUMN recommendation_study.privacy_revision IS 'Monotonic study input authority epoch; includes privacy and source invalidation';
CREATE FUNCTION fence_recommendation_study_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  request_ids text[];
  assignment_ids text[];
  study_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'recommendation_request' THEN
    request_ids := ARRAY[before_row->>'id', after_row->>'id'];
    assignment_ids := ARRAY[before_row->>'experiment_assignment_id', after_row->>'experiment_assignment_id'];
  ELSIF TG_TABLE_NAME = 'recommendation_eligibility_decision' THEN
    SELECT array_agg(request_id) INTO request_ids FROM recommendation_outcome_revision
      WHERE id = ANY(ARRAY[before_row->>'outcome_id', after_row->>'outcome_id']);
  ELSIF TG_TABLE_NAME = 'recommendation_viewing_mode_evidence' THEN
    SELECT array_agg(request_id) INTO request_ids FROM recommendation_playback_episode
      WHERE id = ANY(ARRAY[before_row->>'episode_id', after_row->>'episode_id']);
  ELSE
    request_ids := ARRAY[before_row->>'request_id', after_row->>'request_id'];
  END IF;
  -- At most the old/new request's assignments. No cohort scan or global epoch.
  FOR study_id IN
    SELECT DISTINCT assignment.experiment_id
    FROM (
      SELECT unnest(assignment_ids) AS assignment_id
      UNION SELECT experiment_assignment_id FROM recommendation_request WHERE id = ANY(request_ids)
    ) relevant
    JOIN recommendation_experiment_assignment assignment ON assignment.id = relevant.assignment_id
    JOIN recommendation_study study ON study.experiment_id = assignment.experiment_id
    ORDER BY assignment.experiment_id
  LOOP
    -- Shared source writers run concurrently. Publication takes this lock
    -- exclusively before its READ COMMITTED extraction and epoch increment.
    PERFORM pg_advisory_xact_lock_shared(hashtextextended(study_id, 505505));
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      -- A writer with an old fixed snapshot must conflict with the publication
      -- row update, even when it could not see the first authority publication.
      -- SHARE conflicts with the publication UPDATE but permits other source
      -- writers. KEY SHARE would incorrectly accept an old non-key row version.
      PERFORM experiment_id FROM recommendation_study WHERE experiment_id = study_id FOR SHARE;
    END IF;
    UPDATE recommendation_study study SET privacy_revision = privacy_revision + 1
    WHERE study.experiment_id = study_id AND EXISTS (
      SELECT 1 FROM recommendation_study_evaluation authority
      JOIN recommendation_experiment_evaluation evaluation ON evaluation.id = authority.evaluation_id
      WHERE authority.study_id = study.experiment_id
        AND authority.privacy_revision = study.privacy_revision
        AND authority.expires_at > clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM recommendation_experiment_evaluation newer WHERE newer.supersedes_id = evaluation.id)
    );
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recommendation_request', 'recommendation_personalization_decision',
    'recommendation_candidate_run', 'recommendation_impression',
    'recommendation_selection', 'recommendation_experiment_exposure',
    'recommendation_promotion_slate_fence', 'recommendation_playback_episode',
    'recommendation_playback_fact', 'recommendation_outcome_revision',
    'recommendation_eligibility_decision', 'recommendation_viewing_mode_evidence'
  ] LOOP
    EXECUTE format('CREATE TRIGGER recommendation_study_source_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fence_recommendation_study_source()', table_name);
  END LOOP;
END $$;
RESET statement_timeout;
RESET lock_timeout;
