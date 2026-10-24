import type { Client } from "pg"

// Synthetic identifiers only. All writes use the caller-owned disposable schema.
export async function seedReconciliationScaleFixture(
  client: Client,
): Promise<void> {
  const pointerCount = 167_000
  const contributedPointers = 42_000
  const seeds = [
    `INSERT INTO recommendation_profile (
      id, token_digest, privacy_generation, choice, expires_at, updated_at
    ) SELECT
      'p-'||n, md5(n::text)||md5(n::text), 1, 'durable_allowed', '2026-12-01', now()
    FROM generate_series(1,${pointerCount})n`,
    `INSERT INTO recommendation_profile_projection_generation (
      id, manifest_id, scope, profile_id, privacy_generation, generation, state,
      projection_version, clustering_version, eligibility_policy_version,
      outcome_classifier_version, input_window_start, input_window_end, input_digest,
      contribution_count, retention_days, published_at, created_at, expires_at
    ) SELECT
      'g-'||n, 'multi-interest-profile-shadow-v1', 'durable', 'p-'||n, 1, 1, 'published',
      'multi-interest-profile-projection-v1', 'deterministic-farthest-first-medoids-v1',
      'recommendation-integrity-v1', 'active-watch-proxy-v1', '2026-09-01', '2026-09-20',
      repeat('a',64), CASE WHEN n<=${contributedPointers} THEN 3 ELSE 0 END, 180, '2026-09-20',
      '2026-09-20', '2026-12-01'
    FROM generate_series(1,${pointerCount})n`,
    `INSERT INTO recommendation_profile_projection_pointer (
      scope_digest, scope, profile_id, privacy_generation, generation_id, pointer_generation,
      updated_at
    ) SELECT
      md5(n::text)||md5(n::text), 'durable', 'p-'||n, 1, 'g-'||n, 1, '2026-09-20'
    FROM generate_series(1,${pointerCount})n`,
    `INSERT INTO recommendation_playback_episode (
      id, media_id, session_digest, state, active_until, hard_until, next_fact_sequence,
      generation, capability_jti, signing_kid, claimed_at, finalized_at, created_at,
      expires_at
    ) SELECT
      'e-'||n, 'media-'||n, md5(n::text)||md5(n::text), 'finalized', '2026-09-20 01:00Z',
      '2026-09-20 02:00Z', 1, 1, 'jti-'||n, 'test', '2026-09-20', '2026-09-20', '2026-09-20',
      '2026-10-01'
    FROM generate_series(1,${contributedPointers * 3})n`,
    `INSERT INTO recommendation_outcome_revision (
      id, episode_id, classifier_version, fact_watermark, input_digest, revision,
      qualified_view, view_quality_weight, view_quality_weight_reason, reasons,
      learning_eligible, generation, active_playback_milliseconds, duration_seconds,
      duration_cohort, active_coverage, created_at, expires_at
    ) SELECT
      'o-'||n, 'e-'||n, 'active-watch-proxy-v1', 0, repeat('b',64), 1, true, 0.8,
      'active_fraction_of_duration', ARRAY['qualified_view'], false, 1, 60000, 120, 'medium',
      'complete', '2026-09-20', '2026-10-01'
    FROM generate_series(1,${contributedPointers * 3})n`,
    `INSERT INTO recommendation_eligibility_decision (
      id, source_type, source_key, outcome_id, policy_version, revision, actor_class, state,
      eligible_scopes, contribution_weight, contribution_ordinal, distinct_support,
      identity_concentration, input_digest, evidence_watermark, expires_at
    ) SELECT
      'd-'||n, 'playback_outcome', 'outcome:'||n, 'o-'||n, 'recommendation-integrity-v1', 1,
      'human_anonymous', 'eligible', ARRAY['profile'], 0.8, 1, 1, 1, repeat('c',64),
      '2026-09-20', '2026-10-01'
    FROM generate_series(1,${contributedPointers * 3})n`,
    `INSERT INTO recommendation_profile_projection_contribution (
      id, generation_id, kind, source_id_digest, source_outcome_id, target_media_id,
      interest_ordinal, weight, eligibility_policy_version, outcome_classifier_version,
      privacy_generation, occurred_at, expires_at, source_eligibility_decision_id,
      source_eligibility_revision
    ) SELECT
      'c-'||n, 'g-'||((n-1)/3+1), 'qualified_outcome', md5(n::text)||md5(n::text), 'o-'||n,
      'media-'||n, 0, 0.8, 'recommendation-integrity-v1', 'active-watch-proxy-v1', 1,
      '2026-09-20', '2026-10-01', 'd-'||n, 1
    FROM generate_series(1,${contributedPointers * 3})n`,
    `INSERT INTO recommendation_profile_interest (
      id, generation_id, kind, interest_ordinal, medoid_media_id, medoid_source_digest,
      embedding, weight, support_count, stability, expires_at
    ) SELECT
      'i-'||n, 'g-'||n, 'durable', 0, 'media-'||(n*3), repeat('d',64),
      ('['||'1,'||repeat('0,',1534)||'0]')::vector, 0.8, 3, 1, '2026-10-01'
    FROM generate_series(1,${contributedPointers})n`,
    `INSERT INTO recommendation_profile_session_link (
      id, profile_id, privacy_generation, session_digest, linked_at, expires_at
    ) SELECT
      'l-'||n, 'p-'||n, 1, md5(n::text)||md5(n::text), '2026-09-20', '2026-10-01'
    FROM generate_series(1,${Math.min(pointerCount, 28000)})n`,
    `ANALYZE`,
  ]
  for (const sql of seeds) await client.query(sql)
}
