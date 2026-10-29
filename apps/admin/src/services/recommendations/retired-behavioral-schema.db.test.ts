import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// An explicit, loopback database is required. This suite never adopts a shared
// schema or uses Prisma's current client, which intentionally loses 19 models.
const run = process.env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)
const retiredTables = [
  "recommendation_cowatch_refresh_attempt",
  "recommendation_cowatch_refresh_grant",
  "recommendation_profile_interest",
  "recommendation_profile_projection_contribution",
  "recommendation_profile_projection_pointer",
  "recommendation_profile_projection_run",
  "recommendation_consent_receipt",
  "recommendation_consent_transition",
  "recommendation_profile_session_link",
  "recommendation_viewing_mode_evidence",
  "recommendation_profile_projection_generation",
  "recommendation_profile_vector_snapshot",
  "recommendation_cowatch_edge",
  "recommendation_cowatch_contribution",
  "recommendation_cowatch_source_contribution",
  "recommendation_cowatch_suppression",
  "recommendation_cowatch_trial_authority",
  "recommendation_cowatch_generation",
  "recommendation_profile",
] as const

const retainedCowatchTriggers = [
  "cowatch_outcome_changed",
  "cowatch_outcome_removed",
  "cowatch_episode_changed",
  "cowatch_fact_changed",
  "cowatch_eligibility_changed",
  "cowatch_promotion_fence_changed",
] as const

function historicalSql(name: string): string {
  let sql = readFileSync(
    new URL(`${name}/migration.sql`, migrationRoot),
    "utf8",
  )
  if (name === "0127_recommendation_legacy_stage_bulk_retirement")
    sql = sql.replaceAll(
      "public.recommendation_candidate_",
      "recommendation_candidate_",
    )
  if (name === "0081_watch_search_transcript_publication_convergence")
    sql = sql.replaceAll('"public".', "")
  return sql
}

const historicalNames = readdirSync(migrationRoot)
  .filter(
    (name) =>
      /^\d{4}_/.test(name) &&
      Number(name.slice(0, 4)) < 165 &&
      name !== "0030_mastra_schema" &&
      name !== "0121_watch_exposure_narrow_index_reconciliation",
  )
  .sort()

function removalSql(): string {
  const path = process.env.RETIRED_SCHEMA_MIGRATION_SQL
  if (path) return readFileSync(path, "utf8")
  const local = new URL(
    "../../../prisma/migrations/0165_remove_retired_behavioral_schema/migration.sql",
    import.meta.url,
  )
  if (!existsSync(local))
    throw new Error(
      "Missing 0165_remove_retired_behavioral_schema/migration.sql",
    )
  return readFileSync(local, "utf8")
}

