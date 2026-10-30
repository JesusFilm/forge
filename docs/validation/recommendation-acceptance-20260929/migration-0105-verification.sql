BEGIN READ ONLY;
SET LOCAL statement_timeout = '3000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '5000ms';
WITH migration_rows AS (
  SELECT checksum, started_at, finished_at, rolled_back_at, applied_steps_count
  FROM public._prisma_migrations
  WHERE migration_name = '0105_watch_surface_served_manifest'
), expected_index AS (
  SELECT i.indisunique, i.indisvalid, i.indisready, i.indnkeyatts, i.indnatts,
         am.amname AS access_method,
         pg_get_indexdef(i.indexrelid) AS definition,
         pg_get_expr(i.indpred, i.indrelid) AS predicate,
         ARRAY(SELECT pg_get_indexdef(i.indexrelid, ordinal, true)
               FROM generate_series(1, i.indnkeyatts) ordinal) AS key_columns
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_am am ON am.oid = c.relam
  WHERE n.nspname = 'public'
    AND c.relname = 'watch_surface_exposure_served_item_key'
    AND i.indrelid = to_regclass('public.watch_surface_exposure')
), expected_constraint AS (
  SELECT contype, convalidated,
         pg_get_constraintdef(oid, true) AS definition
  FROM pg_constraint
  WHERE conrelid = to_regclass('public.watch_surface_exposure')
    AND conname = 'watch_surface_exposure_kind_check'
)
SELECT jsonb_build_object(
  'probe', 'watch_migration_0105',
  'observedAt', statement_timestamp(),
  'transactionReadOnly', current_setting('transaction_read_only'),
  'statementTimeout', current_setting('statement_timeout'),
  'lockTimeout', current_setting('lock_timeout'),
  'tablePresent', to_regclass('public.watch_surface_exposure') IS NOT NULL,
  'unfinishedMigrationCount', (SELECT count(*) FROM public._prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL),
  'migrationRows', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM migration_rows m), '[]'::jsonb),
  'indexRows', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM expected_index i), '[]'::jsonb),
  'constraintRows', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM expected_constraint c), '[]'::jsonb)
);
ROLLBACK;
