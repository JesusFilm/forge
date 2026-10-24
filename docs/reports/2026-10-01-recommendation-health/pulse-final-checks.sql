WITH r AS MATERIALIZED (
SELECT r.id,cr.trace_payload FROM recommendation_request r JOIN recommendation_candidate_run cr ON cr.request_id=r.id
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND r.fallback_reason='composition_required_input_unavailable'
)
SELECT jsonb_typeof(st->'sourceEvidence') evidence_type,st->'sourceEvidence' diagnostic,count(distinct r.id) requests
FROM r CROSS JOIN LATERAL jsonb_array_elements(r.trace_payload->'stages') st
WHERE st->>'stage'='rejected' AND st->>'sourceGenerator'='directional-cowatch'
GROUP BY 1,2 ORDER BY requests DESC LIMIT 8;
SELECT r.surface_version,i.candidate_generator,COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->>'cohort' cohort,
COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->>'profileCount' profile_count,
COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->>'curatedCount' curated_count,count(*) requests
FROM recommendation_request r JOIN recommendation_served_item i ON i.request_id=r.id AND i.position=0
WHERE r.surface_version='watch-for-you-v1' AND r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' GROUP BY 1,2,3,4,5;
SELECT expires_at oldest_expired_request FROM recommendation_request WHERE expires_at<now() ORDER BY expires_at LIMIT 1;
SELECT g.state,count(*) contributions,count(*) FILTER(WHERE d.actor_class::text IN ('machine','internal','test')) machine_internal_test,
count(*) FILTER(WHERE d.id IS NULL) missing_eligibility_receipt,
count(*) FILTER(WHERE o.qualified_view=false) unqualified_outcomes
FROM recommendation_profile_projection_generation g JOIN recommendation_profile_projection_contribution c ON c.generation_id=g.id
LEFT JOIN recommendation_eligibility_decision d ON d.id=c.source_eligibility_decision_id
LEFT JOIN recommendation_outcome_revision o ON o.id=c.source_outcome_id
WHERE g.published_at>='2026-09-29T18:42:00Z' AND g.published_at<'2026-09-30T18:42:00Z' GROUP BY 1;
SELECT count(*) expired_active_profile_projections
FROM recommendation_profile_projection_pointer ptr JOIN recommendation_profile_projection_generation g ON g.id=ptr.generation_id
WHERE g.expires_at<now() AND EXISTS(SELECT 1 FROM recommendation_personalization_decision d JOIN recommendation_request r ON r.id=d.request_id WHERE d.projection_generation_id=g.id AND r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND g.expires_at<=r.created_at);
