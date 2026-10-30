-- Retention deletes standalone content actions in batches of 100. PostgreSQL
-- checks this FK once per parent, even when every decision links to an outcome
-- and no content-action children exist. Index all revisions for the cascade;
-- an is_current predicate would leave historical decisions unindexed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX "recommendation_eligibility_content_action_idx"
  ON "recommendation_eligibility_decision"("content_action_id");

COMMIT;
