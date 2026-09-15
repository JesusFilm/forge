-- feat-384 / U17: exposure-aware semantic A/A experiment spine.
-- Expand-only. The serving pointer and ordered semantic slate are untouched;
-- assignment failure therefore degrades to the current semantic control.

CREATE TYPE "RecommendationExperimentState" AS ENUM ('active', 'closed');
CREATE TYPE "RecommendationExperimentArm" AS ENUM ('control', 'challenger');
CREATE TYPE "RecommendationExperimentUnitKind" AS ENUM ('anonymous_session', 'anonymous_profile');
CREATE TYPE "RecommendationExperimentAssignmentState" AS ENUM ('active', 'fenced');
CREATE TYPE "RecommendationExperimentEvaluationState" AS ENUM ('pass', 'fail', 'inconclusive', 'data_unhealthy');
CREATE TYPE "RecommendationExperimentEvaluationRunState" AS ENUM ('pending', 'claimed', 'completed', 'failed', 'fenced');

CREATE TABLE "recommendation_experiment" (
  "id" varchar(191) PRIMARY KEY,
  "experiment_version" varchar(64) NOT NULL,
  "surface_version" varchar(64) NOT NULL,
  "control_manifest_id" varchar(191) NOT NULL,
  "challenger_manifest_id" varchar(191) NOT NULL,
  "assignment_policy_version" varchar(64) NOT NULL,
  "outcome_policy_version" varchar(64) NOT NULL,
  "integrity_policy_version" varchar(64) NOT NULL,
  "evaluation_policy_version" varchar(64) NOT NULL,
  "configuration_digest" char(64) NOT NULL,
  "challenger_probability" double precision NOT NULL,
  "state" "RecommendationExperimentState" NOT NULL DEFAULT 'active',
  "generation" integer NOT NULL DEFAULT 1,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "purpose" varchar(64) NOT NULL DEFAULT 'semantic_aa_experiment',
  "identity_class" varchar(64) NOT NULL DEFAULT 'pseudonymous_assignment_digest',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_experiment_readers',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'fence_assignment_and_rebuild_evaluation',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'semantic_control',
  "retention_days" integer NOT NULL DEFAULT 365,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_experiment_control_manifest_fkey" FOREIGN KEY ("control_manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_experiment_challenger_manifest_fkey" FOREIGN KEY ("challenger_manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_experiment_version_surface_key" UNIQUE ("experiment_version", "surface_version"),
  CONSTRAINT "recommendation_experiment_window_check" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "recommendation_experiment_probability_check" CHECK ("challenger_probability" > 0 AND "challenger_probability" < 1),
  CONSTRAINT "recommendation_experiment_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "recommendation_experiment_digest_check" CHECK ("configuration_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_experiment_retention_check" CHECK ("retention_days" = 365)
);
CREATE INDEX "recommendation_experiment_active_window_idx" ON "recommendation_experiment"("state", "surface_version", "starts_at", "ends_at");
CREATE INDEX "recommendation_experiment_expiry_idx" ON "recommendation_experiment"("expires_at");

