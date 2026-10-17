-- Read-only, bounded new-request cohort. Run after normal deployment.
-- Do not infer historical empty-request audio from locale.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT conname, convalidated
FROM pg_constraint
WHERE conname = 'recommendation_request_delivery_diagnostics_bound';

WITH recent AS MATERIALIZED (
  SELECT seed_media_id, locale, strategy_version, result, fallback_reason,
    expected_item_count, delivery_diagnostics, retrieval_latency_ms
  FROM recommendation_request
  WHERE created_at >= now() - interval '1 hour'
    AND purpose = 'seeded'
  ORDER BY created_at DESC, id DESC
  LIMIT 10000
)
SELECT seed_media_id, locale, strategy_version,
  delivery_diagnostics->>'audioLanguageSlug' AS exact_audio,
  delivery_diagnostics->>'transcriptLocale' AS transcript_locale,
  delivery_diagnostics->>'presentationLocale' AS presentation_locale,
  count(*) AS requests,
  count(*) FILTER (WHERE expected_item_count = 6) AS full_rows,
  count(*) FILTER (WHERE expected_item_count BETWEEN 1 AND 5) AS partial_rows,
  count(*) FILTER (WHERE expected_item_count = 0) AS empty_rows,
  count(*) FILTER (WHERE fallback_reason = 'retrieval_timeout') AS timeout_rows,
  count(*) FILTER (WHERE delivery_diagnostics IS NULL) AS unknown_context_rows,
  max(octet_length(delivery_diagnostics::text)) AS max_diagnostics_bytes,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY retrieval_latency_ms) AS retrieval_p95_ms
FROM recent
GROUP BY seed_media_id, locale, strategy_version, exact_audio,
  transcript_locale, presentation_locale
ORDER BY requests DESC;
-- retrieval_latency_ms is not complete HTTP/service latency; also inspect runtime monitors.
-- A missing ledger row (admission or persistence failure) is not counted here.

WITH recent AS MATERIALIZED (
  SELECT delivery_diagnostics, fallback_reason
  FROM recommendation_request
  WHERE created_at >= now() - interval '1 hour' AND purpose = 'seeded'
  ORDER BY created_at DESC, id DESC
  LIMIT 10000
)
SELECT delivery_diagnostics->'retrieval'->>'seed' AS seed_state,
  delivery_diagnostics->'retrieval'->>'presentationAvailable' AS presentation_available,
  delivery_diagnostics->'retrieval'->>'exactAudioAvailable' AS exact_audio_available,
  delivery_diagnostics->'curated'->>'state' AS curated_state,
  fallback_reason, count(*)
FROM recent
GROUP BY seed_state, presentation_available, exact_audio_available,
  curated_state, fallback_reason
ORDER BY count(*) DESC;
ROLLBACK;
