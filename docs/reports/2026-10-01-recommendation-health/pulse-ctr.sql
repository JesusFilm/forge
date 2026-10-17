-- Fixed request cohorts; evidence received before cutoff. Read-only transaction required.
WITH r AS MATERIALIZED (
 SELECT r.id,r.created_at,r.surface_version,r.served_item_payload,p.execution_mode,
 CASE WHEN r.created_at>='2026-09-29T18:42:00Z' THEN 'latest_24h' ELSE 'previous_24h' END period
 FROM recommendation_request r LEFT JOIN recommendation_personalization_decision p ON p.request_id=r.id
 WHERE r.created_at>='2026-09-28T18:42:00Z' AND r.created_at<'2026-09-30T18:42:00Z'
), qualified AS MATERIALIZED (
 SELECT DISTINCT e.item_id
 FROM r JOIN recommendation_playback_episode e ON e.request_id=r.id
 JOIN LATERAL (
 SELECT o.qualified_view FROM recommendation_outcome_revision o
 WHERE o.episode_id=e.id AND o.classifier_version='active-watch-proxy-v1' AND o.created_at<'2026-09-30T18:42:00Z'
 ORDER BY o.revision DESC LIMIT 1
 ) o ON o.qualified_view
), f AS MATERIALIZED (
 SELECT r.id,r.period,r.surface_version,r.execution_mode,i.id item_id,
 rf.id IS NOT NULL rendered,im.id IS NOT NULL impressed,s.id IS NOT NULL selected,
 s.id IS NOT NULL AND im.id IS NOT NULL AND s.occurred_at>=im.occurred_at matched,
 q.item_id IS NOT NULL qualified,
 EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->'sources') src WHERE src->>'generator'='multi-interest-profile' AND src->>'rejectionReason' IS NULL) profile_contributed
 FROM r LEFT JOIN recommendation_served_item i ON i.request_id=r.id
 LEFT JOIN recommendation_rendered_fact rf ON rf.item_id=i.id AND rf.received_at<'2026-09-30T18:42:00Z'
 LEFT JOIN recommendation_impression im ON im.item_id=i.id AND im.received_at<'2026-09-30T18:42:00Z'
 LEFT JOIN recommendation_selection s ON s.item_id=i.id AND s.received_at<'2026-09-30T18:42:00Z'
 LEFT JOIN qualified q ON q.item_id=i.id
)
SELECT period,surface_version,CASE WHEN GROUPING(execution_mode)=1 THEN 'all_modes' ELSE coalesce(execution_mode,'not_recorded') END mode,
 count(distinct id) requests,count(item_id) cards,
 count(*) FILTER(WHERE rendered) rendered,count(*) FILTER(WHERE impressed) impressions,
 count(*) FILTER(WHERE selected) clicks,count(*) FILTER(WHERE matched) matched_clicks,
 count(*) FILTER(WHERE selected AND NOT matched) unmatched_clicks,
 round(100.0*count(*) FILTER(WHERE matched)/nullif(count(*) FILTER(WHERE impressed),0),2) ctr_percent,
 count(*) FILTER(WHERE qualified) qualified_selected_cards,
 count(*) FILTER(WHERE profile_contributed AND impressed) profile_card_impressions,
 count(*) FILTER(WHERE profile_contributed AND matched) profile_card_matched_clicks,
 count(*) FILTER(WHERE profile_contributed AND qualified) profile_card_qualified_views
FROM f GROUP BY GROUPING SETS ((period,surface_version,execution_mode),(period,surface_version))
ORDER BY period,surface_version,mode;
