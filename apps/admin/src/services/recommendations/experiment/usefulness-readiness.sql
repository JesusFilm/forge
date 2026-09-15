-- Read-only inventory, not an A/B result or a completeness certificate.
-- psql -X --set=ON_ERROR_STOP=1 --file=usefulness-readiness.sql "$READ_ONLY_DATABASE_URL"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

SELECT current_timestamp AS captured_at, current_setting('transaction_read_only') AS read_only;

SELECT experiment.experiment_version, experiment.surface_version,
       experiment.generation, experiment.state, experiment.starts_at,
       experiment.ends_at, experiment.control_manifest_id,
       experiment.challenger_manifest_id, experiment.challenger_probability,
       experiment.assignment_policy_version, experiment.outcome_policy_version,
       experiment.evaluation_policy_version, experiment.configuration_digest,
       assignment.unit_kind, assignment.arm, assignment.state AS assignment_state,
       COUNT(assignment.id) AS retained_assigned_units,
       COUNT(assignment.id) FILTER (WHERE assignment.expires_at <= current_timestamp) AS expired_units
FROM recommendation_experiment experiment
LEFT JOIN recommendation_experiment_assignment assignment
  ON assignment.experiment_id = experiment.id
  AND assignment.generation = experiment.generation
WHERE experiment.surface_version = 'watch-below-player-v1'
  AND experiment.expires_at > current_timestamp
GROUP BY experiment.id, assignment.unit_kind, assignment.arm, assignment.state
ORDER BY experiment.starts_at DESC, assignment.unit_kind, assignment.arm, assignment.state;

WITH scoped_requests AS MATERIALIZED (
  SELECT id, experiment_assignment_id, created_at, locale
  FROM recommendation_request
  WHERE created_at >= current_timestamp - interval '24 hours'
    AND created_at < current_timestamp
    AND surface_version = 'watch-below-player-v1'
), scoped_items AS MATERIALIZED (
  SELECT item.id, item.request_id
  FROM recommendation_served_item item
  JOIN scoped_requests request ON request.id = item.request_id
)
SELECT request.locale,
       COUNT(DISTINCT request.id) AS requests,
       COUNT(DISTINCT request.id) FILTER (WHERE request.experiment_assignment_id IS NOT NULL) AS assigned_requests,
       COUNT(DISTINCT item.id) AS served_items,
       COUNT(DISTINCT impression.item_id) AS visible_items,
       COUNT(DISTINCT exposure.item_id) AS experiment_exposed_items
FROM scoped_requests request
LEFT JOIN scoped_items item ON item.request_id = request.id
LEFT JOIN recommendation_impression impression
  ON impression.request_id = item.request_id AND impression.item_id = item.id
LEFT JOIN recommendation_experiment_exposure exposure
  ON exposure.request_id = item.request_id AND exposure.item_id = item.id
GROUP BY request.locale
ORDER BY requests DESC, request.locale;

ROLLBACK;
