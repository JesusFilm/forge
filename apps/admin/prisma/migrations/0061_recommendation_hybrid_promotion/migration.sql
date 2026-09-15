-- feat-385 / U18: hybrid promotion and last-known-good rollback.
-- Expand-only. Existing serving-control semantics remain unchanged so N-1
-- application code continues to serve the semantic control or disable only
-- the recommendation surface through its coarse switch.

CREATE TYPE "RecommendationPromotionStage" AS ENUM ('control', 'bounded', 'permanent');
CREATE TYPE "RecommendationPromotionEventType" AS ENUM (
  'approval_recorded', 'activation_effective', 'first_eligible_exposure',
  'permanent_confirmed', 'rollback_requested', 'rollback_completed',
  'kill_switch_enabled', 'kill_switch_cleared', 'transition_failed'
);
CREATE TYPE "RecommendationPromotionRunAction" AS ENUM (
  'activate_bounded', 'confirm_permanent', 'automatic_rollback', 'manual_rollback'
);
CREATE TYPE "RecommendationPromotionRunState" AS ENUM (
  'pending', 'claimed', 'completed', 'failed', 'fenced'
);

CREATE TABLE "recommendation_promotion_approval" (
  "id" text PRIMARY KEY,
  "manifest_id" varchar(191) NOT NULL,
  "manifest_digest" char(64) NOT NULL,
  "max_exposure_bps" integer NOT NULL,
  "approved_by_id" varchar(191) NOT NULL,
  "approval_policy_version" varchar(64) NOT NULL DEFAULT 'recommendation-promotion-approval-v1',
  "purpose" varchar(64) NOT NULL DEFAULT 'bounded_strategy_promotion',
  "identity_class" varchar(64) NOT NULL DEFAULT 'admin_operator_identity',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_promotion_operators',
  "ingestion_health" varchar(64) NOT NULL DEFAULT 'not_applicable_immutable_config',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'immutable_until_audit_expiry',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'semantic_control',
  "retention_days" integer NOT NULL DEFAULT 2555,
  "approved_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_promotion_approval_manifest_fkey" FOREIGN KEY ("manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_promotion_approval_exact_key" UNIQUE ("manifest_id", "manifest_digest", "max_exposure_bps"),
  CONSTRAINT "recommendation_promotion_approval_digest_check" CHECK ("manifest_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_promotion_approval_ceiling_check" CHECK ("max_exposure_bps" > 0 AND "max_exposure_bps" < 10000),
  CONSTRAINT "recommendation_promotion_approval_retention_check" CHECK ("retention_days" = 2555)
);
CREATE INDEX "recommendation_promotion_approval_manifest_idx" ON "recommendation_promotion_approval"("manifest_id", "approved_at" DESC);
CREATE INDEX "recommendation_promotion_approval_expiry_idx" ON "recommendation_promotion_approval"("expires_at");

CREATE TABLE "recommendation_promotion_pointer" (
  "id" varchar(64) PRIMARY KEY,
  "active_manifest_id" varchar(191) NOT NULL,
  "last_known_good_manifest_id" varchar(191) NOT NULL,
  "active_approval_id" text,
  "stage" "RecommendationPromotionStage" NOT NULL DEFAULT 'control',
  "exposure_ceiling_bps" integer NOT NULL DEFAULT 0,
  "generation" integer NOT NULL DEFAULT 1,
  "kill_switch_enabled" boolean NOT NULL DEFAULT false,
  "reason_code" varchar(64) NOT NULL DEFAULT 'semantic_control',
  "purpose" varchar(64) NOT NULL DEFAULT 'online_promotion_authority',
  "identity_class" varchar(64) NOT NULL DEFAULT 'no_viewer_identity',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_promotion_readers',
  "ingestion_health" varchar(64) NOT NULL DEFAULT 'not_applicable_online_pointer',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'singleton_never_deleted',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'last_known_good_manifest',
  "retention_days" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recommendation_promotion_pointer_active_manifest_fkey" FOREIGN KEY ("active_manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_promotion_pointer_lkg_manifest_fkey" FOREIGN KEY ("last_known_good_manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_promotion_pointer_approval_fkey" FOREIGN KEY ("active_approval_id") REFERENCES "recommendation_promotion_approval"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_promotion_pointer_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "recommendation_promotion_pointer_retention_check" CHECK ("retention_days" = 0),
  CONSTRAINT "recommendation_promotion_pointer_stage_check" CHECK (
    ("stage" = 'control' AND "active_manifest_id" = "last_known_good_manifest_id" AND "exposure_ceiling_bps" = 0 AND "active_approval_id" IS NULL)
    OR ("stage" = 'bounded' AND "exposure_ceiling_bps" > 0 AND "exposure_ceiling_bps" < 10000 AND "active_approval_id" IS NOT NULL)
    OR ("stage" = 'permanent' AND "exposure_ceiling_bps" = 10000 AND "active_approval_id" IS NOT NULL)
  )
);

CREATE TABLE "recommendation_promotion_event" (
  "id" text PRIMARY KEY,
  "dedupe_key" varchar(191) NOT NULL,
  "event_type" "RecommendationPromotionEventType" NOT NULL,
  "run_id" text,
  "approval_id" text,
  "evaluation_id" text,
  "from_manifest_id" varchar(191),
  "to_manifest_id" varchar(191) NOT NULL,
  "from_stage" "RecommendationPromotionStage",
  "to_stage" "RecommendationPromotionStage" NOT NULL,
  "pointer_generation" integer NOT NULL,
  "exposure_ceiling_bps" integer NOT NULL,
  "actor_class" varchar(32) NOT NULL,
  "actor_id" varchar(191),
  "reason_code" varchar(64) NOT NULL,
  "input_digest" char(64) NOT NULL,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "purpose" varchar(64) NOT NULL DEFAULT 'promotion_audit',
  "identity_class" varchar(64) NOT NULL DEFAULT 'admin_or_system_operator',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_promotion_readers',
  "ingestion_health" varchar(64) NOT NULL DEFAULT 'append_only_healthy',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'immutable_until_audit_expiry',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'last_known_good_manifest',
  "retention_days" integer NOT NULL DEFAULT 2555,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_promotion_event_dedupe_key" UNIQUE ("dedupe_key"),
  CONSTRAINT "recommendation_promotion_event_digest_check" CHECK ("input_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_promotion_event_generation_check" CHECK ("pointer_generation" > 0),
  CONSTRAINT "recommendation_promotion_event_ceiling_check" CHECK ("exposure_ceiling_bps" >= 0 AND "exposure_ceiling_bps" <= 10000),
  CONSTRAINT "recommendation_promotion_event_details_check" CHECK (jsonb_typeof("details") = 'object'),
  CONSTRAINT "recommendation_promotion_event_retention_check" CHECK ("retention_days" = 2555)
);
CREATE INDEX "recommendation_promotion_event_type_idx" ON "recommendation_promotion_event"("event_type", "occurred_at" DESC);
CREATE INDEX "recommendation_promotion_event_generation_idx" ON "recommendation_promotion_event"("pointer_generation", "occurred_at");
CREATE INDEX "recommendation_promotion_event_expiry_idx" ON "recommendation_promotion_event"("expires_at");

CREATE TABLE "recommendation_promotion_run" (
  "id" text PRIMARY KEY,
  "action" "RecommendationPromotionRunAction" NOT NULL,
  "state" "RecommendationPromotionRunState" NOT NULL DEFAULT 'pending',
  "generation" integer NOT NULL DEFAULT 1,
  "expected_pointer_generation" integer NOT NULL,
  "target_manifest_id" varchar(191) NOT NULL,
  "approval_id" text,
  "evaluation_id" text,
  "exposure_ceiling_bps" integer NOT NULL,
  "requested_actor_class" varchar(32) NOT NULL,
  "requested_actor_id" varchar(191),
  "recent_authentication_verified" boolean NOT NULL DEFAULT false,
  "claim_id" uuid,
  "claimed_at" timestamptz,
  "heartbeat_at" timestamptz,
  "workflow_run_id" varchar(191),
  "failure_reason" varchar(64),
  "purpose" varchar(64) NOT NULL DEFAULT 'promotion_workflow_claim',
  "identity_class" varchar(64) NOT NULL DEFAULT 'admin_or_system_operator',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_promotion_operators',
  "ingestion_health" varchar(64) NOT NULL DEFAULT 'workflow_state',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'scheduled_expiry',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'last_known_good_manifest',
  "retention_days" integer NOT NULL DEFAULT 365,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_promotion_run_approval_fkey" FOREIGN KEY ("approval_id") REFERENCES "recommendation_promotion_approval"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_promotion_run_evaluation_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "recommendation_experiment_evaluation"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_promotion_run_generation_check" CHECK ("generation" > 0 AND "expected_pointer_generation" > 0),
  CONSTRAINT "recommendation_promotion_run_retention_check" CHECK ("retention_days" = 365),
  CONSTRAINT "recommendation_promotion_run_ceiling_check" CHECK ("exposure_ceiling_bps" >= 0 AND "exposure_ceiling_bps" <= 10000),
  CONSTRAINT "recommendation_promotion_run_claim_check" CHECK (
    ("state" = 'claimed' AND "claim_id" IS NOT NULL AND "claimed_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL)
    OR "state" <> 'claimed'
  ),
  CONSTRAINT "recommendation_promotion_run_permanent_auth_check" CHECK (
    "action" <> 'confirm_permanent'
    OR ("requested_actor_class" = 'admin' AND "requested_actor_id" IS NOT NULL AND "recent_authentication_verified")
  )
);
CREATE INDEX "recommendation_promotion_run_claim_idx" ON "recommendation_promotion_run"("state", "heartbeat_at");
CREATE INDEX "recommendation_promotion_run_pointer_idx" ON "recommendation_promotion_run"("expected_pointer_generation", "state");
CREATE INDEX "recommendation_promotion_run_expiry_idx" ON "recommendation_promotion_run"("expires_at");

CREATE TABLE "recommendation_promotion_slate_fence" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL,
  "pointer_generation" integer NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "purpose" varchar(64) NOT NULL DEFAULT 'rollback_exposure_fence',
  "identity_class" varchar(64) NOT NULL DEFAULT 'request_id_only',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_evidence_services',
  "ingestion_health" varchar(64) NOT NULL DEFAULT 'atomic_with_rollback',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'cascade_with_request',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'no_post_rollback_credit',
  "retention_days" integer NOT NULL DEFAULT 29,
  "fenced_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_promotion_slate_fence_request_fkey" FOREIGN KEY ("request_id") REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_promotion_slate_fence_request_key" UNIQUE ("request_id"),
  CONSTRAINT "recommendation_promotion_slate_fence_generation_check" CHECK ("pointer_generation" > 0),
  CONSTRAINT "recommendation_promotion_slate_fence_retention_check" CHECK ("retention_days" = 29)
);
CREATE INDEX "recommendation_promotion_slate_fence_expiry_idx" ON "recommendation_promotion_slate_fence"("expires_at");
CREATE TRIGGER "recommendation_promotion_slate_fence_root_expiry_guard" BEFORE INSERT OR UPDATE OF "expires_at", "request_id" ON "recommendation_promotion_slate_fence" FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_root_expiry"();

CREATE FUNCTION "prevent_recommendation_promotion_audit_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."expires_at" <= clock_timestamp() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'recommendation promotion audit is immutable';
END;
$$;
CREATE TRIGGER "recommendation_promotion_approval_immutable" BEFORE UPDATE OR DELETE ON "recommendation_promotion_approval" FOR EACH ROW EXECUTE FUNCTION "prevent_recommendation_promotion_audit_mutation"();
CREATE TRIGGER "recommendation_promotion_event_immutable" BEFORE UPDATE OR DELETE ON "recommendation_promotion_event" FOR EACH ROW EXECUTE FUNCTION "prevent_recommendation_promotion_audit_mutation"();

INSERT INTO "recommendation_promotion_pointer" (
  "id", "active_manifest_id", "last_known_good_manifest_id", "stage",
  "exposure_ceiling_bps", "generation", "kill_switch_enabled", "reason_code"
) VALUES (
  'recommendation-promotion-pointer', 'semantic-transcript-pgvector-v1',
  'semantic-transcript-pgvector-v1', 'control', 0, 1, false,
  'semantic_control'
) ON CONFLICT ("id") DO NOTHING;

COMMENT ON TABLE "recommendation_promotion_approval" IS '2555-day immutable exact-manifest bounded authority. Admin-only creation; workflow consumption cannot widen its ceiling.';
COMMENT ON TABLE "recommendation_promotion_pointer" IS 'CAS online promotion pointer. Coarse serving control remains separate; rollback restores semantic last-known-good.';
COMMENT ON TABLE "recommendation_promotion_event" IS '2555-day immutable Admin business ledger separating approval, activation, first eligible exposure, permanent confirmation, and rollback.';
COMMENT ON TABLE "recommendation_promotion_run" IS '365-day workflow claim truth; permanent confirmation requires a recently authenticated human Admin request.';
COMMENT ON TABLE "recommendation_promotion_slate_fence" IS 'Request-owned 29-day rollback fence. Issued slates remain immutable evidence but cannot accrue post-rollback promotion exposure.';
