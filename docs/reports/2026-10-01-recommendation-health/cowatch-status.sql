SELECT now() db_time,current_setting('transaction_read_only') read_only;
SELECT p.stage,p.generation,p.active_manifest_id,p.kill_switch_enabled,p.exposure_ceiling_bps,p.owner_influence_floor_generation,p.updated_at,
 r.pointer_generation,r.manifest_id,r.approved_at,r.qualified_at,r.valid_until,r.dependency_expires_at,r.revoked_at,r.revocation_reason,
 g.published_at,g.invalidated_at,g.invalidation_reason,g.source_count,g.contribution_count,g.edge_count,g.distinct_viewer_count,g.terminal_decision,g.decision_reason
FROM recommendation_promotion_pointer p LEFT JOIN recommendation_owner_release r ON r.id=p.active_owner_release_id LEFT JOIN recommendation_cowatch_generation g ON g.id=r.graph_generation_id;
SELECT pointer_generation,approved_at,valid_until,revoked_at,revocation_reason FROM recommendation_owner_release ORDER BY approved_at DESC LIMIT 10;
SELECT published_at,source_count,contribution_count,edge_count,distinct_viewer_count,terminal_decision,decision_reason,invalidated_at,invalidation_reason,expires_at FROM recommendation_cowatch_generation ORDER BY published_at DESC LIMIT 10;
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='recommendation_candidate_run' ORDER BY ordinal_position;
SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('recommendation_serving_control','recommendation_control_evaluation','recommendation_playback_signal_readiness') ORDER BY table_name,ordinal_position;
SELECT pg_size_pretty(pg_database_size(current_database())) database_size;
SELECT status,started_at,completed_at,roots_deleted,oldest_expired_at_after,reason_code FROM recommendation_retention_run ORDER BY started_at DESC LIMIT 3;