CREATE TABLE "recommendation_experiment_assignment" (
  "id" text PRIMARY KEY,
  "experiment_id" varchar(191) NOT NULL,
  "unit_kind" "RecommendationExperimentUnitKind" NOT NULL,
  "unit_digest" char(64) NOT NULL,
  "profile_id" text,
  "privacy_generation" integer,
  "arm" "RecommendationExperimentArm" NOT NULL,
  "assignment_probability" double precision NOT NULL,
  "configuration_digest" char(64) NOT NULL,
  "state" "RecommendationExperimentAssignmentState" NOT NULL DEFAULT 'active',
  "generation" integer NOT NULL DEFAULT 1,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "fenced_at" timestamptz,
  "fence_reason" varchar(64),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_experiment_assignment_experiment_fkey" FOREIGN KEY ("experiment_id") REFERENCES "recommendation_experiment"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_assignment_profile_fkey" FOREIGN KEY ("profile_id") REFERENCES "recommendation_profile"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_assignment_unit_key" UNIQUE ("experiment_id", "unit_digest"),
  CONSTRAINT "recommendation_experiment_assignment_privacy_check" CHECK (
    ("unit_kind" = 'anonymous_session' AND "profile_id" IS NULL AND "privacy_generation" IS NULL)
    OR ("unit_kind" = 'anonymous_profile' AND "profile_id" IS NOT NULL AND "privacy_generation" > 0)
  ),
  CONSTRAINT "recommendation_experiment_assignment_probability_check" CHECK ("assignment_probability" > 0 AND "assignment_probability" <= 1),
  CONSTRAINT "recommendation_experiment_assignment_digest_check" CHECK ("unit_digest" ~ '^[a-f0-9]{64}$' AND "configuration_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_experiment_assignment_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "recommendation_experiment_assignment_fence_check" CHECK (
    ("state" = 'active' AND "fenced_at" IS NULL AND "fence_reason" IS NULL)
    OR ("state" = 'fenced' AND "fenced_at" IS NOT NULL AND "fence_reason" IS NOT NULL)
  )
);
CREATE INDEX "recommendation_experiment_assignment_profile_generation_idx" ON "recommendation_experiment_assignment"("profile_id", "privacy_generation", "state");
CREATE INDEX "recommendation_experiment_assignment_arm_idx" ON "recommendation_experiment_assignment"("experiment_id", "arm", "assigned_at");
CREATE INDEX "recommendation_experiment_assignment_expiry_idx" ON "recommendation_experiment_assignment"("expires_at");

ALTER TABLE "recommendation_request"
  ADD COLUMN "experiment_assignment_id" text,
  ADD COLUMN "experiment_bypass_reason" varchar(64),
  ADD CONSTRAINT "recommendation_request_experiment_assignment_fkey" FOREIGN KEY ("experiment_assignment_id") REFERENCES "recommendation_experiment_assignment"("id") ON DELETE SET NULL;
CREATE INDEX "recommendation_request_experiment_assignment_idx" ON "recommendation_request"("experiment_assignment_id", "created_at");

