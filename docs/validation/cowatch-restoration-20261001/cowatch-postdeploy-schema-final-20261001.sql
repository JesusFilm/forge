SET LOCAL statement_timeout='5000ms';
SET LOCAL lock_timeout='1000ms';
SET LOCAL idle_in_transaction_session_timeout='10000ms';
SELECT jsonb_build_object('observedAt',clock_timestamp(),'readOnly',current_setting('transaction_read_only'),
'migrations',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'finishedAt',finished_at,'rolledBackAt',rolled_back_at)) FROM _prisma_migrations WHERE migration_name IN ('0126_recommendation_cowatch_refresh','0126_recommendation_delivery_diagnostics')),
'grantTable',to_regclass('recommendation_cowatch_refresh_grant')::text,
'attemptTable',to_regclass('recommendation_cowatch_refresh_attempt')::text,
'scheduler',(SELECT jsonb_build_object('status',status,'startedAt',started_at,'updatedAt',updated_at,'nextRunAt',details->>'nextRunAt','lastBatchStatus',details->>'lastBatchStatus') FROM workflow_run WHERE workflow_key='recommendation-cowatch-refresh-scheduler' ORDER BY updated_at DESC LIMIT 1)) status;
