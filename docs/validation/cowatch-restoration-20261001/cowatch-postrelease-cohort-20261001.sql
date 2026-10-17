SET LOCAL statement_timeout='5000ms';
SET LOCAL lock_timeout='1000ms';
SET LOCAL jit=off;
WITH roots AS MATERIALIZED (SELECT id,locale,created_at,delivery_diagnostics,experiment_bypass_reason FROM recommendation_request WHERE created_at>='2026-10-01T02:58:00Z'::timestamptz AND created_at<'2026-10-01T03:02:13.744+00:00'::timestamptz ORDER BY created_at,id LIMIT 20001)
SELECT r.locale,r.delivery_diagnostics->>'requestedAudioLanguageSlug' requested_audio,
p.execution_mode,p.projection_scope,p.reason_code,r.experiment_bypass_reason,count(*) requests
FROM roots r LEFT JOIN LATERAL (SELECT execution_mode,projection_scope,reason_code FROM recommendation_personalization_decision WHERE request_id=r.id OFFSET 0) p ON true
WHERE (SELECT count(*) FROM roots)<=20000 GROUP BY 1,2,3,4,5,6 ORDER BY count(*) DESC;