CREATE TABLE "recommendation_experiment_exposure" (
  "id" text PRIMARY KEY,
  "assignment_id" text NOT NULL,
  "request_id" text NOT NULL,
  "item_id" text NOT NULL,
  "event_id" varchar(191) NOT NULL,
  "arm" "RecommendationExperimentArm" NOT NULL,
  "effective_manifest_id" varchar(191) NOT NULL,
  "assignment_probability" double precision NOT NULL,
  "payload_digest" char(64) NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_experiment_exposure_assignment_fkey" FOREIGN KEY ("assignment_id") REFERENCES "recommendation_experiment_assignment"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_exposure_request_fkey" FOREIGN KEY ("request_id") REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_exposure_item_request_fkey" FOREIGN KEY ("request_id", "item_id") REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_exposure_manifest_fkey" FOREIGN KEY ("effective_manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_experiment_exposure_item_key" UNIQUE ("item_id"),
  CONSTRAINT "recommendation_experiment_exposure_item_request_key" UNIQUE ("request_id", "item_id"),
  CONSTRAINT "recommendation_experiment_exposure_probability_check" CHECK ("assignment_probability" > 0 AND "assignment_probability" <= 1),
  CONSTRAINT "recommendation_experiment_exposure_digest_check" CHECK ("payload_digest" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "recommendation_experiment_exposure_assignment_idx" ON "recommendation_experiment_exposure"("assignment_id", "occurred_at");
CREATE INDEX "recommendation_experiment_exposure_request_idx" ON "recommendation_experiment_exposure"("request_id", "occurred_at");
CREATE INDEX "recommendation_experiment_exposure_expiry_idx" ON "recommendation_experiment_exposure"("expires_at");
CREATE TRIGGER "recommendation_experiment_exposure_root_expiry_guard" BEFORE INSERT OR UPDATE OF "expires_at", "request_id" ON "recommendation_experiment_exposure" FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_root_expiry"();

CREATE TABLE "recommendation_experiment_evaluation_run" (
  "id" text PRIMARY KEY,
  "experiment_id" varchar(191) NOT NULL,
  "window_start" timestamptz NOT NULL,
  "window_end" timestamptz NOT NULL,
  "generation" integer NOT NULL DEFAULT 1,
  "state" "RecommendationExperimentEvaluationRunState" NOT NULL DEFAULT 'pending',
  "claim_id" uuid,
  "claimed_at" timestamptz,
  "heartbeat_at" timestamptz,
  "workflow_run_id" varchar(191),
  "failure_reason" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_experiment_evaluation_run_experiment_fkey" FOREIGN KEY ("experiment_id") REFERENCES "recommendation_experiment"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_evaluation_run_window_generation_key" UNIQUE ("experiment_id", "window_start", "window_end", "generation"),
  CONSTRAINT "recommendation_experiment_evaluation_run_window_check" CHECK ("window_start" < "window_end"),
  CONSTRAINT "recommendation_experiment_evaluation_run_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "recommendation_experiment_evaluation_run_claim_check" CHECK (
    ("state" = 'claimed' AND "claim_id" IS NOT NULL AND "claimed_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL)
    OR "state" <> 'claimed'
  )
);
CREATE INDEX "recommendation_experiment_evaluation_run_claim_idx" ON "recommendation_experiment_evaluation_run"("state", "heartbeat_at");
CREATE INDEX "recommendation_experiment_evaluation_run_expiry_idx" ON "recommendation_experiment_evaluation_run"("expires_at");

CREATE TABLE "recommendation_experiment_evaluation" (
  "id" text PRIMARY KEY,
  "experiment_id" varchar(191) NOT NULL,
  "run_id" text NOT NULL,
  "revision" integer NOT NULL,
  "supersedes_id" text,
  "state" "RecommendationExperimentEvaluationState" NOT NULL,
  "window_start" timestamptz NOT NULL,
  "window_end" timestamptz NOT NULL,
  "input_captured_at" timestamptz NOT NULL,
  "assignment_watermark" timestamptz,
  "exposure_watermark" timestamptz,
  "outcome_watermark" timestamptz,
  "mission_watermark" timestamptz,
  "eligibility_watermark" timestamptz,
  "assignment_policy_version" varchar(64) NOT NULL,
  "outcome_policy_version" varchar(64) NOT NULL,
  "integrity_policy_version" varchar(64) NOT NULL,
  "evaluation_policy_version" varchar(64) NOT NULL,
  "input_digest" char(64) NOT NULL,
  "counts" jsonb NOT NULL,
  "intent_to_treat" jsonb NOT NULL,
  "exposed_only" jsonb NOT NULL,
  "uncertainty" jsonb NOT NULL,
  "guardrails" jsonb NOT NULL,
  "sample_ratio" jsonb NOT NULL,
  "reason_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "purpose" varchar(64) NOT NULL DEFAULT 'multi_outcome_experiment_evaluation',
  "identity_class" varchar(64) NOT NULL DEFAULT 'aggregate_human_no_identity',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_experiment_readers',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'supersede_after_privacy_rebuild',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'semantic_control',
  "retention_days" integer NOT NULL DEFAULT 365,
  "evaluated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_experiment_evaluation_experiment_fkey" FOREIGN KEY ("experiment_id") REFERENCES "recommendation_experiment"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_evaluation_run_fkey" FOREIGN KEY ("run_id") REFERENCES "recommendation_experiment_evaluation_run"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_experiment_evaluation_supersedes_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "recommendation_experiment_evaluation"("id") ON DELETE SET NULL,
  CONSTRAINT "recommendation_experiment_evaluation_run_key" UNIQUE ("run_id"),
  CONSTRAINT "recommendation_experiment_evaluation_supersedes_key" UNIQUE ("supersedes_id"),
  CONSTRAINT "recommendation_experiment_evaluation_revision_key" UNIQUE ("experiment_id", "window_start", "window_end", "revision"),
  CONSTRAINT "recommendation_experiment_evaluation_input_key" UNIQUE ("experiment_id", "window_start", "window_end", "input_digest"),
  CONSTRAINT "recommendation_experiment_evaluation_window_check" CHECK ("window_start" < "window_end" AND "revision" > 0),
  CONSTRAINT "recommendation_experiment_evaluation_digest_check" CHECK ("input_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_experiment_evaluation_json_check" CHECK (
    jsonb_typeof("counts") = 'object' AND jsonb_typeof("intent_to_treat") = 'object'
    AND jsonb_typeof("exposed_only") = 'object' AND jsonb_typeof("uncertainty") = 'object'
    AND jsonb_typeof("guardrails") = 'object' AND jsonb_typeof("sample_ratio") = 'object'
  ),
  CONSTRAINT "recommendation_experiment_evaluation_reason_check" CHECK (cardinality("reason_codes") <= 32 AND array_position("reason_codes", NULL) IS NULL),
  CONSTRAINT "recommendation_experiment_evaluation_retention_check" CHECK ("retention_days" = 365)
);
CREATE INDEX "recommendation_experiment_evaluation_latest_idx" ON "recommendation_experiment_evaluation"("experiment_id", "evaluated_at" DESC);
CREATE INDEX "recommendation_experiment_evaluation_state_idx" ON "recommendation_experiment_evaluation"("state", "evaluated_at");
CREATE INDEX "recommendation_experiment_evaluation_expiry_idx" ON "recommendation_experiment_evaluation"("expires_at");

CREATE FUNCTION "prevent_recommendation_experiment_evaluation_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."expires_at" <= clock_timestamp() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'recommendation experiment evaluations are immutable';
END;
$$;
CREATE TRIGGER "recommendation_experiment_evaluation_immutable" BEFORE UPDATE OR DELETE ON "recommendation_experiment_evaluation" FOR EACH ROW EXECUTE FUNCTION "prevent_recommendation_experiment_evaluation_mutation"();

CREATE FUNCTION "prevent_recommendation_exposure_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."expires_at" <= clock_timestamp() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'recommendation experiment exposures are immutable';
END;
$$;
CREATE TRIGGER "recommendation_experiment_exposure_immutable" BEFORE UPDATE OR DELETE ON "recommendation_experiment_exposure" FOR EACH ROW EXECUTE FUNCTION "prevent_recommendation_exposure_mutation"();

INSERT INTO "recommendation_strategy_manifest" (
  "id", "strategy_version", "contract_version", "surface_version", "generator", "max_items", "configuration", "enabled"
) VALUES (
  'semantic-experiment-aa-v1', 'semantic-experiment-aa-v1', 'semantic-recommendation-v1', 'watch-below-player-v1', 'semantic', 6,
  '{"behaviorallyEquivalentTo":"semantic-transcript-pgvector-v1","completeServiceDeadlineMs":1500,"learningReads":false}'::jsonb, true
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "recommendation_experiment" (
  "id", "experiment_version", "surface_version", "control_manifest_id", "challenger_manifest_id",
  "assignment_policy_version", "outcome_policy_version", "integrity_policy_version", "evaluation_policy_version",
  "configuration_digest", "challenger_probability", "starts_at", "ends_at", "expires_at"
) VALUES (
  'semantic-aa-v1', 'semantic-aa-v1', 'watch-below-player-v1',
  'semantic-transcript-pgvector-v1', 'semantic-experiment-aa-v1',
  'sticky-deterministic-assignment-v1', 'active-watch-multi-outcome-v1',
  'recommendation-integrity-v1', 'recommendation-experiment-aa-v1',
  'b1e21026390824b7da071aba6b19f0667d7df2a0e76fb0e686105b1f0838aec4', 0.5,
  '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', '2028-01-01T00:00:00Z'
) ON CONFLICT ("id") DO NOTHING;

COMMENT ON TABLE "recommendation_experiment" IS '365-day immutable experiment configuration and aggregate operating truth. U17 is semantic A/A only. No viewer identity. Fallback is semantic control.';
COMMENT ON TABLE "recommendation_experiment_assignment" IS '29-day pseudonymous sticky assignment. Purpose: experiment attribution. Access: experiment services. Profile reset/withdraw/delete fences by privacy generation; session identity is a one-way digest.';
COMMENT ON TABLE "recommendation_experiment_exposure" IS 'Request-owned 29-day actual eligible exposure derived idempotently from an accepted signed impression. Duplicate browser evidence cannot create a second exposure.';
COMMENT ON TABLE "recommendation_experiment_evaluation" IS '365-day immutable aggregate multi-outcome revision. ITT is primary, exposed-only secondary. Late evidence appends a superseding revision.';
