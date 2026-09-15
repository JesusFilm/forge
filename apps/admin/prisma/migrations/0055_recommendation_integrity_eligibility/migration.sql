CREATE TYPE "RecommendationEligibilitySourceType" AS ENUM (
  'playback_outcome',
  'content_action'
);

CREATE TYPE "RecommendationEligibilityState" AS ENUM (
  'eligible',
  'excluded',
  'quarantined'
);

CREATE TABLE "recommendation_eligibility_decision" (
  "id" TEXT NOT NULL,
  "source_type" "RecommendationEligibilitySourceType" NOT NULL,
  "source_key" VARCHAR(255) NOT NULL,
  "outcome_id" TEXT,
  "content_action_id" TEXT,
  "policy_version" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "actor_class" "RecommendationContentActionActorClass" NOT NULL,
  "state" "RecommendationEligibilityState" NOT NULL,
  "reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "eligible_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "contribution_weight" DOUBLE PRECISION NOT NULL,
  "contribution_ordinal" INTEGER NOT NULL,
  "distinct_support" INTEGER NOT NULL,
  "identity_concentration" DOUBLE PRECISION NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_eligibility_decision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_eligibility_source_check" CHECK (
    ("source_type" = 'playback_outcome' AND "outcome_id" IS NOT NULL AND "content_action_id" IS NULL)
    OR
    ("source_type" = 'content_action' AND "content_action_id" IS NOT NULL AND "outcome_id" IS NULL)
  ),
  CONSTRAINT "recommendation_eligibility_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "recommendation_eligibility_weight_check" CHECK (
    "contribution_weight" >= 0 AND "contribution_weight" <= 1
  ),
  CONSTRAINT "recommendation_eligibility_ordinal_check" CHECK ("contribution_ordinal" >= 1),
  CONSTRAINT "recommendation_eligibility_support_check" CHECK ("distinct_support" >= 0),
  CONSTRAINT "recommendation_eligibility_concentration_check" CHECK (
    "identity_concentration" >= 0 AND "identity_concentration" <= 1
  )
);

CREATE UNIQUE INDEX "recommendation_eligibility_source_policy_revision_key"
  ON "recommendation_eligibility_decision"("source_key", "policy_version", "revision");
CREATE UNIQUE INDEX "recommendation_eligibility_current_source_policy_key"
  ON "recommendation_eligibility_decision"("source_key", "policy_version")
  WHERE "is_current" = true;
CREATE INDEX "recommendation_eligibility_state_decided_idx"
  ON "recommendation_eligibility_decision"("state", "decided_at");
CREATE INDEX "recommendation_eligibility_actor_state_idx"
  ON "recommendation_eligibility_decision"("actor_class", "state", "decided_at");
CREATE INDEX "recommendation_eligibility_expiry_idx"
  ON "recommendation_eligibility_decision"("expires_at");

ALTER TABLE "recommendation_eligibility_decision"
  ADD CONSTRAINT "recommendation_eligibility_outcome_id_fkey"
  FOREIGN KEY ("outcome_id") REFERENCES "recommendation_outcome_revision"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recommendation_eligibility_decision"
  ADD CONSTRAINT "recommendation_eligibility_content_action_id_fkey"
  FOREIGN KEY ("content_action_id") REFERENCES "recommendation_content_action"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "recommendation_eligibility_decision" IS
  '29-day recommendation integrity projection for profile, aggregate, and experiment purposes. Stores source identity class and bounded reason codes, never raw session identity. Authorized Admin aggregate/detail readers only. Source erasure cascades; policy rollback appends a replacement decision and atomically replaces the source learning projection.';