describe.skipIf(!run)(
  "feat-905 retired behavioral schema on PostgreSQL",
  () => {
    const schema = `retired_schema_${randomUUID().replaceAll("-", "")}`
    const databaseUrl = process.env.DATABASE_URL ?? ""
    let db: Client
    let owned = false
    let retainedTriggersBefore: string[] = []
    const digest = "a".repeat(64)
    const future = "2027-01-01T00:00:00Z"

    async function count(table: string): Promise<number> {
      const result = await db.query<{ n: number }>(
        `SELECT count(*)::integer AS n FROM "${table}"`,
      )
      return result.rows[0]!.n
    }

    async function assertIntact(extraLifecycle = false) {
      expect(await count("recommendation_request")).toBe(extraLifecycle ? 2 : 1)
      expect(await count("recommendation_playback_episode")).toBe(
        extraLifecycle ? 2 : 1,
      )
      expect(await count("recommendation_playback_fact")).toBe(1)
      expect(await count("recommendation_outcome_revision")).toBe(
        extraLifecycle ? 2 : 1,
      )
      expect(await count("recommendation_eligibility_decision")).toBe(1)
      expect(await count("recommendation_promotion_slate_fence")).toBe(1)
      expect(await count("recommendation_behavioral_retirement_batch")).toBe(1)
      expect(await count("recommendation_viewer")).toBe(1)
      expect(await count("recommendation_study")).toBe(1)
      expect(await count("recommendation_owner_release")).toBe(1)
      expect(await count("recommendation_precomputed_generation")).toBe(1)
      expect(await count("recommendation_precomputed_content_profile")).toBe(1)
      expect(await count("recommendation_precomputed_experiment")).toBe(1)
      expect(await count("recommendation_precomputed_visit")).toBe(1)
      const found = await db.query<{ name: string }>(
        `SELECT relname AS name FROM pg_class WHERE relnamespace = $1::regnamespace
       AND relkind = 'r' AND relname = ANY($2::text[]) ORDER BY relname`,
        [schema, retiredTables],
      )
      expect(found.rows.map((r) => r.name)).toEqual([...retiredTables].sort())
    }

    async function assertRefused(message: string, extraLifecycle = false) {
      try {
        await expect(db.query(removalSql())).rejects.toThrow(message)
      } finally {
        // A failed migration transaction must not commit partial DDL.
        await db.query("ROLLBACK")
      }
      await assertIntact(extraLifecycle)
    }

    beforeAll(async () => {
      const url = new URL(databaseUrl)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Explicit owned loopback forge_test database required")
      db = new Client({ connectionString: databaseUrl })
      await db.connect()
      await db.query(`CREATE SCHEMA "${schema}"`)
      owned = true
      await db.query(`SET search_path TO "${schema}", public`)
      for (const name of historicalNames) await db.query(historicalSql(name))
      await db.query(
        `INSERT INTO recommendation_strategy_manifest
        (id, strategy_version, contract_version, surface_version, generator, max_items)
       VALUES ('fixture-manifest', 'fixture-v1', 'semantic-recommendation-v1',
         'watch-below-player-v1', 'semantic', 3)`,
      )
      await db.query(
        `INSERT INTO recommendation_experiment
        (id, experiment_version, surface_version, control_manifest_id,
         challenger_manifest_id, assignment_policy_version,
         outcome_policy_version, integrity_policy_version,
         evaluation_policy_version, configuration_digest,
         challenger_probability, starts_at, ends_at, expires_at)
       VALUES ('retained-experiment', 'fixture-experiment-v1',
         'watch-below-player-v1', 'fixture-manifest', 'fixture-manifest',
         'fixture-assignment', 'fixture-outcome', 'fixture-integrity',
         'fixture-evaluation', $1, 0.5, now() - interval '1 day',
         now() + interval '1 day', $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_experiment_assignment
        (id, experiment_id, unit_kind, unit_digest, arm,
         assignment_probability, configuration_digest, expires_at)
       VALUES ('retained-assignment', 'retained-experiment',
         'anonymous_session', $1, 'control', 0.5, $2, $3)`,
        ["1".repeat(64), digest, future],
      )
      await db.query("BEGIN")
      await db.query(
        `INSERT INTO recommendation_request
        (id, contract_version, surface_version, manifest_id, strategy_version,
         classifier_version, session_digest, seed_media_id, locale,
         expected_item_count, state, result, expires_at)
       VALUES ('retained-request', 'semantic-recommendation-v1',
         'watch-below-player-v1', 'fixture-manifest', 'fixture-v1',
         'fixture-classifier', $1, 'seed-video', 'en', 0, 'prepared', 'empty', $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_served_item
        (id, request_id, position, target_media_id, canonical_href,
         candidate_generator, candidate_provenance, expires_at)
       VALUES ('retained-item', 'retained-request', 0, 'video-one',
         '/watch/video-one', 'semantic', '{}'::jsonb, $1)`,
        [future],
      )
      await db.query(
        `UPDATE recommendation_request SET expected_item_count = 1,
         result = 'served', state = 'issued',
         delivery_jti = $1, signing_kid = 'fixture-kid', issued_at = now()
       WHERE id = 'retained-request'`,
        [randomUUID()],
      )
      await db.query("COMMIT")
      await db.query(
        `INSERT INTO recommendation_personalization_decision
        (request_id, effective_manifest_id, lane, projection_scope,
         projection_version, projection_generation_number, interest_count,
         expires_at)
       VALUES ('retained-request', 'fixture-manifest', 'profile_challenger',
         'session', 'fixture-v1', 1, 1, $1)`,
        [future],
      )
      await db.query(
        `INSERT INTO recommendation_shadow_evaluation
        (id, manifest_id, generator_version, sampling_version,
         context_version, eligibility_version, retention_policy_version,
         window_start, window_end, requested_sample_size, expires_at)
       VALUES ('retained-evaluation', 'fixture-manifest', 'fixture-generator',
         'fixture-sampling', 'fixture-context', 'fixture-eligibility',
         'fixture-retention', now() - interval '1 day', now(), 1, $1)`,
        [future],
      )
      await db.query(
        `INSERT INTO recommendation_shadow_run
        (id, evaluation_id, request_id, sample_ordinal, sampling_digest,
         context_projection_version, eligibility_version,
         retention_policy_version, input_captured_at, expires_at)
       VALUES ('retained-shadow-run', 'retained-evaluation', 'retained-request',
         0, $1, 'fixture-context', 'fixture-eligibility',
         'fixture-retention', now(), $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_selection
        (id, request_id, item_id, capability_jti, event_id, payload_digest,
         claim_nonce_digest, handoff_expires_at, occurred_at, expires_at)
       VALUES ('retained-selection', 'retained-request', 'retained-item',
         'selection-jti', 'selection-event', $1, $2, $3, now(), $4)`,
        [digest, "b".repeat(64), future, future],
      )
      await db.query(
        `INSERT INTO recommendation_playback_episode
        (id, request_id, item_id, selection_id, media_id, session_digest,
         active_until, hard_until, expires_at)
       VALUES ('retained-episode', 'retained-request', 'retained-item',
         'retained-selection', 'video-one', $1, now() + interval '1 hour',
         now() + interval '2 hours', $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_playback_fact
        (id, request_id, item_id, episode_id, capability_jti, event_id,
         payload_digest, sequence, kind, occurred_at, expires_at)
       VALUES ('retained-fact', 'retained-request', 'retained-item',
         'retained-episode', 'fact-jti', 'fact-event', $1, 1,
         'heartbeat', now(), $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_outcome_revision
        (id, request_id, item_id, episode_id, classifier_version,
         fact_watermark, input_digest, revision, qualified_view,
         learning_eligible, generation, expires_at)
       VALUES ('retained-outcome', 'retained-request', 'retained-item',
         'retained-episode', 'fixture-classifier', 1, $1, 1,
         false, false, 1, $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_eligibility_decision
        (id, source_type, source_key, outcome_id, policy_version,
         revision, input_digest, actor_class, state, contribution_weight,
         contribution_ordinal, distinct_support, identity_concentration,
         expires_at)
       VALUES ('retained-eligibility', 'playback_outcome', 'retained-outcome',
         'retained-outcome', 'fixture-policy', 1, $2, 'human_anonymous',
         'excluded', 0, 1, 0, 0, $1)`,
        [future, digest],
      )
      await db.query(
        `INSERT INTO recommendation_promotion_slate_fence
        (id, request_id, pointer_generation, reason_code, expires_at)
       VALUES ('retained-fence', 'retained-request', 1, 'fixture', $1)`,
        [future],
      )
      await db.query(
        `INSERT INTO recommendation_behavioral_retirement_batch
        (batch_id, operation_id, sequence, phase, deleted_count,
         updated_count, source_commit)
       VALUES ($1, $2, 0, 'fixture', 1, 0, $3)`,
        [randomUUID(), randomUUID(), "b".repeat(40)],
      )
      await db.query(
        `INSERT INTO recommendation_viewer
          (token_digest, profile_digest, consent_receipt_digest, expires_at)
         VALUES ($1, $2, $3, $4)`,
        ["6".repeat(64), "7".repeat(64), "8".repeat(64), future],
      )
      await db.query(
        `INSERT INTO recommendation_study
          (experiment_id, protocol, protocol_digest, prepared_by_id, expires_at)
         VALUES ('retained-experiment', '{}'::jsonb, $1,
           'fixture-owner', $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_owner_release
          (id, pointer_generation, manifest_id, manifest_digest,
           graph_generation_id, binding_digest, binding, qualified_at,
           valid_until, dependency_expires_at, raw_population_expires_at,
           approved_by_id, approved_at, expires_at)
         VALUES ($1, 1,
           'hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1', $2,
           $3, $4,
           '{"policyVersion":"owner-approved-no-study-v1","mode":"current-source-owner-live-v1"}'::jsonb,
           now(), now() + interval '1 day', now() + interval '2 days',
           now() + interval '3 days', 'fixture-owner', now(),
           now() + interval '2555 days')`,
        [randomUUID(), digest, "9".repeat(64), "b".repeat(64)],
      )
      await db.query(
        `INSERT INTO video (id, core_id, slug, updated_at)
         VALUES ('fixture-video', 'fixture-core-video', 'fixture-video', now())`,
      )
      await db.query(
        `INSERT INTO recommendation_precomputed_generation
          (id, model_id, prompt_version, input_digest, source_set_digest,
           input_cutoff, expected_source_count)
         VALUES ('retained-precomputed-generation', 'fixture-model',
           'fixture-prompt', $1, $2, now(), 0)`,
        [digest, "c".repeat(64)],
      )
      await db.query(
        `INSERT INTO recommendation_precomputed_build_source
          (generation_id, source_video_id)
         VALUES ('retained-precomputed-generation', 'fixture-video')`,
      )
      await db.query(
        `INSERT INTO recommendation_precomputed_content_profile
          (generation_id, cache_key, video_id, model_id, backend,
           prompt_version, schema_version, metadata_digest, chunk_digest,
           selected_transcript_count, selected_chunk_count,
           source_text_bytes, part_digests, coverage_digest, kind,
           state, terminal_at)
         VALUES ('retained-precomputed-generation', $1, 'fixture-video',
           'fixture-model', 'codex_chatgpt_subscription',
           'fixture-prompt', 'fixture-schema', $2, $3, 0, 0, 0,
           '[]'::jsonb, $4, 'metadata_only', 'invalid', now())`,
        ["3".repeat(64), digest, "4".repeat(64), "5".repeat(64)],
      )
      await db.query(
        `INSERT INTO recommendation_precomputed_experiment
          (id, generation_id, control_manifest_id, challenger_manifest_id,
           control_manifest_digest, control_routing_digest,
           source_set_digest, assignment_policy_version,
           eligibility_policy_version, delivery_policy_version,
           configuration_digest, starts_at, ends_at, expires_at)
         VALUES ('retained-precomputed-experiment',
           'retained-precomputed-generation', 'fixture-manifest',
           'precomputed-watch-preview-v1', $1, $2, $3,
           'fixture-assignment', 'fixture-eligibility', 'fixture-delivery',
           $4, now() - interval '1 day', now() + interval '1 day',
           now() + interval '20 days')`,
        [digest, "1".repeat(64), "c".repeat(64), "2".repeat(64)],
      )
      await db.query(
        `INSERT INTO recommendation_precomputed_visit
          (id, experiment_id, source_video_id, locale, audio_language_slug,
           eligibility, qualification, exclusion_reason, expires_at)
         VALUES ($1, 'retained-precomputed-experiment', 'video-one',
           'en', 'english', 'excluded', 'unknown_signal', 'fixture',
           now() + interval '7 days')`,
        [randomUUID()],
      )
      retainedTriggersBefore = await retainedTriggerNames()
    }, 240_000)

    async function retainedTriggerNames(): Promise<string[]> {
      const found = await db.query<{ name: string }>(
        `SELECT c.relname || '.' || t.tgname AS name
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE c.relnamespace = $1::regnamespace AND c.relkind = 'r'
           AND c.relname <> ALL($2::text[]) AND NOT t.tgisinternal
         ORDER BY 1`,
        [schema, retiredTables],
      )
      return found.rows.map((r) => r.name)
    }

    afterAll(async () => {
      if (!db) return
      await db.query("ROLLBACK")
      if (owned) await db.query(`DROP SCHEMA "${schema}" CASCADE`)
      await db.end()
    })

    it("refuses a valid nonempty retired profile and rolls back", async () => {
      await db.query(
        `INSERT INTO recommendation_profile
        (id, token_digest, privacy_generation, choice, expires_at, updated_at)
       VALUES ('retired-profile', $1, 1, 'durable_allowed', $2, now())`,
        ["c".repeat(64), future],
      )
      await assertRefused("recommendation_profile is not empty")
      await db.query(
        "DELETE FROM recommendation_profile WHERE id = 'retired-profile'",
      )
    })

    it("refuses a valid nonempty retired graph and rolls back", async () => {
      await db.query(
        `INSERT INTO recommendation_cowatch_generation
        (id, projection_version, feature_version, source_count,
         contribution_count, edge_count, distinct_viewer_count, window_end,
         terminal_decision, decision_reason, expires_at)
       VALUES ($1, 'fixture-v1', 'fixture-v1', 0, 0, 0, 0,
         now(), 'not_promoted', 'fixture', $2)`,
        ["d".repeat(64), future],
      )
      await assertRefused("recommendation_cowatch_generation is not empty")
      await db.query(
        "DELETE FROM recommendation_cowatch_generation WHERE id = $1",
        ["d".repeat(64)],
      )
    })

    it("refuses independent consent and vector snapshot rows", async () => {
      await db.query(
        `INSERT INTO recommendation_consent_receipt
          (id, token_digest, contract_version, choice, expires_at, updated_at)
         VALUES ('retired-consent', $1, 'fixture-v1', 'essential_only', $2, now())`,
        ["6".repeat(64), future],
      )
      await assertRefused("recommendation_consent_receipt is not empty")
      await db.query(
        "DELETE FROM recommendation_consent_receipt WHERE id = 'retired-consent'",
      )

      await db.query(
        `INSERT INTO recommendation_consent_transition
          (id, audit_id, kind, expires_at)
         VALUES ('retired-transition', $1, 'grant', $2)`,
        [randomUUID(), future],
      )
      await assertRefused("recommendation_consent_transition is not empty")
      await db.query(
        "DELETE FROM recommendation_consent_transition WHERE id = 'retired-transition'",
      )

      const zeroVector = `[${Array(1536).fill(0).join(",")}]`
      await db.query(
        `INSERT INTO recommendation_profile_vector_snapshot (digest, embedding)
         VALUES ($1, $2::vector)`,
        ["7".repeat(64), zeroVector],
      )
      await assertRefused("recommendation_profile_vector_snapshot is not empty")
      await db.query(
        "DELETE FROM recommendation_profile_vector_snapshot WHERE digest = $1",
        ["7".repeat(64)],
      )
    })

    it("refuses valid projection, session and playback child rows", async () => {
      await db.query(
        `INSERT INTO recommendation_profile_projection_generation
          (id, manifest_id, scope, session_digest, generation, state,
           projection_version, clustering_version,
           eligibility_policy_version, outcome_classifier_version,
           input_window_start, input_window_end, input_digest,
           retention_days, expires_at)
         VALUES ('retired-projection', 'fixture-manifest', 'session', $1,
           1, 'building', 'fixture', 'fixture', 'fixture', 'fixture',
           now() - interval '1 day', now(), $2, 1, $3)`,
        ["8".repeat(64), digest, future],
      )
      await assertRefused(
        "recommendation_profile_projection_generation is not empty",
      )

      const zeroVector = `[${Array(1536).fill(0).join(",")}]`
      await db.query(
        `INSERT INTO recommendation_profile_interest
          (id, generation_id, kind, interest_ordinal, medoid_media_id,
           medoid_source_digest, embedding, weight, support_count,
           stability, expires_at)
         VALUES ('retired-interest', 'retired-projection', 'session', 0,
           'video-one', $1, $2::vector, 1, 1, 1, $3)`,
        [digest, zeroVector, future],
      )
      await assertRefused("recommendation_profile_interest is not empty")
      await db.query(
        "DELETE FROM recommendation_profile_interest WHERE id = 'retired-interest'",
      )

      await db.query(
        `INSERT INTO recommendation_profile_projection_contribution
          (id, generation_id, kind, source_id_digest, target_media_id,
           weight, occurred_at, expires_at)
         VALUES ('retired-contribution', 'retired-projection',
           'explicit_preference', $1, 'video-one', 0.5, now(), $2)`,
        ["a".repeat(64), future],
      )
      await assertRefused(
        "recommendation_profile_projection_contribution is not empty",
      )
      await db.query(
        "DELETE FROM recommendation_profile_projection_contribution WHERE id = 'retired-contribution'",
      )

      await db.query(
        `INSERT INTO recommendation_profile_projection_run
          (id, scope, session_digest, projection_id, expires_at)
         VALUES ('retired-projection-run', 'session', $1,
           'retired-projection', $2)`,
        ["8".repeat(64), future],
      )
      await assertRefused("recommendation_profile_projection_run is not empty")
      await db.query(
        "DELETE FROM recommendation_profile_projection_run WHERE id = 'retired-projection-run'",
      )

      await db.query(
        `UPDATE recommendation_profile_projection_generation
         SET state = 'published', published_at = now()
         WHERE id = 'retired-projection'`,
      )

      await db.query(
        `INSERT INTO recommendation_profile_projection_pointer
          (scope_digest, scope, session_digest, generation_id,
           pointer_generation)
         VALUES ($1, 'session', $2, 'retired-projection', 1)`,
        ["9".repeat(64), "8".repeat(64)],
      )
      await assertRefused(
        "recommendation_profile_projection_pointer is not empty",
      )
      await db.query(
        "DELETE FROM recommendation_profile_projection_pointer WHERE generation_id = 'retired-projection'",
      )
      await db.query(
        "DELETE FROM recommendation_profile_projection_generation WHERE id = 'retired-projection'",
      )

      await db.query(
        `INSERT INTO recommendation_profile
          (id, token_digest, privacy_generation, choice, expires_at, updated_at)
         VALUES ('child-profile', $1, 1, 'durable_allowed', $2, now())`,
        ["c".repeat(64), future],
      )
      await db.query(
        `INSERT INTO recommendation_profile_session_link
          (id, profile_id, privacy_generation, session_digest, expires_at)
         VALUES ('retired-session-link', 'child-profile', 1, $1, $2)`,
        [digest, future],
      )
      await assertRefused("recommendation_profile_session_link is not empty")
      await db.query(
        "DELETE FROM recommendation_profile_session_link WHERE id = 'retired-session-link'",
      )

      await db.query(
        `INSERT INTO recommendation_viewing_mode_evidence
          (episode_id, profile_id, privacy_generation, session_digest,
           media_id, policy_version, fact_watermark, sound_off_milliseconds,
           sound_on_milliseconds, sound_off_progress_seconds,
           sound_on_progress_seconds, sound_off_qualified,
           sound_on_qualified, preview_milliseconds, observed_at, expires_at)
         VALUES ('retained-episode', 'child-profile', 1, $1,
           'video-one', 'fixture', 1, 0, 1000, 0, 1,
           false, false, 0, now(), $2)`,
        [digest, future],
      )
      await assertRefused("recommendation_viewing_mode_evidence is not empty")
      await db.query(
        "DELETE FROM recommendation_viewing_mode_evidence WHERE episode_id = 'retained-episode'",
      )
      await db.query(
        "DELETE FROM recommendation_profile WHERE id = 'child-profile'",
      )

      await db.query(
        `INSERT INTO recommendation_cowatch_suppression (episode_id, expires_at)
         VALUES ('retained-episode', $1)`,
        [future],
      )
      await assertRefused("recommendation_cowatch_suppression is not empty")
      await db.query(
        "DELETE FROM recommendation_cowatch_suppression WHERE episode_id = 'retained-episode'",
      )
    })

    it("refuses valid refresh and frozen trial authority rows", async () => {
      const grantId = randomUUID()
      await db.query(
        `INSERT INTO recommendation_cowatch_refresh_grant
          (id, anchor_release_id, anchor_pointer_generation,
           influence_floor_generation, manifest_digest, configuration_digest,
           policy_version, budget, approved_by_id, approved_at, valid_until)
         VALUES ($1, $2, 1, 0, $3, $4,
           'cowatch-refresh-seven-day-mature-v1', '{}'::jsonb,
           'fixture-owner', now(), now() + interval '29 days')`,
        [grantId, randomUUID(), digest, "1".repeat(64)],
      )
      await assertRefused("recommendation_cowatch_refresh_grant is not empty")
      await db.query(
        `INSERT INTO recommendation_cowatch_refresh_attempt
          (id, grant_id, expected_pointer_generation, window_start,
           window_end, evaluation_as_of, started_at, lease_until, status)
         VALUES ($1, $2, 1, now() - interval '14 days',
           now() - interval '7 days', now() - interval '7 days' + interval '7 hours',
           now(), now() + interval '1 hour', 'running')`,
        [randomUUID(), grantId],
      )
      await assertRefused("recommendation_cowatch_refresh_attempt is not empty")
      await db.query(
        "DELETE FROM recommendation_cowatch_refresh_attempt WHERE grant_id = $1",
        [grantId],
      )
      await db.query(
        "DELETE FROM recommendation_cowatch_refresh_grant WHERE id = $1",
        [grantId],
      )

      await db.query(
        `INSERT INTO recommendation_cowatch_trial_authority
          (generation_id, raw_population_expires_at, binding_digest,
           binding, dependency_expires_at, trial_valid_until)
         VALUES ($1, now() + interval '30 days', $2, '{}'::jsonb,
           now() + interval '20 days', now() + interval '10 days')`,
        ["b".repeat(64), digest],
      )
      await assertRefused("recommendation_cowatch_trial_authority is not empty")
      await db.query(
        "DELETE FROM recommendation_cowatch_trial_authority WHERE generation_id = $1",
        ["b".repeat(64)],
      )
    })

    it("refuses nonempty co-watch source and aggregate edge rows", async () => {
      const graphId = "d".repeat(64)
      await db.query(
        `INSERT INTO recommendation_cowatch_generation
          (id, projection_version, feature_version, source_count,
           contribution_count, edge_count, distinct_viewer_count, window_end,
           terminal_decision, decision_reason, expires_at)
         VALUES ($1, 'fixture-v1', 'fixture-v1', 1, 0, 1, 1,
           now(), 'not_promoted', 'fixture', $2)`,
        [graphId, future],
      )
      await db.query(
        `INSERT INTO recommendation_cowatch_source_contribution
          (id, generation_id, outcome_id, eligibility_decision_id,
           eligibility_revision, eligibility_policy_version, media_id,
           session_digest, viewer_key_digest, quality_weight,
           occurred_at, expires_at)
         VALUES ('retired-cowatch-source', $1, 'retained-outcome',
           'retained-eligibility', 1, 'fixture-policy', 'video-one',
           $2, $3, 0.5, now(), $4)`,
        [graphId, digest, "e".repeat(64), future],
      )
      await assertRefused(
        "recommendation_cowatch_source_contribution is not empty",
      )
      await db.query(
        "DELETE FROM recommendation_cowatch_source_contribution WHERE id = 'retired-cowatch-source'",
      )
      await db.query(
        `INSERT INTO recommendation_cowatch_edge
          (id, generation_id, source_media_id, target_media_id,
           session_support, distinct_viewer_support, confidence,
           popularity_corrected_lift, recency_weight, quality_weight,
           effective_weight, contamination, eligible)
         VALUES ('retired-edge', $1, 'video-one', 'video-two',
           1, 1, 0.5, 1, 1, 1, 0.5, 0, true)`,
        [graphId],
      )
      await assertRefused("recommendation_cowatch_edge is not empty")
      await db.query(
        "DELETE FROM recommendation_cowatch_edge WHERE id = 'retired-edge'",
      )
      await db.query(
        "DELETE FROM recommendation_cowatch_generation WHERE id = $1",
        [graphId],
      )
    })

    it("refuses a valid directional co-watch pair backed by two outcomes", async () => {
      const graphId = "d".repeat(64)
      await db.query("BEGIN")
      await db.query(
        `INSERT INTO recommendation_request
          (id, contract_version, surface_version, manifest_id, strategy_version,
           classifier_version, session_digest, seed_media_id, locale,
           expected_item_count, state, result, expires_at)
         VALUES ('pair-request', 'semantic-recommendation-v1',
           'watch-below-player-v1', 'fixture-manifest', 'fixture-v1',
           'fixture-classifier', $1, 'seed-two', 'en', 0,
           'prepared', 'empty', $2)`,
        ["2".repeat(64), future],
      )
      await db.query(
        `INSERT INTO recommendation_served_item
          (id, request_id, position, target_media_id, canonical_href,
           candidate_generator, candidate_provenance, expires_at)
         VALUES ('pair-item', 'pair-request', 0, 'video-two',
           '/watch/video-two', 'semantic', '{}'::jsonb, $1)`,
        [future],
      )
      await db.query(
        `UPDATE recommendation_request SET expected_item_count = 1,
           result = 'served', state = 'issued', delivery_jti = $1,
           signing_kid = 'fixture-kid', issued_at = now()
         WHERE id = 'pair-request'`,
        [randomUUID()],
      )
      await db.query("COMMIT")
      await db.query(
        `INSERT INTO recommendation_selection
          (id, request_id, item_id, capability_jti, event_id, payload_digest,
           claim_nonce_digest, handoff_expires_at, occurred_at, expires_at)
         VALUES ('pair-selection', 'pair-request', 'pair-item',
           'pair-jti', 'pair-event', $1, $2, $3, now(), $4)`,
        [digest, "3".repeat(64), future, future],
      )
      await db.query(
        `INSERT INTO recommendation_playback_episode
          (id, request_id, item_id, selection_id, media_id, session_digest,
           active_until, hard_until, expires_at)
         VALUES ('pair-episode', 'pair-request', 'pair-item',
           'pair-selection', 'video-two', $1, now() + interval '1 hour',
           now() + interval '2 hours', $2)`,
        ["2".repeat(64), future],
      )
      await db.query(
        `INSERT INTO recommendation_outcome_revision
          (id, request_id, item_id, episode_id, classifier_version,
           fact_watermark, input_digest, revision, qualified_view,
           learning_eligible, generation, expires_at)
         VALUES ('pair-outcome', 'pair-request', 'pair-item',
           'pair-episode', 'fixture-classifier', 0, $1, 1,
           false, false, 1, $2)`,
        ["4".repeat(64), future],
      )
      await db.query(
        `INSERT INTO recommendation_cowatch_generation
          (id, projection_version, feature_version, source_count,
           contribution_count, edge_count, distinct_viewer_count, window_end,
           terminal_decision, decision_reason, expires_at)
         VALUES ($1, 'fixture-v1', 'fixture-v1', 0, 1, 0, 1,
           now(), 'not_promoted', 'fixture', $2)`,
        [graphId, future],
      )
      await db.query(
        `INSERT INTO recommendation_cowatch_contribution
          (id, generation_id, source_outcome_id, target_outcome_id,
           source_media_id, target_media_id, session_digest,
           viewer_key_digest, gap_ms, quality_weight, recency_weight,
           effective_weight, expires_at)
         VALUES ('retired-pair', $1, 'retained-outcome', 'pair-outcome',
           'video-one', 'video-two', $2, $3, 1000, 0.5, 1, 0.5, $4)`,
        [graphId, digest, "5".repeat(64), future],
      )
      await assertRefused(
        "recommendation_cowatch_contribution is not empty",
        true,
      )
      await db.query(
        "DELETE FROM recommendation_cowatch_contribution WHERE id = 'retired-pair'",
      )
      await db.query(
        "DELETE FROM recommendation_cowatch_generation WHERE id = $1",
        [graphId],
      )
      await db.query(
        "DELETE FROM recommendation_request WHERE id = 'pair-request'",
      )
    })

    it("refuses a valid attached profile assignment before touching retained history", async () => {
      await db.query(
        `INSERT INTO recommendation_profile
          (id, token_digest, privacy_generation, choice, expires_at, updated_at)
         VALUES ('attached-profile', $1, 1, 'durable_allowed', $2, now())`,
        ["f".repeat(64), future],
      )
      await db.query(
        `UPDATE recommendation_experiment_assignment
         SET unit_kind = 'anonymous_profile', profile_id = 'attached-profile',
             privacy_generation = 1 WHERE id = 'retained-assignment'`,
      )
      // The valid FK target is the first nonempty admission blocker.
      await assertRefused("recommendation_profile is not empty")
      const attached = await db.query<{ profile_id: string }>(
        `SELECT profile_id FROM recommendation_experiment_assignment
         WHERE id = 'retained-assignment'`,
      )
      expect(attached.rows[0]?.profile_id).toBe("attached-profile")
      await db.query(
        `UPDATE recommendation_experiment_assignment
         SET unit_kind = 'anonymous_session', profile_id = NULL,
             privacy_generation = NULL WHERE id = 'retained-assignment'`,
      )
      await db.query(
        "DELETE FROM recommendation_profile WHERE id = 'attached-profile'",
      )
    })

    it("rejects a held retained-table lock without partial DDL", async () => {
      const blocker = new Client({ connectionString: databaseUrl })
      await blocker.connect()
      try {
        await blocker.query(`SET search_path TO "${schema}", public`)
        await blocker.query("BEGIN")
        await blocker.query(
          "LOCK TABLE recommendation_outcome_revision IN ACCESS SHARE MODE",
        )
        await assertRefused("lock timeout")
      } finally {
        await blocker.query("ROLLBACK")
        await blocker.end()
      }
    }, 20_000)

    it("honors a stricter existing transaction timer during lock wait", async () => {
      const blocker = new Client({ connectionString: databaseUrl })
      const migration = new Client({ connectionString: databaseUrl })
      // PostgreSQL closes the backend when transaction_timeout fires; pg also
      // emits an asynchronous connection error after rejecting the query.
      migration.on("error", () => undefined)
      await blocker.connect()
      await migration.connect()
      try {
        await blocker.query(`SET search_path TO "${schema}", public`)
        await migration.query(`SET search_path TO "${schema}", public`)
        await migration.query("SET transaction_timeout = '250ms'")
        await blocker.query("BEGIN")
        await blocker.query(
          "LOCK TABLE recommendation_outcome_revision IN ACCESS SHARE MODE",
        )
        await expect(migration.query(removalSql())).rejects.toThrow(
          "transaction timeout",
        )
        await assertIntact()
      } finally {
        await blocker.query("ROLLBACK")
        await blocker.end()
        await migration.end().catch(() => undefined)
      }
    }, 20_000)

    it("refuses an unlinked historical workflow ledger", async () => {
      await db.query(
        `INSERT INTO workflow_run
        (id, runtime_run_id, workflow_key, trigger, status, updated_at)
       VALUES ('retired-workflow-ledger', 'missing-runtime',
         'recommendation-profile-projection', 'manual', 'succeeded', now())`,
      )
      await assertRefused("workflow runtime unavailable")
      await db.query(
        "DELETE FROM workflow_run WHERE id = 'retired-workflow-ledger'",
      )
    })

    it("sees workflow work committed while waiting for the ledger write fence", async () => {
      const writer = new Client({ connectionString: databaseUrl })
      const migration = new Client({ connectionString: databaseUrl })
      await writer.connect()
      await migration.connect()
      try {
        await writer.query(`SET search_path TO "${schema}", public`)
        await migration.query(`SET search_path TO "${schema}", public`)
        await writer.query("BEGIN")
        await writer.query(
          `INSERT INTO workflow_run
            (id, workflow_key, trigger, status, updated_at)
           VALUES ('concurrent-workflow', 'recommendation-profile-projection',
             'manual', 'running', now())`,
        )
        const admission = migration.query(removalSql())
        await new Promise((resolve) => setTimeout(resolve, 100))
        await writer.query("COMMIT")
        await expect(admission).rejects.toThrow("workflow runtime unavailable")
        await migration.query("ROLLBACK")
        await assertIntact()
        await db.query(
          "DELETE FROM workflow_run WHERE id = 'concurrent-workflow'",
        )
      } finally {
        await writer.query("ROLLBACK")
        await writer.end()
        await migration.end()
      }
    }, 20_000)

    it("refuses pending runtime work and mismatched durable linkage", async () => {
      const present = await db.query<{ present: boolean }>(
        "SELECT to_regnamespace('workflow') IS NOT NULL AS present",
      )
      if (present.rows[0]?.present)
        throw new Error("Refusing to adopt a preexisting workflow schema")
      const runtimeName =
        "workflow//./src/workflows/recommendationProfileProjection//runRecommendationProfileProjection"
      await db.query("CREATE SCHEMA workflow")
      try {
        await db.query(
          `CREATE TYPE workflow.status AS ENUM
          ('pending', 'running', 'completed', 'failed', 'cancelled')`,
        )
        await db.query(
          `CREATE TABLE workflow.workflow_runs
          (id text PRIMARY KEY, name text NOT NULL,
           status workflow.status NOT NULL, completed_at timestamptz)`,
        )
        await db.query(
          `INSERT INTO workflow.workflow_runs (id, name, status)
         VALUES ('retired-runtime', $1, 'pending')`,
          [runtimeName],
        )
        await assertRefused("behavioral workflow is nonterminal or unlinked")
        await db.query(
          `UPDATE workflow.workflow_runs
         SET status = 'completed', completed_at = now()
         WHERE id = 'retired-runtime'`,
        )
        await db.query(
          `INSERT INTO workflow_run
          (id, runtime_run_id, workflow_key, trigger, status, updated_at)
         VALUES ('retired-workflow-ledger', 'retired-runtime',
           'recommendation-cowatch-refresh-scheduler', 'manual',
           'succeeded', now())`,
        )
        await assertRefused("behavioral workflow is nonterminal or unlinked")
        await db.query(
          "DELETE FROM workflow_run WHERE id = 'retired-workflow-ledger'",
        )
      } finally {
        await db.query("DROP TABLE IF EXISTS workflow.workflow_runs")
        await db.query("DROP TYPE IF EXISTS workflow.status")
        await db.query("DROP SCHEMA workflow RESTRICT")
      }
    })

    it("refuses an unexpected missing trigger without partial DDL", async () => {
      const trigger = await db.query<{ ddl: string }>(
        `SELECT pg_get_triggerdef(oid) AS ddl FROM pg_trigger
       WHERE tgrelid = 'recommendation_outcome_revision'::regclass
         AND tgname = 'cowatch_outcome_changed'`,
      )
      expect(trigger.rows).toHaveLength(1)
      await db.query(
        "DROP TRIGGER cowatch_outcome_changed ON recommendation_outcome_revision",
      )
      try {
        await assertRefused(
          'trigger "cowatch_outcome_changed" for table "recommendation_outcome_revision" does not exist',
        )
      } finally {
        await db.query(trigger.rows[0]!.ddl)
      }
    })

    it("drops exactly the retired relation set and preserves retained catalog contracts", async () => {
      await db.query(removalSql())
      const missing = await db.query<{ name: string }>(
        `SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(format('%I.%I', $2::text, name)) IS NULL ORDER BY name`,
        [retiredTables, schema],
      )
      expect(missing.rows.map((r) => r.name)).toEqual([...retiredTables].sort())
      expect(await count("recommendation_request")).toBe(1)
      expect(await count("recommendation_behavioral_retirement_batch")).toBe(1)
      expect(await count("recommendation_viewer")).toBe(1)
      expect(await count("recommendation_study")).toBe(1)
      expect(await count("recommendation_owner_release")).toBe(1)
      expect(await count("recommendation_precomputed_generation")).toBe(1)
      expect(await count("recommendation_precomputed_content_profile")).toBe(1)
      expect(await count("recommendation_precomputed_experiment")).toBe(1)
      expect(await count("recommendation_precomputed_visit")).toBe(1)
      const fk = await db.query<{ name: string }>(
        `SELECT conname AS name FROM pg_constraint
       WHERE connamespace = $1::regnamespace AND contype = 'f'
         AND conname = ANY($2::text[])`,
        [
          schema,
          [
            "recommendation_personalization_projection_fkey",
            "recommendation_experiment_assignment_profile_fkey",
            "recommendation_shadow_run_profile_fkey",
          ],
        ],
      )
      expect(fk.rows).toEqual([])
      const triggers = await db.query<{ name: string }>(
        `SELECT tgname AS name FROM pg_trigger
       WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = $1::regnamespace)
         AND NOT tgisinternal AND tgname = ANY($2::text[])`,
        [schema, retainedCowatchTriggers],
      )
      expect(triggers.rows).toEqual([])
      expect(await retainedTriggerNames()).toEqual(
        retainedTriggersBefore.filter(
          (name) =>
            !retainedCowatchTriggers.some((trigger) =>
              name.endsWith(`.${trigger}`),
            ),
        ),
      )
      const guard = await db.query<{ name: string }>(
        `SELECT tgname AS name FROM pg_trigger WHERE tgrelid = 'recommendation_composition_observation'::regclass
       AND NOT tgisinternal AND tgname = 'composition_observation_guard'`,
      )
      expect(guard.rows.map((r) => r.name)).toEqual([
        "composition_observation_guard",
      ])
      const ledger = await db.query<{ name: string }>(
        `SELECT conname AS name FROM pg_constraint WHERE conrelid = 'recommendation_behavioral_retirement_batch'::regclass
       ORDER BY conname`,
      )
      expect(ledger.rows.map((r) => r.name)).toContain(
        "recommendation_behavioral_retirement_operation_sequence_key",
      )
      const ledgerIndex = await db.query<{ name: string }>(
        `SELECT indexrelid::regclass::text AS name FROM pg_index
         WHERE indrelid = 'recommendation_behavioral_retirement_batch'::regclass`,
      )
      expect(ledgerIndex.rows.map((r) => r.name)).toContain(
        "recommendation_behavioral_retirement_operation_idx",
      )
      const functions = await db.query<{ name: string; ddl: string }>(
        `SELECT proname AS name, pg_get_functiondef(oid) AS ddl
         FROM pg_proc WHERE pronamespace = $1::regnamespace AND prokind = 'f'`,
        [schema],
      )
      const dangling = functions.rows.flatMap((fn) =>
        retiredTables
          .filter((table) => new RegExp(`\\b${table}\\b`).test(fn.ddl))
          .map((table) => `${fn.name}: ${table}`),
      )
      expect(dangling).toEqual([])
    })

    it("keeps detached provenance but rejects new references to retired roots", async () => {
      await expect(
        db.query(
          `UPDATE recommendation_personalization_decision
           SET projection_generation_id = 'retired-generation'
           WHERE request_id = 'retained-request'`,
        ),
      ).rejects.toThrow(
        "recommendation_personalization_retired_projection_check",
      )
      await expect(
        db.query(
          `UPDATE recommendation_experiment_assignment
           SET unit_kind = 'anonymous_profile', profile_id = 'retired-profile',
               privacy_generation = 1 WHERE id = 'retained-assignment'`,
        ),
      ).rejects.toThrow(
        "recommendation_experiment_assignment_retired_profile_check",
      )
      await expect(
        db.query(
          `UPDATE recommendation_shadow_run
           SET projection_profile_id = 'retired-profile', privacy_generation = 1
           WHERE id = 'retained-shadow-run'`,
        ),
      ).rejects.toThrow("recommendation_shadow_run_retired_profile_check")
      const history = await db.query<{
        projection_generation_id: string | null
        projection_scope: string
      }>(
        `SELECT projection_generation_id, projection_scope
         FROM recommendation_personalization_decision
         WHERE request_id = 'retained-request'`,
      )
      expect(history.rows[0]).toMatchObject({
        projection_generation_id: null,
        projection_scope: "session",
      })
    })

    it("allows unbound composition observations and deliberately rejects graph-bound ones", async () => {
      const unbound = randomUUID()
      await db.query(
        `INSERT INTO recommendation_composition_protocol
          (id, shadow_evaluation_id, source_manifest_id, generator_version,
           challenger_manifest_id, composer_version, protocol_version,
           config, config_digest, actor_id, expires_at)
         VALUES ($1, 'retained-evaluation', 'fixture-manifest',
           'fixture-generator', 'fixture-manifest', 'fixture-composer',
           'fixture-protocol', '{}'::jsonb, $2, 'fixture-actor', $3)`,
        [unbound, digest, future],
      )
      await db.query(
        `UPDATE recommendation_shadow_run SET state = 'published',
           claimed_at = now() WHERE id = 'retained-shadow-run'`,
      )
      await db.query(
        `INSERT INTO recommendation_composition_observation
          (run_id, protocol_id, input_digest, output_digest, metrics, expires_at)
         VALUES ('retained-shadow-run', $1, $2, $3, '{}'::jsonb,
           now() + interval '1 hour')`,
        [unbound, digest, "2".repeat(64)],
      )
      expect(await count("recommendation_composition_observation")).toBe(1)
      await expect(
        db.query(
          `UPDATE recommendation_composition_observation
           SET metrics = '{"changed":true}'::jsonb
           WHERE run_id = 'retained-shadow-run'`,
        ),
      ).rejects.toThrow("composition observation is immutable")

      await db.query(
        `INSERT INTO recommendation_shadow_evaluation
          (id, manifest_id, generator_version, sampling_version,
           context_version, eligibility_version, retention_policy_version,
           window_start, window_end, requested_sample_size, expires_at)
         VALUES ('graph-evaluation', 'hybrid-profile-viewing-mode-cowatch-mmr-v1',
           'directional-cowatch-shadow-v1', 'fixture-sampling',
           'fixture-context', 'fixture-eligibility', 'fixture-retention',
           now() - interval '1 day', now(), 1, $1)`,
        [future],
      )
      await db.query(
        `INSERT INTO recommendation_shadow_run
          (id, evaluation_id, request_id, sample_ordinal, sampling_digest,
           context_projection_version, eligibility_version,
           retention_policy_version, input_captured_at, state, expires_at)
         VALUES ('graph-run', 'graph-evaluation', 'retained-request', 0, $1,
           'fixture-context', 'fixture-eligibility', 'fixture-retention',
           now(), 'published', $2)`,
        ["3".repeat(64), future],
      )
      const bound = randomUUID()
      await db.query(
        `INSERT INTO recommendation_composition_protocol
          (id, shadow_evaluation_id, source_manifest_id, generator_version,
           challenger_manifest_id, composer_version, protocol_version,
           config, config_digest, actor_id, expires_at)
         VALUES ($1, 'graph-evaluation',
           'hybrid-profile-viewing-mode-cowatch-mmr-v1',
           'directional-cowatch-shadow-v1',
           'hybrid-profile-viewing-mode-cowatch-mmr-v1',
           'fixture-composer', 'fixture-protocol',
           jsonb_build_object('cowatchGenerationId', $2::text,
             'cowatchDependencyExpiresAt', $3::text),
           $4, 'fixture-actor', $3::timestamp)`,
        [bound, "4".repeat(64), future, digest],
      )
      await db.query(
        `UPDATE recommendation_shadow_run SET claimed_at = now()
         WHERE id = 'graph-run'`,
      )
      await expect(
        db.query(
          `INSERT INTO recommendation_composition_observation
            (run_id, protocol_id, input_digest, output_digest, metrics, expires_at)
           VALUES ('graph-run', $1, $2, $3, '{}'::jsonb,
             now() + interval '1 hour')`,
          [bound, digest, "5".repeat(64)],
        ),
      ).rejects.toThrow("composition behavioral binding is retired")
    })

    it("runs changed retained playback, outcome, eligibility and promotion paths", async () => {
      await db.query(
        `UPDATE recommendation_playback_episode SET next_fact_sequence = 3
       WHERE id = 'retained-episode'`,
      )
      await db.query(
        `INSERT INTO recommendation_playback_fact
        (id, request_id, item_id, episode_id, capability_jti, event_id,
         payload_digest, sequence, kind, occurred_at, expires_at)
       VALUES ('post-drop-fact', 'retained-request', 'retained-item',
         'retained-episode', 'post-drop-jti', 'post-drop-event', $1, 2,
         'heartbeat', now(), $2)`,
        [digest, future],
      )
      await db.query(
        `INSERT INTO recommendation_outcome_revision
        (id, request_id, item_id, episode_id, classifier_version,
         fact_watermark, input_digest, revision, supersedes_id,
         qualified_view, learning_eligible, generation, expires_at)
       VALUES ('post-drop-outcome', 'retained-request', 'retained-item',
         'retained-episode', 'fixture-classifier', 2, $1, 2,
         'retained-outcome', false, false, 1, $2)`,
        ["e".repeat(64), future],
      )
      await db.query(
        `UPDATE recommendation_eligibility_decision SET is_current = false
       WHERE id = 'retained-eligibility'`,
      )
      await db.query(
        `INSERT INTO recommendation_eligibility_decision
        (id, source_type, source_key, outcome_id, policy_version,
         revision, input_digest, actor_class, state, contribution_weight,
         contribution_ordinal, distinct_support, identity_concentration,
         expires_at)
       VALUES ('post-drop-eligibility', 'playback_outcome', 'retained-outcome',
         'post-drop-outcome', 'fixture-policy', 2, $1, 'human_anonymous',
         'excluded', 0, 1, 0, 0, $2)`,
        ["e".repeat(64), future],
      )
      await db.query(
        `UPDATE recommendation_promotion_slate_fence
       SET reason_code = 'post_drop' WHERE id = 'retained-fence'`,
      )
      expect(await count("recommendation_outcome_revision")).toBe(2)
      expect(await count("recommendation_eligibility_decision")).toBe(2)
      await db.query(
        "DELETE FROM recommendation_eligibility_decision WHERE id = 'post-drop-eligibility'",
      )
      await db.query(
        "DELETE FROM recommendation_outcome_revision WHERE id = 'post-drop-outcome'",
      )
      await db.query(
        "DELETE FROM recommendation_playback_fact WHERE id = 'post-drop-fact'",
      )
      expect(await count("recommendation_outcome_revision")).toBe(1)
    })

    it("keeps study accounting and immutable owner, precomputed and batch history", async () => {
      await db.query(
        `INSERT INTO recommendation_experiment_assignment
          (id, experiment_id, unit_kind, unit_digest, arm,
           assignment_probability, configuration_digest, expires_at)
         VALUES ('post-drop-assignment', 'retained-experiment',
           'anonymous_session', $1, 'control', 0.5, $2, $3)`,
        ["d".repeat(64), digest, future],
      )
      await db.query(
        `UPDATE recommendation_request
         SET experiment_assignment_id = 'post-drop-assignment'
         WHERE id = 'retained-request'`,
      )
      const study = await db.query<{
        enrolled_count: number
        privacy_revision: number
      }>(
        `SELECT enrolled_count, privacy_revision FROM recommendation_study
         WHERE experiment_id = 'retained-experiment'`,
      )
      expect(study.rows[0]?.enrolled_count).toBe(1)
      expect(study.rows[0]?.privacy_revision).toBeGreaterThanOrEqual(1)
      await expect(
        db.query(
          `UPDATE recommendation_owner_release SET manifest_digest = $1`,
          ["e".repeat(64)],
        ),
      ).rejects.toThrow("owner release is immutable")
      await expect(
        db.query(
          `UPDATE recommendation_precomputed_experiment
           SET configuration_digest = $1
           WHERE id = 'retained-precomputed-experiment'`,
          ["e".repeat(64)],
        ),
      ).rejects.toThrow("Precomputed experiment configuration is immutable")
      const receipt = await db.query<{
        operation_id: string
        sequence: number
      }>(
        `SELECT operation_id, sequence
         FROM recommendation_behavioral_retirement_batch LIMIT 1`,
      )
      await expect(
        db.query(
          `INSERT INTO recommendation_behavioral_retirement_batch
            (batch_id, operation_id, sequence, phase, deleted_count,
             updated_count, source_commit)
           VALUES ($1, $2, $3, 'duplicate', 0, 0, $4)`,
          [
            randomUUID(),
            receipt.rows[0]!.operation_id,
            receipt.rows[0]!.sequence,
            "b".repeat(40),
          ],
        ),
      ).rejects.toThrow(
        "recommendation_behavioral_retirement_operation_sequence_key",
      )
    })
  },
)
