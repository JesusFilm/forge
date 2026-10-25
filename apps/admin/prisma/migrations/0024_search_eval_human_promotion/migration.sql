-- Human review and promotion metadata for Admin-owned search eval candidates.
--
-- The raw candidate payload remains short-lived or staged. Durable regression
-- truth must read from the sanitized_* columns after human promotion.

ALTER TYPE "SearchEvalCandidateSource" ADD VALUE 'seed';
ALTER TYPE "SearchEvalCandidateSource" ADD VALUE 'user_submitted';

ALTER TYPE "SearchEvalCandidatePromotionStatus" ADD VALUE 'archived';

CREATE TYPE "SearchEvalCandidateSanitizationStatus" AS ENUM (
  'pending',
  'sanitized',
  'unsafe'
);

ALTER TABLE "search_eval_candidate"
  ADD COLUMN "sanitized_query_text" varchar(512),
  ADD COLUMN "sanitized_expected_result_notes" varchar(2048),
  ADD COLUMN "sanitized_source_anchors" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN "sanitization_status" "SearchEvalCandidateSanitizationStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "reviewer_identity" varchar(256),
  ADD COLUMN "reviewed_at" timestamp(3),
  ADD COLUMN "review_notes" varchar(2048),
  ADD COLUMN "promoted_at" timestamp(3),
  ADD COLUMN "promotion_run_context" jsonb NOT NULL DEFAULT '{}';

CREATE INDEX "search_eval_candidate_promotion_status_reviewed_at_idx"
  ON "search_eval_candidate"("promotion_status", "reviewed_at");

CREATE INDEX "search_eval_candidate_promoted_at_idx"
  ON "search_eval_candidate"("promoted_at");
