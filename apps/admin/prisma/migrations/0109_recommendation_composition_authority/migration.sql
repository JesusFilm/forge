-- CreateTable
CREATE TABLE "recommendation_composition_protocol" (
    "id" UUID NOT NULL,
    "shadow_evaluation_id" TEXT NOT NULL,
    "source_manifest_id" VARCHAR(191) NOT NULL,
    "generator_version" VARCHAR(64) NOT NULL,
    "challenger_manifest_id" VARCHAR(191) NOT NULL,
    "composer_version" VARCHAR(64) NOT NULL,
    "protocol_version" VARCHAR(64) NOT NULL,
    "config" JSONB NOT NULL,
    "config_digest" CHAR(64) NOT NULL,
    "actor_id" VARCHAR(191) NOT NULL,
    "authority_revision" INTEGER NOT NULL DEFAULT 1,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_composition_protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_composition_observation" (
    "run_id" TEXT NOT NULL,
    "protocol_id" UUID NOT NULL,
    "input_digest" CHAR(64) NOT NULL,
    "output_digest" CHAR(64) NOT NULL,
    "metrics" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_composition_observation_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "recommendation_composition_decision" (
    "protocol_id" UUID NOT NULL,
    "decision" VARCHAR(64) NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "evidence_version" VARCHAR(64) NOT NULL,
    "evidence_digest" CHAR(64) NOT NULL,
    "input_digest" CHAR(64) NOT NULL,
    "observation_count" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "authority_revision" INTEGER NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_composition_decision_pkey" PRIMARY KEY ("protocol_id")
);

-- CreateTable
CREATE TABLE "recommendation_composition_calibration" (
    "protocol_id" UUID NOT NULL,
    "evidence_digest" CHAR(64) NOT NULL,
    "config_digest" CHAR(64) NOT NULL,
    "review_digest" CHAR(64) NOT NULL,
    "authority_revision" INTEGER NOT NULL,
    "actor_id" VARCHAR(191) NOT NULL,
    "rationale" VARCHAR(512) NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_composition_calibration_pkey" PRIMARY KEY ("protocol_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_composition_protocol_shadow_evaluation_id_key" ON "recommendation_composition_protocol"("shadow_evaluation_id");

-- CreateIndex
CREATE INDEX "recommendation_composition_protocol_expires_at_idx" ON "recommendation_composition_protocol"("expires_at");

-- CreateIndex
CREATE INDEX "recommendation_composition_observation_protocol_id_idx" ON "recommendation_composition_observation"("protocol_id");

-- CreateIndex
CREATE INDEX "recommendation_composition_observation_expires_at_idx" ON "recommendation_composition_observation"("expires_at");

-- CreateIndex
CREATE INDEX "recommendation_composition_decision_expires_at_idx" ON "recommendation_composition_decision"("expires_at");

-- CreateIndex
CREATE INDEX "recommendation_composition_calibration_expires_at_idx" ON "recommendation_composition_calibration"("expires_at");

-- AddForeignKey
ALTER TABLE "recommendation_composition_observation" ADD CONSTRAINT "recommendation_composition_observation_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "recommendation_shadow_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_composition_observation" ADD CONSTRAINT "recommendation_composition_observation_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "recommendation_composition_protocol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_composition_decision" ADD CONSTRAINT "recommendation_composition_decision_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "recommendation_composition_protocol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_composition_calibration" ADD CONSTRAINT "recommendation_composition_calibration_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "recommendation_composition_protocol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fixed retention, bounded payloads, and immutable history. No raw vectors,
-- profile identifiers, or duplicate per-position payloads are stored here.
ALTER TABLE recommendation_composition_protocol ADD CONSTRAINT composition_protocol_bounds CHECK (
  jsonb_typeof(config) = 'object' AND octet_length(config::text) <= 4096
  AND config_digest ~ '^[a-f0-9]{64}$' AND authority_revision > 0
  AND expires_at > created_at AND expires_at <= created_at + interval '365 days'
);
ALTER TABLE recommendation_composition_observation ADD CONSTRAINT composition_observation_bounds CHECK (
  jsonb_typeof(metrics) = 'object' AND octet_length(metrics::text) <= 2048
  AND input_digest ~ '^[a-f0-9]{64}$' AND output_digest ~ '^[a-f0-9]{64}$'
  AND expires_at > created_at AND expires_at <= created_at + interval '29 days'
);
ALTER TABLE recommendation_composition_decision ADD CONSTRAINT composition_decision_bounds CHECK (
  decision IN ('inconclusive','revise','retire','qualify_for_controlled_study')
  AND observation_count BETWEEN 0 AND 500 AND octet_length(summary::text) <= 2048
  AND evidence_digest ~ '^[a-f0-9]{64}$' AND input_digest ~ '^[a-f0-9]{64}$'
);

CREATE FUNCTION protect_composition_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'recommendation_composition_protocol' THEN
    IF (to_jsonb(NEW) - 'authority_revision' - 'revoked_at') = (to_jsonb(OLD) - 'authority_revision' - 'revoked_at')
      AND NEW.authority_revision >= OLD.authority_revision
      AND (OLD.revoked_at IS NULL OR NEW.revoked_at = OLD.revoked_at)
    THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'composition history is immutable';
  END IF;
  IF OLD.expires_at > CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'composition history has not expired'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER composition_protocol_immutable BEFORE UPDATE OR DELETE ON recommendation_composition_protocol FOR EACH ROW EXECUTE FUNCTION protect_composition_history();
CREATE TRIGGER composition_decision_immutable BEFORE UPDATE OR DELETE ON recommendation_composition_decision FOR EACH ROW EXECUTE FUNCTION protect_composition_history();
CREATE TRIGGER composition_calibration_immutable BEFORE UPDATE OR DELETE ON recommendation_composition_calibration FOR EACH ROW EXECUTE FUNCTION protect_composition_history();

CREATE FUNCTION composition_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root recommendation_shadow_run; contract recommendation_composition_protocol; request_root recommendation_request; profile_root recommendation_profile;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'composition observation is immutable'; END IF;
  SELECT * INTO root FROM recommendation_shadow_run WHERE id = NEW.run_id FOR SHARE;
  SELECT * INTO contract FROM recommendation_composition_protocol WHERE id = NEW.protocol_id FOR UPDATE;
  SELECT * INTO request_root FROM recommendation_request WHERE id = root.request_id FOR SHARE;
  IF root.projection_profile_id IS NOT NULL THEN
    SELECT * INTO profile_root FROM recommendation_profile WHERE id = root.projection_profile_id FOR SHARE;
    IF profile_root.id IS NULL OR profile_root.state <> 'active' OR profile_root.privacy_generation <> root.privacy_generation
      OR NEW.expires_at > profile_root.expires_at
    THEN RAISE EXCEPTION 'composition profile binding unavailable'; END IF;
  END IF;
  IF request_root.state <> 'issued' OR NEW.expires_at > request_root.expires_at
    OR contract.revoked_at IS NOT NULL OR root.state <> 'published'
    OR root.evaluation_id <> contract.shadow_evaluation_id
    OR root.claimed_at IS NULL OR root.claimed_at < contract.created_at
    OR NEW.expires_at > root.expires_at
    OR EXISTS (SELECT 1 FROM recommendation_composition_decision WHERE protocol_id = NEW.protocol_id)
  THEN RAISE EXCEPTION 'composition observation binding unavailable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER composition_observation_guard BEFORE INSERT OR UPDATE ON recommendation_composition_observation FOR EACH ROW EXECUTE FUNCTION composition_observation_guard();

CREATE FUNCTION revoke_composition_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE recommendation_composition_protocol SET authority_revision = authority_revision + 1,
    revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE id = OLD.protocol_id;
  RETURN OLD;
END $$;
CREATE TRIGGER composition_observation_deleted AFTER DELETE ON recommendation_composition_observation FOR EACH ROW EXECUTE FUNCTION revoke_composition_observation();

CREATE FUNCTION fence_composition_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER composition_run_fence AFTER UPDATE ON recommendation_shadow_run FOR EACH ROW EXECUTE FUNCTION fence_composition_run();

CREATE FUNCTION fence_composition_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state OR NEW.privacy_generation <> OLD.privacy_generation OR NEW.expires_at < OLD.expires_at THEN
    DELETE FROM recommendation_composition_observation observation USING recommendation_shadow_run run
      WHERE observation.run_id = run.id AND run.projection_profile_id = OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER composition_profile_fence AFTER UPDATE ON recommendation_profile FOR EACH ROW EXECUTE FUNCTION fence_composition_profile();

CREATE FUNCTION fence_composition_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state OR NEW.generation <> OLD.generation OR NEW.expires_at < OLD.expires_at THEN
    DELETE FROM recommendation_composition_observation observation USING recommendation_shadow_run run
      WHERE observation.run_id = run.id AND run.request_id = OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER composition_request_fence AFTER UPDATE ON recommendation_request FOR EACH ROW EXECUTE FUNCTION fence_composition_request();


CREATE FUNCTION fence_composition_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.generation <> OLD.generation OR NEW.manifest_id <> OLD.manifest_id
    OR NEW.generator_version <> OLD.generator_version OR NEW.sampling_version <> OLD.sampling_version
    OR NEW.context_version <> OLD.context_version OR NEW.eligibility_version <> OLD.eligibility_version
    OR NEW.retention_policy_version <> OLD.retention_policy_version
    OR NEW.window_start <> OLD.window_start OR NEW.window_end <> OLD.window_end
    OR NEW.requested_sample_size <> OLD.requested_sample_size
  THEN DELETE FROM recommendation_composition_observation observation USING recommendation_shadow_run run
    WHERE observation.run_id = run.id AND run.evaluation_id = OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER composition_evaluation_fence AFTER UPDATE ON recommendation_shadow_evaluation FOR EACH ROW EXECUTE FUNCTION fence_composition_evaluation();
