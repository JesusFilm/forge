SELECT now() observed_at,current_setting('transaction_read_only') read_only;
WITH roots AS MATERIALIZED (
 SELECT id,owner_release_id,owner_release_generation,created_at,result,fallback_reason,expected_item_count,served_item_payload
 FROM recommendation_request
 WHERE created_at >= '2026-09-29T19:30:00Z' AND created_at < '2026-09-30T19:30:00Z'
 ORDER BY created_at,id LIMIT 20001
), r AS MATERIALIZED (SELECT * FROM roots WHERE (SELECT count(*) FROM roots)<=20000),
cards AS MATERIALIZED (
 SELECT r.id request_id,r.owner_release_id,i.candidate_generator,
 EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->'sources') s WHERE s->>'generator'='directional-cowatch' AND s->>'rejectionReason' IS NULL) cowatch_source
 FROM r JOIN recommendation_served_item i ON i.request_id=r.id
)
SELECT (SELECT count(*) FROM roots) observed_request_rows,(SELECT count(*)>20000 FROM roots) request_bound_exceeded,
 count(*) requests,count(*) FILTER(WHERE owner_release_id IS NOT NULL) exact_owner_execution,
 count(*) FILTER(WHERE expected_item_count>0) requests_with_cards,
 count(*) FILTER(WHERE fallback_reason='composition_required_input_unavailable') missing_input_fallbacks,
 (SELECT count(*) FROM cards) cards,
 (SELECT count(*) FROM cards WHERE cowatch_source) cowatch_contributed_cards,
 (SELECT count(DISTINCT request_id) FROM cards WHERE cowatch_source) requests_with_cowatch_contribution,
 min(created_at) first_request_at,max(created_at) last_request_at
FROM r;
SELECT r.owner_release_generation,r.result,r.fallback_reason,p.execution_mode,p.reason_code,count(*) requests
FROM recommendation_request r LEFT JOIN recommendation_personalization_decision p ON p.request_id=r.id
WHERE r.created_at >= '2026-09-29T19:30:00Z' AND r.created_at < '2026-09-30T19:30:00Z'
GROUP BY 1,2,3,4,5 ORDER BY requests DESC;
WITH roots AS MATERIALIZED (
 SELECT r.id,cr.trace_payload FROM recommendation_request r JOIN recommendation_candidate_run cr ON cr.request_id=r.id
 WHERE r.created_at >= '2026-09-29T19:30:00Z' AND r.created_at < '2026-09-30T19:30:00Z'
 AND r.fallback_reason='composition_required_input_unavailable' ORDER BY r.created_at,r.id LIMIT 1001
), r AS MATERIALIZED (SELECT * FROM roots WHERE (SELECT count(*) FROM roots)<=1000),
diagnostics AS (
 SELECT r.id,ev->'evidence' flags FROM r CROSS JOIN LATERAL jsonb_array_elements(r.trace_payload->'stages') st
 CROSS JOIN LATERAL jsonb_array_elements(st->'sourceEvidence') ev
 WHERE st->>'stage'='rejected' AND st->>'sourceGenerator'='directional-cowatch' AND ev->>'generator'='mmr-composition-inputs'
)
SELECT (SELECT count(*)>1000 FROM roots) bound_exceeded,count(distinct r.id) missing_input_fallbacks,count(distinct d.id) with_diagnostics,
 count(distinct d.id) FILTER(WHERE d.flags->>'missingTheme'='true') missing_theme,
 count(distinct d.id) FILTER(WHERE d.flags->>'missingSource'='true') missing_source,
 count(distinct d.id) FILTER(WHERE d.flags->>'missingInterest'='true') missing_interest,
 count(distinct d.id) FILTER(WHERE d.flags->>'missingHistory'='true') missing_history
FROM r LEFT JOIN diagnostics d ON d.id=r.id;
