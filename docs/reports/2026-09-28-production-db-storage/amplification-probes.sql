-- Read-only follow-up: aggregate small candidate-run summaries, then verify
-- stage-row amplification through 100 indexed run IDs. Never emit those IDs.
-- probe: safety
SET default_transaction_read_only = on;
SET statement_timeout = '10s';
SET lock_timeout = '1s';
SET timezone = 'UTC';

-- probe: daily_candidate_amplification
SELECT date_trunc('day', created_at) AS day_utc, purpose, count(*) AS runs,
       sum(nominated_count + canonicalized_count + deduplicated_count +
           rejected_count + scored_count + ordered_count + composed_count) AS stage_rows_from_counters,
       round(avg(nominated_count + canonicalized_count + deduplicated_count +
                 rejected_count + scored_count + ordered_count + composed_count), 2) AS mean_stage_rows,
       round(avg(nominated_count), 2) AS mean_nominated,
       round(avg(composed_count), 2) AS mean_composed
FROM recommendation_candidate_run
GROUP BY 1,2 ORDER BY 1,2;

-- probe: actual_recent_stage_sample
WITH runs AS MATERIALIZED (
  SELECT id FROM recommendation_candidate_run
  ORDER BY created_at DESC, id DESC LIMIT 100
)
SELECT e.stage, count(*) AS rows,
       round(avg(pg_column_size(e)), 1) AS mean_tuple_bytes,
       round(avg(pg_column_size(e.source_evidence)), 1) AS mean_source_evidence_bytes
FROM runs r JOIN recommendation_candidate_stage_evidence e ON e.run_id = r.id
GROUP BY e.stage ORDER BY e.stage;

-- probe: actual_request_count
SELECT count(*) AS request_roots FROM recommendation_request;

-- probe: candidate_generator_totals
SELECT generator_version, count(*) AS runs,
       min(created_at) AS earliest, max(created_at) AS latest,
       round(avg(nominated_count + canonicalized_count + deduplicated_count +
                 rejected_count + scored_count + ordered_count + composed_count), 2) AS mean_stage_rows
FROM recommendation_candidate_run GROUP BY generator_version ORDER BY runs DESC;
