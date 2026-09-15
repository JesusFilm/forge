-- Fixed UTC cohort; SELECT only; run inside BEGIN READ ONLY with a statement timeout.
WITH r AS MATERIALIZED (
 SELECT r.*,p.execution_mode,p.reason_code personalization_reason
 FROM recommendation_request r LEFT JOIN recommendation_personalization_decision p ON p.request_id=r.id
 WHERE r.created_at >= '2026-09-08T01:35:00Z' AND r.created_at < '2026-09-15T01:35:00Z'
 AND r.expires_at > '2026-09-15T01:54:07.127Z'
), o AS MATERIALIZED (
 SELECT DISTINCT ON (o.episode_id,o.classifier_version) o.* FROM recommendation_outcome_revision o
 JOIN recommendation_playback_episode e ON e.id=o.episode_id JOIN r ON r.id=e.request_id
 WHERE o.created_at < '2026-09-15T01:35:00Z'
 ORDER BY o.episode_id,o.classifier_version,o.revision DESC
), f AS MATERIALIZED (
 SELECT r.id request_id,r.session_digest,r.created_at,r.locale,r.result,r.fallback_reason,r.seed_media_id,r.execution_mode,r.personalization_reason,
 i.id item_id,i.position,i.target_media_id,i.candidate_generator,i.presentation,
 (rf.id IS NOT NULL) rendered,(im.id IS NOT NULL) impressed,(s.id IS NOT NULL) selected,
 (s.id IS NOT NULL AND im.id IS NOT NULL AND s.occurred_at>=im.occurred_at) selected_after_impression,
 (e.claimed_at IS NOT NULL AND e.claimed_at<'2026-09-15T01:35:00Z') claimed,e.id episode_id,
 EXISTS(SELECT 1 FROM recommendation_playback_fact pf WHERE pf.episode_id=e.id AND pf.kind='playback_start' AND pf.received_at<'2026-09-15T01:35:00Z') started,
 a.id active_outcome,a.qualified_view active_qualified,a.active_playback_milliseconds active_ms,a.active_coverage,a.duration_seconds,a.reasons,
 l.qualified_view legacy_qualified
 FROM r LEFT JOIN recommendation_served_item i ON i.request_id=r.id
 LEFT JOIN recommendation_rendered_fact rf ON rf.item_id=i.id AND rf.received_at<'2026-09-15T01:35:00Z'
 LEFT JOIN recommendation_impression im ON im.item_id=i.id AND im.received_at<'2026-09-15T01:35:00Z'
 LEFT JOIN recommendation_selection s ON s.item_id=i.id AND s.received_at<'2026-09-15T01:35:00Z'
 LEFT JOIN recommendation_playback_episode e ON e.selection_id=s.id AND e.created_at<'2026-09-15T01:35:00Z'
 LEFT JOIN o a ON a.episode_id=e.id AND a.classifier_version='active-watch-proxy-v1'
 LEFT JOIN o l ON l.episode_id=e.id AND l.classifier_version='legacy-position-v0'
)
SELECT target_media_id,max(presentation->>'title') title,count(item_id) items,count(*) FILTER(WHERE impressed) impressions,count(*) FILTER(WHERE selected) selections,count(*) FILTER(WHERE selected_after_impression) selected_after_impression,count(*) FILTER(WHERE active_qualified) active_qualified FROM f WHERE item_id IS NOT NULL GROUP BY 1 ORDER BY selections DESC,impressions DESC LIMIT 20;
