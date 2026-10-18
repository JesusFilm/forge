-- Outcome erasure cascades through both ends of each co-watch pair, across
-- every retained generation. The generation-leading unique index does not
-- provide a bounded lookup by either outcome alone, including absent children.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX "recommendation_cowatch_contribution_source_outcome_idx"
  ON "recommendation_cowatch_contribution"("source_outcome_id");
CREATE INDEX "recommendation_cowatch_contribution_target_outcome_idx"
  ON "recommendation_cowatch_contribution"("target_outcome_id");

COMMIT;
