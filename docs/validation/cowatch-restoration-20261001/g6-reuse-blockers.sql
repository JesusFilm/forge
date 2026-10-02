-- Read-only, exact G6 with source guard; no source identities/history returned.
SET LOCAL enable_seqscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL jit=off;
SELECT now() observed_at,current_setting('transaction_read_only') read_only;
WITH source_bound AS MATERIALIZED (
 SELECT eligibility_decision_id FROM recommendation_cowatch_source_contribution
 WHERE generation_id='ba4d332f88695f36230308de1ed88820bdb9ddb5d14f0f4c89b7fba56d9c91b7'
 ORDER BY outcome_id LIMIT 6681
), sources AS MATERIALIZED (SELECT * FROM source_bound WHERE (SELECT count(*) FROM source_bound)<=6680),
changed AS MATERIALIZED (
 SELECT old.*, successor.id successor_id,successor.decided_at successor_at,
 successor.expires_at successor_expiry,successor.evidence_watermark successor_watermark,
 successor.content_action_id successor_action,successor.selection_id successor_selection,
 successor.source_type successor_type,successor.outcome_id successor_outcome,
 successor.actor_class successor_actor,successor.policy_version successor_policy,
 successor.contribution_ordinal successor_ordinal,successor.distinct_support successor_support,
 successor.identity_concentration successor_concentration
 FROM sources s JOIN recommendation_eligibility_decision old ON old.id=s.eligibility_decision_id
 JOIN LATERAL (
 SELECT * FROM recommendation_eligibility_decision d WHERE d.source_key=old.source_key AND d.policy_version=old.policy_version AND d.revision>old.revision ORDER BY revision LIMIT 1
 ) successor ON NOT old.is_current
), observed AS MATERIALIZED (
 SELECT c.*,
 o.id IS NOT NULL outcome_found,e.id IS NOT NULL episode_found,
 o.created_at outcome_created_at,o.expires_at outcome_expiry,
 e.transport_replay_count,e.replay_count,e.conflict_count,
 replay.count_before_captured,replay.count_after_capture_before_successor,replay.count_after_successor,
 EXISTS(SELECT 1 FROM recommendation_outcome_revision newer WHERE newer.supersedes_id=o.id) outcome_now_superseded
 FROM changed c LEFT JOIN recommendation_outcome_revision o ON o.id=c.outcome_id
 LEFT JOIN recommendation_playback_episode e ON e.id=o.episode_id
 LEFT JOIN LATERAL (
 SELECT count(*) FILTER(WHERE r.observed_at<=c.decided_at) count_before_captured,
 count(*) FILTER(WHERE r.observed_at>c.decided_at AND r.observed_at<=c.successor_at) count_after_capture_before_successor,
 count(*) FILTER(WHERE r.observed_at>c.successor_at) count_after_successor
 FROM (SELECT observed_at FROM recommendation_playback_transport_replay_receipt WHERE episode_id=e.id ORDER BY observed_at LIMIT 257) r
 ) replay ON true
)
SELECT CASE WHEN successor_at='2026-09-30T03:07:39.005Z'::timestamp THEN 'exact_timestamp'
 WHEN successor_at BETWEEN '2026-09-30T03:06:39.005Z'::timestamp AND '2026-09-30T03:08:39.005Z'::timestamp THEN 'near_60s'
 WHEN successor_at<'2026-09-30T03:06:39.005Z'::timestamp THEN 'earlier' ELSE 'later' END successor_timing,
 count(*) successors,min(successor_at) first_successor_at,max(successor_at) last_successor_at,
 count(*) FILTER(WHERE successor_expiry IS DISTINCT FROM expires_at) expiry_changed,
 count(*) FILTER(WHERE expires_at<=successor_at) captured_expired_at_successor,
 count(*) FILTER(WHERE successor_watermark IS DISTINCT FROM evidence_watermark) watermark_changed,
 count(*) FILTER(WHERE successor_type IS DISTINCT FROM source_type OR successor_outcome IS DISTINCT FROM outcome_id OR successor_action IS DISTINCT FROM content_action_id OR successor_selection IS DISTINCT FROM selection_id) source_changed,
 count(*) FILTER(WHERE successor_actor IS DISTINCT FROM actor_class) actor_changed,
 count(*) FILTER(WHERE successor_policy IS DISTINCT FROM policy_version) policy_changed,
 count(*) FILTER(WHERE successor_ordinal IS DISTINCT FROM contribution_ordinal) ordinal_changed,
 count(*) FILTER(WHERE successor_support IS DISTINCT FROM distinct_support) support_changed,
 count(*) FILTER(WHERE successor_concentration IS DISTINCT FROM identity_concentration) concentration_changed,
 count(*) FILTER(WHERE NOT outcome_found OR NOT episode_found) missing_current_dependencies,
 count(*) FILTER(WHERE outcome_now_superseded) outcome_now_superseded,
 count(*) FILTER(WHERE outcome_expiry IS DISTINCT FROM expires_at) current_outcome_expiry_differs,
 count(*) FILTER(WHERE transport_replay_count>0) current_transport_replay_sources,
 count(*) FILTER(WHERE replay_count>0) current_replay_sources,
 count(*) FILTER(WHERE conflict_count>0) current_conflict_sources,
 count(*) FILTER(WHERE count_before_captured>0) receipts_before_captured,
 count(*) FILTER(WHERE count_after_capture_before_successor>0) sources_with_receipts_between_capture_and_successor,
 sum(count_after_capture_before_successor) receipts_between_capture_and_successor,
 count(*) FILTER(WHERE count_after_successor>0) sources_with_receipts_after_successor,
 count(*) FILTER(WHERE count_before_captured+count_after_capture_before_successor+count_after_successor>256) receipt_bound_exceeded
FROM observed GROUP BY 1 ORDER BY 1;
