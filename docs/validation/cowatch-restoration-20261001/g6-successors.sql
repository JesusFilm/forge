SET LOCAL enable_seqscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL jit=off;
SELECT now() observed_at,current_setting('transaction_read_only') read_only;
-- One statement / one snapshot. Exact known graph only; LIMIT precedes every join.
-- $1 exact graph char(64); $2 known first revocation UTC timestamp (not a history cutoff).
WITH physical_sources AS MATERIALIZED (
  SELECT outcome_id, eligibility_decision_id
  FROM recommendation_cowatch_source_contribution
  WHERE generation_id = 'ba4d332f88695f36230308de1ed88820bdb9ddb5d14f0f4c89b7fba56d9c91b7'::char(64)
  ORDER BY outcome_id
  LIMIT 6681
), admitted_sources AS MATERIALIZED (
  SELECT * FROM physical_sources WHERE (SELECT count(*) FROM physical_sources) <= 6680
), compared AS MATERIALIZED (
  SELECT old.id IS NOT NULL AS captured_found,
    old.is_current AS captured_current,
    successor.id IS NOT NULL AS successor_found,
    successor.revision = old.revision + 1 AS successor_consecutive,
    successor.decided_at BETWEEN '2026-09-30T03:07:39.005Z'::timestamp - interval '60 seconds'
      AND '2026-09-30T03:07:39.005Z'::timestamp + interval '60 seconds' AS successor_near_revocation,
    successor.decided_at < '2026-09-30T03:07:39.005Z'::timestamp - interval '60 seconds' AS successor_earlier,
    successor.decided_at > '2026-09-30T03:07:39.005Z'::timestamp + interval '60 seconds' AS successor_later,
    successor.state IS DISTINCT FROM old.state AS state_changed,
    NOT (successor.reason_codes @> old.reason_codes AND old.reason_codes @> successor.reason_codes) AS reasons_changed,
    NOT (successor.eligible_scopes @> old.eligible_scopes AND old.eligible_scopes @> successor.eligible_scopes) AS scopes_changed,
    successor.contribution_weight IS DISTINCT FROM old.contribution_weight AS weight_changed,
    successor.actor_class IS DISTINCT FROM old.actor_class AS actor_changed,
    (successor.source_type IS DISTINCT FROM old.source_type OR successor.outcome_id IS DISTINCT FROM old.outcome_id) AS source_changed,
    successor.input_digest IS DISTINCT FROM old.input_digest AS digest_changed,
    (successor.contribution_ordinal IS DISTINCT FROM old.contribution_ordinal
      OR successor.distinct_support IS DISTINCT FROM old.distinct_support
      OR successor.identity_concentration IS DISTINCT FROM old.identity_concentration) AS measures_changed,
    old.state = 'eligible' AND 'aggregate' = ANY(old.eligible_scopes) AND old.contribution_weight > 0 AS captured_positive,
    successor.state = 'eligible' AND 'aggregate' = ANY(successor.eligible_scopes) AND successor.contribution_weight > 0 AS successor_positive,
    successor.state::text AS successor_state,
    successor.reason_codes AS successor_reasons
  FROM admitted_sources source
  LEFT JOIN LATERAL (
    SELECT id, source_key, policy_version, revision, is_current, state, reason_codes, eligible_scopes,
      contribution_weight, actor_class, source_type, outcome_id, input_digest,
      contribution_ordinal, distinct_support, identity_concentration
    FROM recommendation_eligibility_decision
    WHERE id = source.eligibility_decision_id LIMIT 1
  ) old ON true
  LEFT JOIN LATERAL (
    -- First RETAINED successor. Range bound + ordering use the three-key unique index.
    -- No time filter that could scan arbitrary history; timestamps are classified afterward.
    SELECT id, revision, decided_at, state, reason_codes, eligible_scopes,
      contribution_weight, actor_class, source_type, outcome_id, input_digest,
      contribution_ordinal, distinct_support, identity_concentration
    FROM recommendation_eligibility_decision
    WHERE source_key = old.source_key AND policy_version = old.policy_version AND revision > old.revision
    ORDER BY revision LIMIT 1
  ) successor ON true
), classified AS MATERIALIZED (
  SELECT *, captured_positive AND successor_positive AND NOT state_changed
    AND NOT reasons_changed AND NOT scopes_changed AND NOT weight_changed
    AND NOT actor_changed AND NOT source_changed AS same_positive_decision
  FROM compared
)
SELECT jsonb_build_object(
  'observedSourceRows', (SELECT count(*) FROM physical_sources),
  'sourcePopulationComplete', (SELECT count(*) = 6680 FROM physical_sources),
  'sourceBoundExceeded', (SELECT count(*) > 6680 FROM physical_sources),
  'comparedSourceRows', count(*),
  'capturedMissing', count(*) FILTER (WHERE NOT captured_found),
  'capturedCurrent', count(*) FILTER (WHERE captured_found AND captured_current),
  'capturedNotCurrent', count(*) FILTER (WHERE captured_found AND NOT captured_current),
  'capturedNotCurrentWithoutSuccessor', count(*) FILTER (WHERE captured_found AND NOT captured_current AND NOT successor_found),
  'retainedSuccessors', count(*) FILTER (WHERE successor_found),
  'successorRevisionGaps', count(*) FILTER (WHERE successor_found AND NOT successor_consecutive),
  'successorsWhileCapturedCurrent', count(*) FILTER (WHERE successor_found AND captured_current),
  'samePositiveDecision', count(*) FILTER (WHERE successor_found AND same_positive_decision),
  'changedEffectiveDecision', count(*) FILTER (WHERE successor_found AND (state_changed OR reasons_changed OR scopes_changed OR weight_changed OR actor_changed OR source_changed)),
  'successorStillPositive', count(*) FILTER (WHERE successor_found AND successor_positive),
  'successorNotPositive', count(*) FILTER (WHERE successor_found AND NOT successor_positive),
  'stateChanged', count(*) FILTER (WHERE successor_found AND state_changed),
  'reasonsChanged', count(*) FILTER (WHERE successor_found AND reasons_changed),
  'scopesChanged', count(*) FILTER (WHERE successor_found AND scopes_changed),
  'weightChanged', count(*) FILTER (WHERE successor_found AND weight_changed),
  'actorChanged', count(*) FILTER (WHERE successor_found AND actor_changed),
  'sourceChanged', count(*) FILTER (WHERE successor_found AND source_changed),
  'inputDigestChanged', count(*) FILTER (WHERE successor_found AND digest_changed),
  'measuresChanged', count(*) FILTER (WHERE successor_found AND measures_changed),
  'successorEarlierThanRevocationWindow', count(*) FILTER (WHERE successor_found AND successor_earlier),
  'successorWithin60SecondsOfRevocation', count(*) FILTER (WHERE successor_found AND successor_near_revocation),
  'successorLaterThanRevocationWindow', count(*) FILTER (WHERE successor_found AND successor_later),
  'samePositiveNearRevocation', count(*) FILTER (WHERE successor_found AND same_positive_decision AND successor_near_revocation),
  'changedDecisionNearRevocation', count(*) FILTER (WHERE successor_found AND successor_near_revocation AND (state_changed OR reasons_changed OR scopes_changed OR weight_changed OR actor_changed OR source_changed)),
  'successorStates', jsonb_build_object(
    'eligible', count(*) FILTER (WHERE successor_state = 'eligible'),
    'excluded', count(*) FILTER (WHERE successor_state = 'excluded'),
    'quarantined', count(*) FILTER (WHERE successor_state = 'quarantined')),
  'successorReasons', jsonb_build_object(
    'conflicting_evidence', count(*) FILTER (WHERE 'conflicting_evidence' = ANY(successor_reasons)),
    'late_evidence', count(*) FILTER (WHERE 'late_evidence' = ANY(successor_reasons)),
    'superseded_outcome_revision', count(*) FILTER (WHERE 'superseded_outcome_revision' = ANY(successor_reasons)),
    'replay_velocity_exceeded', count(*) FILTER (WHERE 'replay_velocity_exceeded' = ANY(successor_reasons)),
    'qualified_view_required', count(*) FILTER (WHERE 'qualified_view_required' = ANY(successor_reasons)),
    'identity_content_contribution_cap', count(*) FILTER (WHERE 'identity_content_contribution_cap' = ANY(successor_reasons)),
    'anonymous_concentration_exceeded', count(*) FILTER (WHERE 'anonymous_concentration_exceeded' = ANY(successor_reasons)),
    'aggregate_distinct_support_pending', count(*) FILTER (WHERE 'aggregate_distinct_support_pending' = ANY(successor_reasons)),
    'promotion_rollback', count(*) FILTER (WHERE 'promotion_rollback' = ANY(successor_reasons)),
    'other_redacted', count(*) FILTER (WHERE successor_found AND NOT successor_reasons <@ ARRAY[
      'conflicting_evidence','late_evidence','superseded_outcome_revision','replay_velocity_exceeded',
      'qualified_view_required','identity_content_contribution_cap','anonymous_concentration_exceeded',
      'aggregate_distinct_support_pending','promotion_rollback']::text[]))) AS aggregates
FROM classified;
