WITH r AS MATERIALIZED (
 SELECT r.*,CASE WHEN created_at>='2026-09-29T18:42:00Z' THEN 'latest_24h' ELSE 'previous_24h' END period
 FROM recommendation_request r WHERE created_at>='2026-09-28T18:42:00Z' AND created_at<'2026-09-30T18:42:00Z'
), slate AS MATERIALIZED (
 SELECT r.id,count(i.id) cards,count(distinct i.target_media_id) distinct_videos,count(*) FILTER(WHERE i.target_media_id=r.seed_media_id) seed_repeats
 FROM r LEFT JOIN recommendation_served_item i ON i.request_id=r.id GROUP BY r.id
)
SELECT r.period,r.surface_version,count(*) requests,count(*) FILTER(WHERE s.cards>0) with_cards,count(*) FILTER(WHERE s.cards=6) six_cards,count(*) FILTER(WHERE s.cards=0) empty_cards,
count(*) FILTER(WHERE r.result='served') served,count(*) FILTER(WHERE r.result='fallback') fallback,count(*) FILTER(WHERE r.result='unavailable') unavailable,count(*) FILTER(WHERE r.result='empty') empty,
count(*) FILTER(WHERE s.cards<>s.distinct_videos) duplicate_video_slates,sum(s.seed_repeats) seed_repeat_cards,
count(*) FILTER(WHERE cr.evidence_complete=false) incomplete_candidate_evidence,
percentile_cont(0.5) WITHIN GROUP(ORDER BY r.retrieval_latency_ms) p50_ms,percentile_cont(0.95) WITHIN GROUP(ORDER BY r.retrieval_latency_ms) p95_ms,percentile_cont(0.99) WITHIN GROUP(ORDER BY r.retrieval_latency_ms) p99_ms
FROM r JOIN slate s ON s.id=r.id LEFT JOIN recommendation_candidate_run cr ON cr.request_id=r.id GROUP BY 1,2 ORDER BY 1,2;
SELECT r.surface_version,r.result,r.fallback_reason,p.execution_mode,p.reason_code,count(*) requests
FROM recommendation_request r LEFT JOIN recommendation_personalization_decision p ON p.request_id=r.id
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' GROUP BY 1,2,3,4,5 ORDER BY requests DESC;
SELECT locale,count(*) requests,count(*) FILTER(WHERE expected_item_count>0) with_cards,count(*) FILTER(WHERE expected_item_count=0) without_cards,count(*) FILTER(WHERE fallback_reason='seed_embedding_unavailable') missing_seed_embedding,
percentile_cont(0.95) WITHIN GROUP(ORDER BY retrieval_latency_ms) p95_ms
FROM recommendation_request WHERE created_at>='2026-09-29T18:42:00Z' AND created_at<'2026-09-30T18:42:00Z' GROUP BY 1 HAVING count(*)>=20 ORDER BY requests DESC LIMIT 15;
SELECT r.owner_release_generation,p.execution_mode,p.effective_manifest_id,cr.generator_version,cr.composer_version,cr.fallback_reason,count(*) requests
FROM recommendation_request r LEFT JOIN recommendation_personalization_decision p ON p.request_id=r.id LEFT JOIN recommendation_candidate_run cr ON cr.request_id=r.id
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z'
AND (r.owner_release_id IS NOT NULL OR p.effective_manifest_id LIKE '%cowatch%' OR p.reason_code LIKE '%cowatch%' OR cr.generator_version LIKE '%cowatch%' OR cr.fallback_reason LIKE '%cowatch%') GROUP BY 1,2,3,4,5,6 ORDER BY requests DESC;
SELECT i.candidate_generator,count(*) cards
FROM recommendation_request r JOIN recommendation_served_item i ON i.request_id=r.id
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' GROUP BY 1 ORDER BY cards DESC;
SELECT s->>'generator' generator,count(distinct i.id) contributed_cards
FROM recommendation_request r JOIN recommendation_served_item i ON i.request_id=r.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->'sources') s
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND s->>'rejectionReason' IS NULL GROUP BY 1 ORDER BY contributed_cards DESC;
SELECT enabled,version,updated_at FROM recommendation_serving_control;
SELECT evaluated_at,window_start,window_end,state,delivery_outcome,attribution_outcome,maturity_outcome,operational_outcome,guardrail_outcome,rates,reason_codes FROM recommendation_control_evaluation ORDER BY evaluated_at DESC LIMIT 2;
