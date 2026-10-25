SELECT now() observed_at,current_setting('transaction_read_only') read_only;
SELECT c.relname,c.reltuples::bigint estimated_rows,pg_relation_size(c.oid) heap_bytes,pg_indexes_size(c.oid) index_bytes,s.n_live_tup,s.n_dead_tup,s.last_analyze,s.last_autoanalyze
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
WHERE n.nspname='public' AND c.relname IN ('recommendation_playback_episode','recommendation_playback_fact','recommendation_outcome_revision','recommendation_cowatch_source_contribution','recommendation_eligibility_decision');
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('recommendation_playback_episode','recommendation_playback_fact') ORDER BY tablename,indexname;
