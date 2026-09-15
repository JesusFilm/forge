CREATE TYPE "RecommendationControlReadinessState" AS ENUM (
  'ready',
  'not_ready',
  'inconclusive',
  'data_unhealthy'
);

CREATE TYPE "RecommendationControlDimensionOutcome" AS ENUM (
  'pass',
  'fail',
  'inconclusive',
  'unhealthy'
);

CREATE TABLE "recommendation_control_evaluation" (
  "id" TEXT NOT NULL,
  "manifest_id" VARCHAR(191) NOT NULL,
  "strategy_version" VARCHAR(64) NOT NULL,
  "contract_version" VARCHAR(64) NOT NULL,
  "surface_version" VARCHAR(64) NOT NULL,
  "generator" VARCHAR(32) NOT NULL,
  "serving_control_version" INTEGER NOT NULL,
  "policy_version" VARCHAR(64) NOT NULL,
  "outcome_policy_version" VARCHAR(64) NOT NULL,
  "classifier_version" VARCHAR(64) NOT NULL,
  "integrity_policy_version" VARCHAR(64) NOT NULL,
  "manifest_digest" CHAR(64) NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "input_captured_at" TIMESTAMP(3) NOT NULL,
  "request_watermark" TIMESTAMP(3),
  "impression_watermark" TIMESTAMP(3),
  "selection_watermark" TIMESTAMP(3),
  "outcome_watermark" TIMESTAMP(3),
  "mission_watermark" TIMESTAMP(3),
  "eligibility_watermark" TIMESTAMP(3),
  "input_digest" CHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL,
  "supersedes_id" TEXT,
  "state" "RecommendationControlReadinessState" NOT NULL,
  "delivery_outcome" "RecommendationControlDimensionOutcome" NOT NULL,
  "attribution_outcome" "RecommendationControlDimensionOutcome" NOT NULL,
  "maturity_outcome" "RecommendationControlDimensionOutcome" NOT NULL,
  "operational_outcome" "RecommendationControlDimensionOutcome" NOT NULL,
  "mission_outcome" "RecommendationControlDimensionOutcome" NOT NULL,
  "guardrail_outcome" "RecommendationControlDimensionOutcome" NOT NULL,
  "evidence" JSONB NOT NULL,
  "rates" JSONB NOT NULL,
  "uncertainty" JSONB NOT NULL,
  "policy_configuration" JSONB NOT NULL,
  "reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "explanation" VARCHAR(2048) NOT NULL,
  "purpose" VARCHAR(64) NOT NULL DEFAULT 'semantic_control_readiness',
  "identity_class" VARCHAR(64) NOT NULL DEFAULT 'aggregate_human_no_identity',
  "access_class" VARCHAR(64) NOT NULL DEFAULT 'recommendation_aggregate_readers',
  "deletion_behavior" VARCHAR(64) NOT NULL DEFAULT 'scheduled_expiry',
  "fallback_behavior" VARCHAR(64) NOT NULL DEFAULT 'last_known_semantic_control',
  "retention_days" INTEGER NOT NULL DEFAULT 365,
  "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_control_evaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_control_evaluation_window_check" CHECK ("window_start" < "window_end"),
  CONSTRAINT "recommendation_control_evaluation_cutoff_check" CHECK ("input_captured_at" >= "window_end"),
  CONSTRAINT "recommendation_control_evaluation_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "recommendation_control_evaluation_control_version_check" CHECK ("serving_control_version" >= 1),
  CONSTRAINT "recommendation_control_evaluation_retention_check" CHECK ("retention_days" = 365),
  CONSTRAINT "recommendation_control_evaluation_semantic_check" CHECK ("generator" = 'semantic'),
  CONSTRAINT "recommendation_control_evaluation_declaration_check" CHECK (
    "purpose" = 'semantic_control_readiness'
    AND "identity_class" = 'aggregate_human_no_identity'
    AND "access_class" = 'recommendation_aggregate_readers'
    AND "deletion_behavior" = 'scheduled_expiry'
    AND "fallback_behavior" = 'last_known_semantic_control'
  )
);

CREATE UNIQUE INDEX "recommendation_control_evaluation_supersedes_key"
  ON "recommendation_control_evaluation"("supersedes_id");
CREATE UNIQUE INDEX "recommendation_control_evaluation_revision_key"
  ON "recommendation_control_evaluation"(
    "surface_version", "manifest_id", "policy_version", "revision"
  );
CREATE UNIQUE INDEX "recommendation_control_evaluation_input_key"
  ON "recommendation_control_evaluation"(
    "surface_version", "manifest_id", "policy_version", "window_start", "window_end", "input_digest"
  );
CREATE INDEX "recommendation_control_evaluation_latest_idx"
  ON "recommendation_control_evaluation"("surface_version", "policy_version", "evaluated_at" DESC);
CREATE INDEX "recommendation_control_evaluation_state_idx"
  ON "recommendation_control_evaluation"("state", "evaluated_at");
CREATE INDEX "recommendation_control_evaluation_expiry_idx"
  ON "recommendation_control_evaluation"("expires_at");

ALTER TABLE "recommendation_control_evaluation"
  ADD CONSTRAINT "recommendation_control_evaluation_manifest_id_fkey"
  FOREIGN KEY ("manifest_id") REFERENCES "recommendation_strategy_manifest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recommendation_control_evaluation"
  ADD CONSTRAINT "recommendation_control_evaluation_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "recommendation_control_evaluation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "recommendation_control_evaluation" IS
  'Immutable aggregate-only semantic-control readiness proof retained 365 days for experiment-control governance. Contains no viewer, session, request, item, profile, or machine identity. Authorized recommendation aggregate readers only. Scheduled expiry removes the record and detaches supersedes lineage. Evaluation is entirely offline; the delivery plane continues using the last-known semantic control and its existing 1.5-second contract regardless of evaluation availability.';
