-- Validation scans only candidate-run summaries after the add-column migration
-- commits. The newly added nullable columns are NULL on legacy runs.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE "recommendation_candidate_run"
  VALIDATE CONSTRAINT "recommendation_candidate_trace_format_check";
COMMIT;
