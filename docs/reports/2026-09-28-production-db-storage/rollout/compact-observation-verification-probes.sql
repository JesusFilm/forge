-- Post-migration aggregate checks. No identifiers, payloads, or secrets emitted.
-- Execute using the guarded read-only transport used by the investigation.
-- probe: safety
SET default_transaction_read_only = on;
SET statement_timeout = '10s';
SET lock_timeout = '1s';
SET idle_in_transaction_session_timeout = '15s';
SET timezone = 'UTC';

-- probe: rollout_migrations
SELECT DISTINCT ON (migration_name)
       migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name IN ('0100_recommendation_candidate_compact_trace',
                         '0101_recommendation_candidate_compact_trace_validate',
                         '0102_recommendation_candidate_stage_duplicate_index_drop')
ORDER BY migration_name, started_at DESC;

-- probe: rollout_constraints_and_indexes
SELECT
  (SELECT convalidated FROM pg_constraint
   WHERE conrelid = 'recommendation_candidate_run'::regclass
     AND conname = 'recommendation_candidate_trace_format_check') AS compact_check_validated,
  to_regclass('public.recommendation_candidate_stage_run_stage_idx') IS NULL AS duplicate_index_absent,
  (SELECT indisvalid AND indisunique FROM pg_index
   WHERE indexrelid = to_regclass('public.recommendation_candidate_stage_ordinal_key')) AS unique_index_valid;

-- probe: recent_trace_stage_parity
WITH recent AS MATERIALIZED (
  SELECT id, trace_format_version, trace_payload, evidence_complete,
         nominated_count, canonicalized_count, deduplicated_count,
         rejected_count, scored_count, ordered_count, composed_count
  FROM (
    (SELECT * FROM recommendation_candidate_run
     WHERE trace_format_version = 1
       AND created_at >= TIMESTAMPTZ '2026-09-27T23:13:09Z'
     ORDER BY created_at DESC, id DESC LIMIT 100)
    UNION ALL
    (SELECT * FROM recommendation_candidate_run
     WHERE trace_format_version IS NULL
       AND created_at >= TIMESTAMPTZ '2026-09-27T22:13:09Z'
     ORDER BY created_at DESC, id DESC LIMIT 100)
  ) sampled
), checked AS (
  SELECT r.trace_format_version, r.evidence_complete, expected.stage,
         expected.observations AS expected_observations,
         legacy.observations AS legacy_observations,
         CASE WHEN r.trace_format_version = 1 THEN
           (SELECT count(*) FROM jsonb_array_elements(r.trace_payload->'stages') s
            WHERE s->>'stage' = expected.stage)
         ELSE legacy.observations END AS observed_observations
  FROM recent r
  CROSS JOIN LATERAL (VALUES
    ('nominated', r.nominated_count), ('canonicalized', r.canonicalized_count),
    ('deduplicated', r.deduplicated_count), ('rejected', r.rejected_count),
    ('scored', r.scored_count), ('ordered', r.ordered_count),
    ('composed', r.composed_count)
  ) expected(stage, observations)
  CROSS JOIN LATERAL (
    SELECT count(*) AS observations
    FROM recommendation_candidate_stage_evidence e
    WHERE e.run_id = r.id AND e.stage = expected.stage
  ) legacy
)
SELECT coalesce(trace_format_version, -1) AS format_version, stage,
       count(*) AS sampled_runs,
       count(*) FILTER (WHERE NOT evidence_complete) AS incomplete_runs,
       sum(expected_observations) AS expected_observations,
       sum(observed_observations) AS observed_observations,
       count(*) FILTER (WHERE observed_observations <> expected_observations) AS mismatched_runs,
       sum(legacy_observations) AS legacy_observations
FROM checked GROUP BY 1, stage ORDER BY 1, stage;

-- probe: legacy_write_horizon
SELECT created_at AS last_legacy_write, expires_at AS last_legacy_run_expiry,
       (SELECT expires_at FROM recommendation_candidate_run
        WHERE trace_format_version IS NULL
        ORDER BY expires_at DESC, id DESC LIMIT 1) AS maximum_legacy_run_expiry
FROM recommendation_candidate_run
WHERE trace_format_version IS NULL
ORDER BY created_at DESC, id DESC LIMIT 1;

-- probe: active_transaction_summary
SELECT count(*) FILTER (WHERE xact_start < now() - interval '30 seconds') AS transactions_older_than_30s,
       count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waiters,
       max(now() - xact_start) AS oldest_transaction_age
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid();

-- probe: compact_activation_horizon
-- Deployment interval begins at activation merge 23:13:09 UTC. Legacy runs
-- before the verified fleet convergence at 23:25:17 UTC are expected overlap.
SELECT
  min(created_at) FILTER (WHERE trace_format_version = 1) AS first_compact_since_activation,
  count(*) FILTER (WHERE trace_format_version = 1) AS compact_runs_since_activation,
  count(*) FILTER (WHERE trace_format_version IS NULL) AS legacy_runs_since_activation_merge_including_preconvergence,
  count(*) FILTER (WHERE trace_format_version IS NULL AND created_at >= TIMESTAMPTZ '2026-09-27T23:25:17Z') AS legacy_runs_after_fleet_convergence,
  count(*) FILTER (WHERE trace_format_version = 1 AND NOT evidence_complete) AS compact_evidence_incomplete_since_activation
FROM recommendation_candidate_run
WHERE created_at >= TIMESTAMPTZ '2026-09-27T23:13:09Z';

-- probe: compact_payload_size_sample
-- Stored datum bytes only; excludes tuple, index, and TOAST page overhead.
-- This sample is not total physical per-run savings or a daily growth slope.
WITH sample AS MATERIALIZED (
  SELECT pg_column_size(trace_payload) AS stored_payload_bytes,
         nominated_count + canonicalized_count + deduplicated_count +
         rejected_count + scored_count + ordered_count + composed_count AS observations,
         created_at
  FROM recommendation_candidate_run
  WHERE trace_format_version = 1
    AND created_at >= TIMESTAMPTZ '2026-09-27T23:13:09Z'
  ORDER BY created_at DESC, id DESC LIMIT 100
)
SELECT count(*) AS sampled_compact_runs,
       min(created_at) AS sample_window_start,
       max(created_at) AS sample_window_end,
       round(avg(stored_payload_bytes), 2) AS mean_stored_payload_bytes,
       min(stored_payload_bytes) AS min_stored_payload_bytes,
       max(stored_payload_bytes) AS max_stored_payload_bytes,
       round(avg(observations), 2) AS mean_stage_observations
FROM sample;
