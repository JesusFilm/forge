-- feat-383 / U16: generic offline shadow-candidate evaluation.
-- Expand-only: no serving pointer, assignment, request, or served item is
-- mutated. N-1 ignores these tables. Request-scoped inputs cascade at the
-- existing 29-day root while aggregate evaluations expire after 365 days.

CREATE TYPE "RecommendationShadowEvaluationState" AS ENUM ('active', 'terminal');
CREATE TYPE "RecommendationShadowRunState" AS ENUM (
  'pending', 'claimed', 'published', 'failed', 'fenced'
);
CREATE TYPE "RecommendationShadowDecisionKind" AS ENUM (
  'promote_to_experiment', 'revise', 'retire', 'inconclusive'
);

CREATE TABLE "recommendation_shadow_evaluation" (
  "id" text PRIMARY KEY,
  "manifest_id" varchar(191) NOT NULL,
  "generator_version" varchar(64) NOT NULL,
  "sampling_version" varchar(64) NOT NULL,
  "context_version" varchar(64) NOT NULL,
  "eligibility_version" varchar(64) NOT NULL,
  "retention_policy_version" varchar(64) NOT NULL,
  "state" "RecommendationShadowEvaluationState" NOT NULL DEFAULT 'active',
  "generation" integer NOT NULL DEFAULT 1,
  "window_start" timestamptz NOT NULL,
  "window_end" timestamptz NOT NULL,
  "requested_sample_size" integer NOT NULL,
  "sampled_count" integer NOT NULL DEFAULT 0,
  "processed_count" integer NOT NULL DEFAULT 0,
  "failed_count" integer NOT NULL DEFAULT 0,
  "fenced_count" integer NOT NULL DEFAULT 0,
  "coverage" double precision,
  "overlap" double precision,
  "novelty" double precision,
  "diversity" double precision,
  "rejection" double precision,
  "latency_p95_ms" integer,
  "cohort_quality" double precision,
  "input_freshness_p95_ms" integer,
  "input_watermark" timestamptz,
  "input_digest" char(64),
  "purpose" varchar(64) NOT NULL DEFAULT 'shadow_candidate_evaluation',
  "identity_class" varchar(64) NOT NULL DEFAULT 'aggregate_human_no_identity',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_aggregate_readers',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'request_cascade_and_scheduled_expiry',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'live_semantic_untouched',
  "retention_days" integer NOT NULL DEFAULT 365,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_shadow_evaluation_manifest_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "recommendation_strategy_manifest"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "recommendation_shadow_evaluation_window_check" CHECK (
    "window_start" < "window_end"
  ),
  CONSTRAINT "recommendation_shadow_evaluation_generation_check" CHECK (
    "generation" > 0
  ),
  CONSTRAINT "recommendation_shadow_evaluation_counts_check" CHECK (
    "requested_sample_size" BETWEEN 1 AND 10000
    AND "sampled_count" BETWEEN 0 AND "requested_sample_size"
    AND "processed_count" BETWEEN 0 AND "sampled_count"
    AND "failed_count" BETWEEN 0 AND "sampled_count"
    AND "fenced_count" BETWEEN 0 AND "sampled_count"
    AND "processed_count" + "failed_count" + "fenced_count" <= "sampled_count"
  ),
  CONSTRAINT "recommendation_shadow_evaluation_metrics_check" CHECK (
    ("coverage" IS NULL OR "coverage" BETWEEN 0 AND 1)
    AND ("overlap" IS NULL OR "overlap" BETWEEN 0 AND 1)
    AND ("novelty" IS NULL OR "novelty" BETWEEN 0 AND 1)
    AND ("diversity" IS NULL OR "diversity" BETWEEN 0 AND 1)
    AND ("rejection" IS NULL OR "rejection" BETWEEN 0 AND 1)
    AND ("cohort_quality" IS NULL OR "cohort_quality" BETWEEN 0 AND 1)
    AND ("latency_p95_ms" IS NULL OR "latency_p95_ms" BETWEEN 0 AND 60000)
    AND ("input_freshness_p95_ms" IS NULL OR "input_freshness_p95_ms" BETWEEN 0 AND 2592000000)
  ),
  CONSTRAINT "recommendation_shadow_evaluation_digest_check" CHECK (
    "input_digest" IS NULL OR "input_digest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "recommendation_shadow_evaluation_retention_check" CHECK (
    "retention_days" = 365
  )
);
CREATE INDEX "recommendation_shadow_evaluation_state_created_idx"
  ON "recommendation_shadow_evaluation"("state", "created_at");
