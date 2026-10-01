WITH r AS MATERIALIZED (
SELECT r.id,r.created_at,r.served_item_payload,p.projection_generation_id FROM recommendation_request r JOIN recommendation_personalization_decision p ON p.request_id=r.id
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND p.execution_mode='hybrid_personalized'
), cards AS MATERIALIZED (
SELECT r.id,r.created_at,i.id item_id,i.target_media_id,
EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->'sources') s WHERE s->>'generator'='multi-interest-profile' AND s->>'rejectionReason' IS NULL) profile_source,
EXISTS(SELECT 1 FROM recommendation_profile_projection_contribution c WHERE c.generation_id=r.projection_generation_id AND c.target_media_id=i.target_media_id AND c.kind='qualified_outcome') previously_learned,
EXISTS(SELECT 1 FROM recommendation_profile_projection_contribution c WHERE c.generation_id=r.projection_generation_id AND c.target_media_id=i.target_media_id AND c.kind='qualified_outcome' AND c.occurred_at>=r.created_at-interval '24 hours') learned_last_24h
FROM r JOIN recommendation_served_item i ON i.request_id=r.id
)
SELECT profile_source,count(*) cards,count(distinct id) requests,count(*) FILTER(WHERE previously_learned) repeat_learned_video,count(*) FILTER(WHERE learned_last_24h) repeat_recently_learned_video FROM cards GROUP BY 1;
SELECT count(*) cards,count(*) FILTER(WHERE coalesce(COALESCE(r.served_item_payload->'items'->i.id->'presentation',i.presentation)->>'playbackId','')='') missing_playback_id,
count(*) FILTER(WHERE coalesce(COALESCE(r.served_item_payload->'items'->i.id->'presentation',i.presentation)->>'imageUrl','')='') missing_image,
count(*) FILTER(WHERE coalesce(COALESCE(r.served_item_payload->'items'->i.id->'presentation',i.presentation)->>'videoTitle','')='') missing_title
FROM recommendation_request r JOIN recommendation_served_item i ON i.request_id=r.id WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z';
SELECT cr.trace_format_version,count(*) requests
FROM recommendation_request r JOIN recommendation_candidate_run cr ON cr.request_id=r.id WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND r.fallback_reason='composition_required_input_unavailable' GROUP BY 1;
SELECT st->>'stage' stage,st->'reasonCodes' reasons,st->'sourceEvidence' evidence
FROM recommendation_request r JOIN recommendation_candidate_run cr ON cr.request_id=r.id CROSS JOIN LATERAL jsonb_array_elements(cr.trace_payload->'stages') st
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND r.fallback_reason='composition_required_input_unavailable' AND st->>'sourceGenerator'='directional-cowatch' LIMIT 2;
SELECT cr.shortfall_reason,cr.fallback_reason,count(*) requests FROM recommendation_request r JOIN recommendation_candidate_run cr ON cr.request_id=r.id WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND r.expected_item_count>0 AND r.expected_item_count<6 GROUP BY 1,2 ORDER BY requests DESC;
SELECT count(*) requests,count(*) FILTER(WHERE owner_release_id IS NOT NULL) exact_owner_execution, min(created_at) earliest,max(created_at) latest FROM recommendation_request WHERE created_at>='2026-09-29T18:42:00Z' AND created_at<'2026-09-30T18:42:00Z';
