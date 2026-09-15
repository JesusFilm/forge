\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL application_name = 'forge_recommendation_coverage_cohort';
SELECT (
  :'cohort_end'::timestamptz > :'cohort_start'::timestamptz
  AND :'cohort_end'::timestamptz <= :'cohort_start'::timestamptz + interval '24 hours'
) AS valid_window \gset
\if :valid_window
WITH requests AS MATERIALIZED (
  SELECT locale, seed_media_id, session_digest, result, fallback_reason,
    expected_item_count, retrieval_latency_ms
  FROM recommendation_request
  WHERE created_at >= :'cohort_start'::timestamptz
    AND created_at < :'cohort_end'::timestamptz
), breakdown AS (
  SELECT locale, result, fallback_reason,
    count(*) AS requests,
    count(DISTINCT seed_media_id) AS seed_videos,
    count(DISTINCT session_digest) AS session_digests,
    count(*) FILTER (WHERE expected_item_count > 0) AS requests_with_items,
    count(retrieval_latency_ms) AS measured_latencies,
    percentile_disc(.5) WITHIN GROUP (ORDER BY retrieval_latency_ms) AS latency_p50_ms,
    percentile_disc(.95) WITHIN GROUP (ORDER BY retrieval_latency_ms) AS latency_p95_ms
  FROM requests GROUP BY locale, result, fallback_reason
), source_priorities AS (
  SELECT locale, seed_media_id, result, fallback_reason, count(*) AS requests
  FROM requests WHERE result IN ('empty', 'unavailable')
  GROUP BY locale, seed_media_id, result, fallback_reason
  ORDER BY requests DESC, locale, seed_media_id, result, fallback_reason
  LIMIT 10
)
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'cohort_start', :'cohort_start'::timestamptz,
  'cohort_end', :'cohort_end'::timestamptz,
  'persisted_requests', (SELECT count(*) FROM requests),
  'session_digests', (SELECT count(DISTINCT session_digest) FROM requests),
  'requests_with_items', (SELECT count(*) FROM requests WHERE expected_item_count > 0),
  'breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY requests DESC, locale, result, fallback_reason) FROM breakdown b), '[]'::jsonb),
  'top_empty_or_unavailable_inputs', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY requests DESC, locale, seed_media_id, result, fallback_reason) FROM source_priorities s), '[]'::jsonb)
) AS coverage_cohort;
ROLLBACK;
\else
DO $$ BEGIN
  RAISE EXCEPTION 'Coverage requires a positive time window of at most 24 hours.';
END $$;
\endif