CREATE INDEX "recommendation_shadow_evaluation_manifest_created_idx"
  ON "recommendation_shadow_evaluation"("manifest_id", "created_at");
CREATE INDEX "recommendation_shadow_evaluation_expiry_idx"
  ON "recommendation_shadow_evaluation"("expires_at");

CREATE TABLE "recommendation_shadow_run" (
  "id" text PRIMARY KEY,
  "evaluation_id" text NOT NULL,
  "request_id" text NOT NULL,
  "live_candidate_run_id" text,
  "projection_profile_id" text,
  "privacy_generation" integer,
  "sample_ordinal" integer NOT NULL,
  "sampling_digest" char(64) NOT NULL,
  "context_projection_ref" varchar(191),
  "context_projection_version" varchar(64) NOT NULL,
  "context_projection_digest" char(64),
  "eligibility_version" varchar(64) NOT NULL,
  "retention_policy_version" varchar(64) NOT NULL,
  "state" "RecommendationShadowRunState" NOT NULL DEFAULT 'pending',
  "generation" integer NOT NULL DEFAULT 1,
  "claim_id" uuid,
  "claimed_at" timestamptz,
  "heartbeat_at" timestamptz,
  "finished_at" timestamptz,
  "nominated_count" integer,
  "eligible_count" integer,
  "rejected_count" integer,
  "live_slate_digest" char(64),
  "shadow_slate_digest" char(64),
  "live_slate_unchanged" boolean,
  "coverage" double precision,
  "overlap" double precision,
  "novelty" double precision,
  "diversity" double precision,
  "rejection" double precision,
  "latency_ms" integer,
  "cohort_quality" double precision,
  "input_captured_at" timestamptz NOT NULL,
  "input_freshness_ms" integer,
  "failure_reason" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_shadow_run_evaluation_fkey"
    FOREIGN KEY ("evaluation_id") REFERENCES "recommendation_shadow_evaluation"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_shadow_run_request_fkey"
    FOREIGN KEY ("request_id") REFERENCES "recommendation_request"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_shadow_run_candidate_run_fkey"
    FOREIGN KEY ("live_candidate_run_id") REFERENCES "recommendation_candidate_run"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_shadow_run_profile_fkey"
    FOREIGN KEY ("projection_profile_id") REFERENCES "recommendation_profile"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_shadow_run_evaluation_request_key"
    UNIQUE ("evaluation_id", "request_id"),
  CONSTRAINT "recommendation_shadow_run_ordinal_check" CHECK (
    "sample_ordinal" BETWEEN 0 AND 9999
  ),
  CONSTRAINT "recommendation_shadow_run_generation_check" CHECK (
    "generation" > 0
  ),
  CONSTRAINT "recommendation_shadow_run_digest_check" CHECK (
    "sampling_digest" ~ '^[a-f0-9]{64}$'
    AND ("context_projection_digest" IS NULL OR "context_projection_digest" ~ '^[a-f0-9]{64}$')
    AND ("live_slate_digest" IS NULL OR "live_slate_digest" ~ '^[a-f0-9]{64}$')
    AND ("shadow_slate_digest" IS NULL OR "shadow_slate_digest" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "recommendation_shadow_run_privacy_ref_check" CHECK (
    ("projection_profile_id" IS NULL AND "privacy_generation" IS NULL)
    OR ("projection_profile_id" IS NOT NULL AND "privacy_generation" > 0)
  ),
  CONSTRAINT "recommendation_shadow_run_claim_check" CHECK (
    ("state" = 'claimed' AND "claim_id" IS NOT NULL AND "claimed_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL)
    OR "state" <> 'claimed'
  ),
  CONSTRAINT "recommendation_shadow_run_counts_check" CHECK (
    ("nominated_count" IS NULL OR "nominated_count" BETWEEN 0 AND 64)
    AND ("eligible_count" IS NULL OR "eligible_count" BETWEEN 0 AND 64)
    AND ("rejected_count" IS NULL OR "rejected_count" BETWEEN 0 AND 64)
  ),
  CONSTRAINT "recommendation_shadow_run_metrics_check" CHECK (
    ("coverage" IS NULL OR "coverage" BETWEEN 0 AND 1)
    AND ("overlap" IS NULL OR "overlap" BETWEEN 0 AND 1)
    AND ("novelty" IS NULL OR "novelty" BETWEEN 0 AND 1)
    AND ("diversity" IS NULL OR "diversity" BETWEEN 0 AND 1)
    AND ("rejection" IS NULL OR "rejection" BETWEEN 0 AND 1)
    AND ("cohort_quality" IS NULL OR "cohort_quality" BETWEEN 0 AND 1)
    AND ("latency_ms" IS NULL OR "latency_ms" BETWEEN 0 AND 60000)
    AND ("input_freshness_ms" IS NULL OR "input_freshness_ms" BETWEEN 0 AND 2592000000)
  )
);
CREATE INDEX "recommendation_shadow_run_evaluation_state_idx"
  ON "recommendation_shadow_run"("evaluation_id", "state", "sample_ordinal");
CREATE INDEX "recommendation_shadow_run_profile_generation_idx"
  ON "recommendation_shadow_run"("projection_profile_id", "privacy_generation");
CREATE INDEX "recommendation_shadow_run_heartbeat_idx"
  ON "recommendation_shadow_run"("heartbeat_at");
CREATE INDEX "recommendation_shadow_run_expiry_idx"
  ON "recommendation_shadow_run"("expires_at");
CREATE TRIGGER "recommendation_shadow_run_root_expiry_guard"
BEFORE INSERT OR UPDATE OF expires_at, request_id
ON "recommendation_shadow_run"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_root_expiry"();

CREATE TABLE "recommendation_shadow_nomination" (
  "id" text PRIMARY KEY,
  "run_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "candidate_key" varchar(191) NOT NULL,
  "target_media_id" varchar(191) NOT NULL,
  "generator" varchar(64) NOT NULL,
  "generator_version" varchar(64) NOT NULL,
  "source_rank" integer NOT NULL,
  "source_score" double precision NOT NULL,
  "eligible" boolean NOT NULL,
  "reason_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "shadow_position" integer,
  "overlaps_live" boolean NOT NULL,
  "provenance" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_shadow_nomination_run_fkey"
    FOREIGN KEY ("run_id") REFERENCES "recommendation_shadow_run"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_shadow_nomination_run_ordinal_key"
    UNIQUE ("run_id", "ordinal"),
  CONSTRAINT "recommendation_shadow_nomination_ordinal_check" CHECK (
    "ordinal" BETWEEN 0 AND 63
  ),
  CONSTRAINT "recommendation_shadow_nomination_rank_score_check" CHECK (
    "source_rank" BETWEEN 1 AND 64 AND "source_score" BETWEEN -1 AND 1
  ),
  CONSTRAINT "recommendation_shadow_nomination_position_check" CHECK (
    "shadow_position" IS NULL OR "shadow_position" BETWEEN 0 AND 5
  ),
  CONSTRAINT "recommendation_shadow_nomination_reason_check" CHECK (
    cardinality("reason_codes") <= 16 AND array_position("reason_codes", NULL) IS NULL
  ),
  CONSTRAINT "recommendation_shadow_nomination_provenance_check" CHECK (
    jsonb_typeof("provenance") = 'object'
    AND pg_column_size("provenance") <= 2048
    AND "provenance"::text !~* '"[^"]*(query|vector|cookie|token|session|cohort)[^"]*"[[:space:]]*:'
  )
);
CREATE INDEX "recommendation_shadow_nomination_run_position_idx"
  ON "recommendation_shadow_nomination"("run_id", "shadow_position");
CREATE INDEX "recommendation_shadow_nomination_expiry_idx"
  ON "recommendation_shadow_nomination"("expires_at");

CREATE FUNCTION "enforce_recommendation_shadow_nomination_expiry"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_expiry timestamptz;
BEGIN
  SELECT request."expires_at" INTO root_expiry
  FROM "recommendation_shadow_run" run
  JOIN "recommendation_request" request ON request."id" = run."request_id"
  WHERE run."id" = NEW."run_id";
  IF root_expiry IS NULL OR NEW."expires_at" <> root_expiry THEN
    RAISE EXCEPTION 'recommendation shadow nomination expiry must match request root';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_shadow_nomination_root_expiry_guard"
BEFORE INSERT OR UPDATE OF expires_at, run_id
ON "recommendation_shadow_nomination"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_shadow_nomination_expiry"();

CREATE TABLE "recommendation_shadow_decision" (
  "id" text PRIMARY KEY,
  "evaluation_id" text NOT NULL,
  "decision" "RecommendationShadowDecisionKind" NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "reevaluation_condition" varchar(512) NOT NULL,
  "input_digest" char(64) NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_shadow_decision_evaluation_key" UNIQUE ("evaluation_id"),
  CONSTRAINT "recommendation_shadow_decision_evaluation_fkey"
    FOREIGN KEY ("evaluation_id") REFERENCES "recommendation_shadow_evaluation"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_shadow_decision_digest_check" CHECK (
    "input_digest" ~ '^[a-f0-9]{64}$'
  )
);
CREATE INDEX "recommendation_shadow_decision_kind_idx"
  ON "recommendation_shadow_decision"("decision", "decided_at");
CREATE INDEX "recommendation_shadow_decision_expiry_idx"
  ON "recommendation_shadow_decision"("expires_at");

CREATE FUNCTION "prevent_recommendation_shadow_decision_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."expires_at" <= clock_timestamp() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'recommendation shadow terminal decisions are immutable';
END;
$$;
CREATE TRIGGER "recommendation_shadow_decision_immutable"
BEFORE UPDATE OR DELETE ON "recommendation_shadow_decision"
FOR EACH ROW EXECUTE FUNCTION "prevent_recommendation_shadow_decision_mutation"();

CREATE FUNCTION "prevent_terminal_shadow_evaluation_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."state" = 'terminal'
    AND NOT (TG_OP = 'DELETE' AND OLD."expires_at" <= clock_timestamp()) THEN
    RAISE EXCEPTION 'terminal recommendation shadow evaluations are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_shadow_evaluation_terminal_immutable"
BEFORE UPDATE OR DELETE ON "recommendation_shadow_evaluation"
FOR EACH ROW EXECUTE FUNCTION "prevent_terminal_shadow_evaluation_mutation"();

COMMENT ON TABLE "recommendation_shadow_evaluation" IS
  '365-day aggregate-only generic shadow decision root. Purpose: compare a pinned candidate generator without exposure. Identity: no viewer identity. Access: recommendation aggregate readers. Deletion: scheduled expiry. Fallback/rollback: live semantic remains untouched.';
COMMENT ON TABLE "recommendation_shadow_run" IS
  'Request-owned 29-day sampled context reference and counterfactual metrics. Privacy profile generation references are nullable and must be cleared/fenced on reset, withdrawal, deletion, or expiry. No raw query, profile vector, or cohort membership is stored.';
COMMENT ON TABLE "recommendation_shadow_nomination" IS
  'At most 64 request-owned shadow nominations with sanitized scalar provenance. Counterfactual rows never authorize exposure and cascade with the request root.';
COMMENT ON TABLE "recommendation_shadow_decision" IS
  'Immutable promote_to_experiment, revise, retire, or inconclusive result with reason and reevaluation condition. Promotion authorizes only a later experiment ticket, never live serving.';
