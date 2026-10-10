
WITH recent AS MATERIALIZED (
 SELECT locale FROM recommendation_request
 WHERE created_at >= CURRENT_TIMESTAMP - interval '24 hours'
 AND created_at <= CURRENT_TIMESTAMP
 ORDER BY created_at DESC, id DESC LIMIT 20001
), latest_retention AS (
 SELECT status, roots_deleted, started_at, completed_at, oldest_expired_at_after,
 reason_code FROM recommendation_retention_run
 WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1
)
SELECT jsonb_build_object(
 'measuredAt',clock_timestamp(), 'readOnly',current_setting('transaction_read_only'),
 'lockWaiters',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
 AND pid<>pg_backend_pid() AND wait_event_type='Lock'),
 'longTransactions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
 AND pid<>pg_backend_pid() AND xact_start < CURRENT_TIMESTAMP-interval '30 seconds'),
 'residentWalBytes',(SELECT coalesce(sum(size),0) FROM pg_ls_waldir()),
 'replicationSlots',(SELECT count(*) FROM pg_replication_slots),
 'slotRetainedWalBytes',(SELECT coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)),0) FROM pg_replication_slots),
 'recentRequests',(SELECT count(*) FROM recent),
 'recentEnglishRequests',(SELECT count(*) FROM recent WHERE locale='en'),
 'requestCapReached',(SELECT count(*)>20000 FROM recent),
 'graphGenerations',(SELECT count(*) FROM (SELECT id FROM recommendation_cowatch_generation LIMIT 1001) bounded),
 'ownerReleases',(SELECT count(*) FROM (SELECT id FROM recommendation_owner_release LIMIT 1001) bounded),
 'graphAllocatedBytes',(SELECT sum(pg_total_relation_size(name::regclass)) FROM unnest(ARRAY[
 'recommendation_cowatch_generation','recommendation_cowatch_source_contribution',
 'recommendation_cowatch_contribution','recommendation_cowatch_edge']) name),
 'ownerAllocatedBytes',pg_total_relation_size('recommendation_owner_release'),
 'latestRetention',(SELECT to_jsonb(latest_retention) FROM latest_retention),
 'oldestExpiredRequest',(SELECT expires_at FROM recommendation_request WHERE expires_at<=CURRENT_TIMESTAMP ORDER BY expires_at,id LIMIT 1)
);
