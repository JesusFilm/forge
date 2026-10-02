WITH o AS MATERIALIZED (
 SELECT DISTINCT ON (episode_id) * FROM recommendation_outcome_revision
 WHERE created_at>='2026-09-29T18:42:00Z' AND created_at<'2026-09-30T18:42:00Z' AND classifier_version='active-watch-proxy-v1'
 ORDER BY episode_id,revision DESC
)
SELECT CASE WHEN e.request_id IS NULL THEN 'source_neutral_without_recommendation_request' ELSE 'recommendation_linked' END origin,
count(*) classified_episodes,count(*) FILTER(WHERE o.qualified_view) qualified_views,
count(*) FILTER(WHERE o.qualified_view AND e.state='finalized') finalized_qualified,
count(*) FILTER(WHERE o.qualified_view AND EXISTS(SELECT 1 FROM recommendation_eligibility_decision d WHERE d.outcome_id=o.id AND d.is_current AND d.state='eligible' AND 'profile'=ANY(d.eligible_scopes))) currently_profile_eligible,
count(*) FILTER(WHERE o.qualified_view AND EXISTS(SELECT 1 FROM recommendation_profile_projection_contribution c JOIN recommendation_profile_projection_generation g ON g.id=c.generation_id WHERE c.source_outcome_id=o.id AND g.published_at<'2026-09-30T18:42:00Z')) retained_published_profile_contributions
FROM o JOIN recommendation_playback_episode e ON e.id=o.episode_id GROUP BY 1;
SELECT count(*) generations,count(distinct profile_id) profiles,count(*) FILTER(WHERE contribution_count>0) populated_generations,count(distinct profile_id) FILTER(WHERE durable_interest_count>0) profiles_with_durable_interests,
percentile_cont(0.5) WITHIN GROUP(ORDER BY contribution_count) contribution_count_p50,max(contribution_count) contribution_count_max
FROM recommendation_profile_projection_generation WHERE published_at>='2026-09-29T18:42:00Z' AND published_at<'2026-09-30T18:42:00Z' AND state='published';
SELECT state,failure_reason,last_transition_reason,count(*) runs,min(created_at) oldest_created,max(completed_at) latest_completed
FROM recommendation_profile_projection_run WHERE created_at>='2026-09-29T18:42:00Z' AND created_at<'2026-09-30T18:42:00Z' GROUP BY 1,2,3 ORDER BY runs DESC;
SELECT r.surface_version,p.execution_mode,count(distinct r.id) requests,count(distinct g.profile_id) profiles,count(*) FILTER(WHERE g.id IS NULL) missing_projection,
count(*) FILTER(WHERE g.expires_at<=r.created_at) expired_projection_at_issuance,count(*) FILTER(WHERE g.published_at>r.created_at) future_projection_at_issuance,
count(*) FILTER(WHERE p.interest_count=0) zero_interest_requests
FROM recommendation_request r JOIN recommendation_personalization_decision p ON p.request_id=r.id LEFT JOIN recommendation_profile_projection_generation g ON g.id=p.projection_generation_id
WHERE r.created_at>='2026-09-29T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z' AND p.execution_mode='hybrid_personalized' GROUP BY 1,2;
SELECT count(*) requests,count(*) FILTER(WHERE experiment_assignment_id IS NOT NULL) experiment_assigned FROM recommendation_request WHERE created_at>='2026-09-29T18:42:00Z' AND created_at<'2026-09-30T18:42:00Z';
SELECT kind,reason_code,sum(count) audit_events FROM recommendation_evidence_audit WHERE occurred_at>='2026-09-29T18:42:00Z' AND occurred_at<'2026-09-30T18:42:00Z' AND kind::text NOT IN ('evidence_success','delivery_success') GROUP BY 1,2 ORDER BY audit_events DESC LIMIT 12;
