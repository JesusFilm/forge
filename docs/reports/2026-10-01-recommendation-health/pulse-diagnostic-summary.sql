WITH r AS MATERIALIZED (
SELECT r.id,cr.trace_payload FROM recommendation_request r JOIN recommendation_candidate_run cr ON cr.request_id=r.id
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND r.fallback_reason='composition_required_input_unavailable'
), diagnostics AS (
SELECT r.id,ev->'evidence' flags FROM r CROSS JOIN LATERAL jsonb_array_elements(r.trace_payload->'stages') st
CROSS JOIN LATERAL jsonb_array_elements(st->'sourceEvidence') ev
WHERE st->>'stage'='rejected' AND st->>'sourceGenerator'='directional-cowatch' AND ev->>'generator'='mmr-composition-inputs'
)
SELECT count(distinct r.id) missing_input_fallbacks,count(distinct d.id) with_diagnostics,
count(distinct d.id) FILTER(WHERE d.flags->>'missingTheme'='true') missing_theme,
count(distinct d.id) FILTER(WHERE d.flags->>'missingSource'='true') missing_source,
count(distinct d.id) FILTER(WHERE d.flags->>'missingInterest'='true') missing_interest,
count(distinct d.id) FILTER(WHERE d.flags->>'missingHistory'='true') missing_history
FROM r LEFT JOIN diagnostics d ON d.id=r.id;
SELECT min(distinct_viewer_support) minimum_support,max(distinct_viewer_support) maximum_support,count(*) edges,count(*) FILTER(WHERE eligible) supported_edges
FROM recommendation_cowatch_edge WHERE generation_id=(SELECT graph_generation_id FROM recommendation_owner_release ORDER BY approved_at DESC LIMIT 1);
SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('recommendation_owner_release','recommendation_request') AND column_name IN ('approved_at','created_at');
