-- Substitute only the four __...__ literals with reviewed future receipt values.
-- Execute using the existing query-readonly.cjs runner (already BEGIN READ ONLY).
-- All output is aggregate or release/workflow identity; no viewer/request/item ID leaves DB.
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '10000ms';
SET LOCAL jit = off;
WITH expected AS MATERIALIZED (
  SELECT 'be1947f1-3302-4a26-9b40-beb53d06a5f9'::uuid release_id,
    'b5a47a2824cdf8adb9af02ec4c128ad80f430336199871313cfb1461afc89a8f'::text graph_id,
    '2026-10-01T02:58:00.000Z'::timestamptz proof_start,
    '2026-10-01T03:06:14.516Z'::timestamptz proof_end,
    'hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1'::text manifest_id,
    'c88bb7dd062506e212e04abae73d3c2704643454625bbd6dd0edc3d9913870cd'::text manifest_digest,
    '77f82d289ffb83e4527eba2a43d7459adad89798db37ecc2cdd4587bdf26a9a6'::text configuration_digest,
    '468450410923541b610893ad9851a0505c68f47d1273c1e09b413eddd7e6e6fa'::text composition_config_digest
), release AS MATERIALIZED (
  SELECT r.*,
    r.graph_generation_id = e.graph_id
      AND r.manifest_id = e.manifest_id AND r.manifest_digest = e.manifest_digest
      AND r.binding->>'compositionConfigDigest' = e.composition_config_digest
      AND r.binding->>'policyVersion' = 'owner-approved-no-study-v1'
      AND r.binding->>'mode' = 'current-source-owner-live-v1' exact_reviewed_binding
  FROM recommendation_owner_release r JOIN expected e ON e.release_id=r.id
), roots AS MATERIALIZED (
  SELECT r.id,r.created_at,r.issued_at,r.state,r.result,r.manifest_id,r.owner_release_id,
    r.owner_release_generation,r.fallback_reason,r.expected_item_count,r.served_item_payload
  FROM recommendation_request r
  WHERE r.created_at >= '2026-10-01T02:58:00.000Z'::timestamptz AND r.created_at < '2026-10-01T03:06:14.516Z'::timestamptz
  ORDER BY r.created_at,r.id LIMIT 20001
), requests AS MATERIALIZED (
  SELECT r.*,p.execution_mode,p.reason_code,p.effective_manifest_id,
    COALESCE(r.owner_release_id=l.id AND r.owner_release_generation=l.pointer_generation
      AND r.manifest_id=l.manifest_id AND p.effective_manifest_id=l.manifest_id
      AND p.execution_mode='cowatch_mmr_personalized'
      AND r.created_at>=l.approved_at AND r.created_at<l.valid_until
      AND r.created_at<l.dependency_expires_at
      AND (l.revoked_at IS NULL OR r.created_at<l.revoked_at)
      AND l.exact_reviewed_binding,false) exact_owner_request,
    cr.generator_version,cr.composer_version,cr.evidence_complete,cr.trace_payload
  FROM roots r
  LEFT JOIN release l ON l.id=r.owner_release_id
  LEFT JOIN LATERAL (SELECT * FROM recommendation_personalization_decision p0 WHERE p0.request_id=r.id OFFSET 0) p ON true
  LEFT JOIN LATERAL (SELECT * FROM recommendation_candidate_run cr0 WHERE cr0.request_id=r.id OFFSET 0) cr ON true
  WHERE (SELECT count(*) FROM roots)<=20000
), evidence AS MATERIALIZED (
  SELECT r.*,
    EXISTS (
      SELECT 1 FROM release l
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.trace_payload->'stages','[]'::jsonb)) st
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st->'sourceEvidence','[]'::jsonb)) src
      WHERE st->>'stage'='composed' AND st->>'ordinal'='0'
        AND src->'evidence'->>'ownerReleaseId'=l.id::text
        AND src->'evidence'->>'ownerReleaseGeneration'=l.pointer_generation::text
        AND src->'evidence'->>'ownerBindingDigest'=l.binding_digest
        AND src->'evidence'->>'ownerManifestId'=l.manifest_id
        AND src->'evidence'->>'ownerManifestDigest'=l.manifest_digest
        AND src->'evidence'->>'ownerCompositionConfigDigest'=l.binding->>'compositionConfigDigest'
        AND src->'evidence'->>'ownerSourceMode'='current-source-owner-live-v1'
        AND src->'evidence'->>'graphGenerationId'=l.graph_generation_id
    ) exact_composition_trace
  FROM requests r
), cards AS MATERIALIZED (
  SELECT r.id request_id,i.id item_id,r.state,r.exact_owner_request,r.exact_composition_trace,
    i.candidate_generator,
    EXISTS (
      SELECT 1 FROM expected e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(
        COALESCE(r.served_item_payload->'items'->i.id->'candidateProvenance',i.candidate_provenance)->'sources',
        '[]'::jsonb)) src
      WHERE src->>'generator'='directional-cowatch'
        AND src->>'generatorVersion'='current-source-owner-live-v1'
        AND src->>'rejectionReason' IS NULL
        AND src->'evidence'->>'generation'=e.graph_id
    ) accepted_exact_cowatch_source,
    EXISTS(SELECT 1 FROM recommendation_rendered_fact f WHERE f.item_id=i.id) rendered
  FROM evidence r CROSS JOIN LATERAL (SELECT * FROM recommendation_served_item i0 WHERE i0.request_id=r.id OFFSET 0) i
), fallback_groups AS (
  SELECT state,result,fallback_reason,execution_mode,reason_code,effective_manifest_id,
    count(*) requests,count(*) FILTER(WHERE expected_item_count>0) requests_with_cards
  FROM evidence WHERE NOT exact_owner_request
  GROUP BY 1,2,3,4,5,6
), missing_input AS MATERIALIZED (
  SELECT DISTINCT r.id,src->'evidence' flags
  FROM evidence r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.trace_payload->'stages','[]'::jsonb)) st
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st->'sourceEvidence','[]'::jsonb)) src
  WHERE r.fallback_reason='composition_required_input_unavailable'
    AND st->>'stage'='rejected' AND st->>'sourceGenerator'='directional-cowatch'
    AND src->>'generator'='mmr-composition-inputs'
), grant_row AS MATERIALIZED (
  SELECT g.* FROM recommendation_cowatch_refresh_grant g CROSS JOIN expected e
  WHERE g.anchor_release_id=e.release_id
    OR g.id=(SELECT a.grant_id FROM recommendation_cowatch_refresh_attempt a WHERE a.id=e.release_id)
  ORDER BY g.approved_at DESC LIMIT 1
), attempts AS MATERIALIZED (
  SELECT a.* FROM recommendation_cowatch_refresh_attempt a
  JOIN grant_row g ON g.id=a.grant_id ORDER BY a.started_at DESC LIMIT 64
), scheduler AS MATERIALIZED (
  SELECT status,started_at,updated_at,details->>'nextRunAt' next_run_at,
    details->>'lastBatchStatus' last_batch_status,details->'lastBatch' last_batch
  FROM workflow_run WHERE workflow_key='recommendation-cowatch-refresh-scheduler'
  ORDER BY updated_at DESC LIMIT 1
)
SELECT jsonb_build_object(
  'observedAt',clock_timestamp(), 'readOnly',current_setting('transaction_read_only'),
  'proofStart',(SELECT proof_start FROM expected),'proofEnd',(SELECT proof_end FROM expected),
  'rootCount',(SELECT count(*) FROM roots),'requestBoundExceeded',(SELECT count(*)>20000 FROM roots),
  'release',(SELECT jsonb_build_object('id',id,'pointerGeneration',pointer_generation,
    'graphGenerationId',graph_generation_id,'manifestId',manifest_id,'manifestDigest',manifest_digest,
    'compositionConfigDigest',binding->>'compositionConfigDigest','bindingDigest',binding_digest,
    'exactReviewedBinding',exact_reviewed_binding,'approvedAt',approved_at,'validUntil',valid_until,
    'dependencyExpiresAt',dependency_expires_at,'revokedAt',revoked_at,'revocationReason',revocation_reason) FROM release),
  'pointer',(SELECT jsonb_build_object('generation',p.generation,'stage',p.stage,
    'activeReleaseId',p.active_owner_release_id,'activeManifestId',p.active_manifest_id,
    'killSwitchEnabled',p.kill_switch_enabled,'exposureCeilingBps',p.exposure_ceiling_bps,
    'isExpectedCurrentRelease',p.active_owner_release_id=e.release_id)
    FROM recommendation_promotion_pointer p CROSS JOIN expected e
    WHERE p.id='recommendation-promotion-pointer'),
  'graph',(SELECT jsonb_build_object('publishedAt',g.published_at,'invalidatedAt',g.invalidated_at,
    'invalidationReason',g.invalidation_reason,'expiresAt',g.expires_at,'sourceCount',g.source_count,
    'contributionCount',g.contribution_count,'edgeCount',g.edge_count,'rawSourceCount',g.raw_source_count,
    'windowStart',g.window_start,'windowEnd',g.window_end,'evaluationAsOf',g.evaluation_as_of)
    FROM recommendation_cowatch_generation g JOIN expected e ON g.id=e.graph_id),
  'requests',(SELECT jsonb_build_object('total',count(*),'issued',count(*) FILTER(WHERE state='issued'),
    'withCards',count(*) FILTER(WHERE expected_item_count>0),
    'exactOwnerExecution',count(*) FILTER(WHERE exact_owner_request),
    'exactOwnerIssuedWithTrace',count(*) FILTER(WHERE exact_owner_request AND state='issued' AND exact_composition_trace
      AND generator_version='semantic-profile-cowatch-generators-v1' AND evidence_complete),
    'exactOwnerMissingTrace',count(*) FILTER(WHERE exact_owner_request AND NOT exact_composition_trace),
    'firstRequestAt',min(created_at),'lastRequestAt',max(created_at)) FROM evidence),
  'cards',(SELECT jsonb_build_object('total',count(*),
    'exactCowatchContributedIssuedCards',count(*) FILTER(WHERE state='issued' AND exact_owner_request
      AND exact_composition_trace AND accepted_exact_cowatch_source),
    'requestsWithExactCowatchContribution',count(DISTINCT request_id) FILTER(WHERE state='issued'
      AND exact_owner_request AND exact_composition_trace AND accepted_exact_cowatch_source),
    'renderedExactCowatchCards',count(*) FILTER(WHERE state='issued' AND exact_owner_request
      AND exact_composition_trace AND accepted_exact_cowatch_source AND rendered)) FROM cards),
  'fallbackGroups',COALESCE((SELECT jsonb_agg(to_jsonb(fallback_groups)) FROM fallback_groups),'[]'::jsonb),
  'missingInputDiagnostics',(SELECT jsonb_build_object('requestsWithDiagnostics',count(DISTINCT id),
    'missingTheme',count(DISTINCT id) FILTER(WHERE flags->>'missingTheme'='true'),
    'missingSource',count(DISTINCT id) FILTER(WHERE flags->>'missingSource'='true'),
    'missingInterest',count(DISTINCT id) FILTER(WHERE flags->>'missingInterest'='true'),
    'missingHistory',count(DISTINCT id) FILTER(WHERE flags->>'missingHistory'='true')) FROM missing_input),
  'refreshGrant',(SELECT jsonb_build_object('id',g.id,'anchorReleaseId',g.anchor_release_id,
    'anchorPointerGeneration',g.anchor_pointer_generation,'approvedAt',g.approved_at,'validUntil',g.valid_until,
    'revokedAt',g.revoked_at,'revocationReason',g.revocation_reason,'policyVersion',g.policy_version,
    'manifestDigest',g.manifest_digest,'configurationDigest',g.configuration_digest,
    'exactRuntimeConfiguration',g.manifest_digest=e.manifest_digest AND g.configuration_digest=e.configuration_digest,
    'nextEligibleAttemptAt',greatest(g.approved_at,
      COALESCE((SELECT started_at+interval '12 hours' FROM recommendation_cowatch_refresh_attempt ORDER BY started_at DESC LIMIT 1),'1970-01-01'::timestamp),
      COALESCE((SELECT published_at+interval '12 hours' FROM recommendation_cowatch_generation ORDER BY published_at DESC LIMIT 1),'1970-01-01'::timestamp)))
    FROM grant_row g CROSS JOIN expected e),
  'refreshAttempts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'reason',a.reason,
    'startedAt',a.started_at,'publishedAt',a.published_at,'completedAt',a.completed_at,
    'graphGenerationId',a.expected_graph_generation_id,'pointerGeneration',a.pointer_generation,
    'windowStart',a.window_start,'windowEnd',a.window_end,'evaluationAsOf',a.evaluation_as_of,
    'releaseMatchesAttempt',EXISTS(SELECT 1 FROM recommendation_owner_release r WHERE r.id=a.id
      AND r.graph_generation_id=a.expected_graph_generation_id AND r.pointer_generation=a.pointer_generation),
    'exactDelegatedAudit',EXISTS(SELECT 1 FROM recommendation_promotion_event ev
      WHERE ev.dedupe_key='owner-release:'||a.id::text AND ev.reason_code='owner_delegated_graph_refresh'
        AND ev.actor_class='system' AND ev.details->>'refreshGrantId'=a.grant_id::text
        AND ev.details->>'ownerReleaseId'=a.id::text AND ev.details->>'graphGenerationId'=a.expected_graph_generation_id)
    ) ORDER BY a.started_at DESC) FROM attempts a),'[]'::jsonb),
  'scheduler',(SELECT to_jsonb(scheduler) FROM scheduler),
  'g6History',(SELECT jsonb_build_object('releaseId',r.id,'revokedAt',r.revoked_at,'revocationReason',r.revocation_reason,
    'graphInvalidatedAt',g.invalidated_at,'graphInvalidationReason',g.invalidation_reason)
    FROM recommendation_owner_release r LEFT JOIN recommendation_cowatch_generation g ON g.id=r.graph_generation_id
    WHERE r.id='d43d554f-362f-4cb5-b9d3-69e8fcd78dc9'::uuid)
) proof;
