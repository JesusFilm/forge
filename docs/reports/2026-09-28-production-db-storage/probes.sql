-- Aggregate/catalog-only probes. No request IDs, viewer data, or credentials.
-- Run in a dedicated read-only connection with the timeouts below.
-- probe: safety
SET default_transaction_read_only = on;
SET statement_timeout = '10s';
SET lock_timeout = '1s';
SET idle_in_transaction_session_timeout = '15s';
SET timezone = 'UTC';

-- probe: database
SELECT now() AS measured_at, current_database() AS database,
       current_setting('server_version') AS server_version,
       current_setting('default_transaction_read_only') AS read_only,
       pg_database_size(current_database()) AS database_bytes;

-- probe: largest_relations
SELECT s.schemaname, s.relname,
       pg_total_relation_size(s.relid) AS total_bytes,
       pg_table_size(s.relid) AS table_bytes,
       pg_indexes_size(s.relid) AS index_bytes,
       s.n_live_tup AS estimated_live_rows, s.n_dead_tup AS estimated_dead_rows,
       s.last_autovacuum, s.last_autoanalyze
FROM pg_stat_user_tables s
ORDER BY pg_total_relation_size(s.relid) DESC
LIMIT 20;

-- probe: recommendation_total
SELECT count(*) AS tables,
       sum(pg_total_relation_size(relid)) AS total_bytes,
       sum(pg_table_size(relid)) AS table_bytes,
       sum(pg_indexes_size(relid)) AS index_bytes
FROM pg_stat_user_tables
WHERE schemaname = 'public' AND starts_with(relname, 'recommendation_');

-- probe: evidence_indexes
SELECT c.relname AS index_name, pg_relation_size(c.oid) AS bytes,
       i.indisunique, i.indisprimary, i.indisvalid,
       pg_get_indexdef(c.oid) AS definition, con.contype AS constraint_type,
       st.idx_scan
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
LEFT JOIN pg_stat_user_indexes st ON st.indexrelid = i.indexrelid
WHERE i.indrelid = 'public.recommendation_candidate_stage_evidence'::regclass
ORDER BY c.relname;

-- probe: request_horizon
SELECT (SELECT created_at FROM recommendation_request ORDER BY created_at, id LIMIT 1) AS oldest_created_at,
       (SELECT expires_at FROM recommendation_request ORDER BY expires_at, id LIMIT 1) AS first_expiry,
       (SELECT created_at FROM recommendation_request ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_created_at,
       (SELECT count(*) FROM recommendation_request WHERE expires_at <= now()) AS expired_roots,
       (SELECT count(*) FROM recommendation_request WHERE expires_at <= now() - interval '24 hours') AS overdue_roots,
       (SELECT count(*) FROM recommendation_request WHERE created_at >= now() - interval '24 hours') AS requests_last_24h;

-- probe: recent_daily_requests
SELECT date_trunc('day', created_at) AS day_utc, count(*) AS requests
FROM recommendation_request
WHERE created_at >= now() - interval '7 days'
GROUP BY 1 ORDER BY 1;

-- probe: latest_candidate_run_sample
WITH sample AS MATERIALIZED (
  SELECT nominated_count, canonicalized_count, deduplicated_count,
         rejected_count, scored_count, ordered_count, composed_count,
         created_at
  FROM recommendation_candidate_run ORDER BY created_at DESC, id DESC LIMIT 1000
)
SELECT count(*) AS sampled_runs, min(created_at) AS window_start,
       max(created_at) AS window_end,
       round(avg(nominated_count + canonicalized_count + deduplicated_count +
                 rejected_count + scored_count + ordered_count + composed_count), 2) AS mean_stage_rows,
       round(avg(composed_count), 2) AS mean_served_items,
       round(avg(nominated_count), 2) AS mean_nominated,
       round(avg(canonicalized_count), 2) AS mean_canonicalized,
       round(avg(deduplicated_count), 2) AS mean_deduplicated,
       round(avg(rejected_count), 2) AS mean_rejected,
       round(avg(scored_count), 2) AS mean_scored,
       round(avg(ordered_count), 2) AS mean_ordered
FROM sample;

-- probe: recent_retention
SELECT status, batch_size, roots_deleted, row_counts,
       oldest_expired_at_after, reason_code, started_at, completed_at
FROM recommendation_retention_run ORDER BY started_at DESC LIMIT 10;

-- probe: retention_history
SELECT status, count(*) AS runs, sum(roots_deleted) AS roots_deleted,
       min(started_at) AS first_run, max(completed_at) AS latest_completed
FROM recommendation_retention_run GROUP BY status;

-- probe: tracing_migrations
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name IN ('0052_production_semantic_recommendation_tracer',
                         '0058_recommendation_candidate_platform',
                         '0069_recommendation_hybrid_composition')
ORDER BY migration_name;

-- probe: wal_and_slots
SELECT (SELECT sum(size) FROM pg_ls_waldir()) AS wal_bytes,
       (SELECT count(*) FROM pg_replication_slots) AS replication_slots;
