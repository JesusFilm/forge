-- Recent still-linkable qualified outcomes. No profile, session or media identifiers leave the database.
WITH links AS MATERIALIZED (
 SELECT DISTINCT ON(l.session_digest) l.profile_id,l.privacy_generation,l.session_digest,l.linked_at,p.created_at profile_created
 FROM recommendation_profile_session_link l JOIN recommendation_profile p ON p.id=l.profile_id AND p.privacy_generation=l.privacy_generation
 WHERE l.expires_at>'2026-09-15T02:03:52.496Z' AND p.state='active' AND p.expires_at>'2026-09-15T02:03:52.496Z'
 ORDER BY l.session_digest,l.linked_at DESC,l.id DESC
), outcomes AS MATERIALIZED (
 SELECT DISTINCT ON(o.episode_id) o.id outcome_id,o.qualified_view,o.created_at outcome_at,e.media_id,e.discovery_source,l.profile_id,l.privacy_generation
 FROM links l JOIN recommendation_playback_episode e ON e.session_digest=l.session_digest AND coalesce(e.claimed_at,e.created_at)>=greatest(l.profile_created,l.linked_at)
 JOIN recommendation_outcome_revision o ON o.episode_id=e.id AND o.classifier_version='active-watch-proxy-v1'
 WHERE o.created_at<'2026-09-15T01:45:00Z' AND o.expires_at>'2026-09-15T02:03:52.496Z'
 ORDER BY o.episode_id,o.revision DESC
), q AS MATERIALIZED (
 SELECT o.*,d.state,d.eligible_scopes,
 EXISTS(SELECT 1 FROM recommendation_profile_projection_contribution c JOIN recommendation_profile_projection_generation g ON g.id=c.generation_id WHERE c.source_outcome_id=o.outcome_id AND g.profile_id=o.profile_id AND g.privacy_generation=o.privacy_generation AND g.state='published') ever_projected,
 EXISTS(SELECT 1 FROM recommendation_profile_projection_pointer ptr JOIN recommendation_profile_projection_contribution c ON c.generation_id=ptr.generation_id WHERE ptr.profile_id=o.profile_id AND ptr.privacy_generation=o.privacy_generation AND c.source_outcome_id=o.outcome_id) in_current_profile,
 EXISTS(SELECT 1 FROM video_transcript t JOIN video_transcript_chunk c ON c.transcript_id=t.id JOIN content_embedding_contract_pointer ptr ON ptr.id='content-embedding-contract-pointer' JOIN content_embedding_contract contract ON contract.id=ptr.active_contract_id WHERE t.video_id=o.media_id AND t.language='en' AND c.embedding IS NOT NULL AND t.embedding_provider=contract.storage_provider AND t.model=contract.storage_model AND t.dimensions=contract.storage_dimensions AND t.embedding_native_dimensions=contract.storage_native_dimensions AND t.embedding_transform_version IS NOT DISTINCT FROM contract.storage_transform_version AND c.model=contract.storage_model AND c.dimensions=contract.storage_dimensions) has_english_embedding
 FROM outcomes o LEFT JOIN recommendation_eligibility_decision d ON d.outcome_id=o.outcome_id AND d.is_current AND d.policy_version='recommendation-integrity-v1' WHERE o.qualified_view
)
SELECT discovery_source,state,('profile'=ANY(eligible_scopes)) profile_eligible,has_english_embedding,count(*) qualified_outcomes,count(distinct profile_id) profiles,count(*) FILTER(WHERE ever_projected) ever_projected,count(*) FILTER(WHERE in_current_profile) in_current_profile FROM q GROUP BY 1,2,3,4 ORDER BY qualified_outcomes DESC;
WITH c AS MATERIALIZED (
 SELECT c.source_outcome_id,g.profile_id,min(g.published_at) first_projected_at,min(o.created_at) outcome_at
 FROM recommendation_profile_projection_contribution c JOIN recommendation_profile_projection_generation g ON g.id=c.generation_id JOIN recommendation_outcome_revision o ON o.id=c.source_outcome_id
 WHERE c.kind='qualified_outcome' AND o.created_at>='2026-09-08T01:45:00Z' AND o.created_at<'2026-09-15T01:45:00Z' AND g.state='published' GROUP BY 1,2
)
SELECT count(*) projected_outcomes,count(distinct profile_id) profiles,percentile_cont(0.5) within group(order by extract(epoch FROM first_projected_at-outcome_at)) publication_lag_median_seconds,percentile_cont(0.95) within group(order by extract(epoch FROM first_projected_at-outcome_at)) publication_lag_p95_seconds FROM c;
WITH generations AS MATERIALIZED (
 SELECT DISTINCT g.id,g.profile_id FROM recommendation_profile_projection_generation g JOIN recommendation_profile_projection_contribution c ON c.generation_id=g.id WHERE c.kind='qualified_outcome' AND g.state='published' AND g.published_at>='2026-09-08T01:45:00Z' AND g.published_at<'2026-09-15T01:45:00Z'
)
SELECT count(distinct g.profile_id) profiles_with_learned_generation,count(distinct g.profile_id) FILTER(WHERE d.request_id IS NOT NULL) profiles_with_later_personalized_request,count(distinct d.request_id) later_personalized_requests FROM generations g LEFT JOIN recommendation_personalization_decision d ON d.projection_generation_id=g.id AND d.execution_mode='hybrid_personalized' AND d.created_at<'2026-09-15T01:45:00Z';
SELECT r.surface_version,r.strategy_version,r.manifest_id,p.execution_mode,count(*) requests FROM recommendation_request r LEFT JOIN recommendation_personalization_decision p ON p.request_id=r.id WHERE r.created_at>='2026-09-08T01:45:00Z' AND r.created_at<'2026-09-15T01:45:00Z' GROUP BY 1,2,3,4 ORDER BY requests DESC;
