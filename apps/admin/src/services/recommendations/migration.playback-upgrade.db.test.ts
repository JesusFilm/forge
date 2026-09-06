import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const priorMigrationNames = [
  "0052_production_semantic_recommendation_tracer",
  "0053_recommendation_active_playback_proxy",
  "0054_recommendation_mission_value_actions",
  "0055_recommendation_integrity_eligibility",
  "0056_consent_aware_recommendation_profile",
  "0057_semantic_control_readiness",
  "0058_recommendation_candidate_platform",
  "0059_recommendation_shadow_candidate_evaluation",
  "0060_recommendation_experiment_spine",
  "0061_recommendation_hybrid_promotion",
  "0062_recommendation_multi_interest_profile_shadow",
  "0063_recommendation_live_profile_pilot",
  "0064_recommendation_governance_review_guards",
  "0065_recommendation_strategy_manifest_immutability",
  "0066_recommendation_playback_finalization_repair",
  "0067_recommendation_episode_submission_budget_repair",
  "0068_recommendation_trace_actor_digest_repair",
  "0069_recommendation_hybrid_composition",
  "0070_recommendation_consent_receipts",
  "0071_recommendation_assignment_generation_key",
]
const readMigration = (name: string) =>
  readFileSync(
    new URL(
      `../../../prisma/migrations/${name}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  )

describe.skipIf(!RUN_REAL_DB_TEST)("playback episode populated upgrade", () => {
  const schemaName = `recommendation_playback_upgrade_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`
  const expiresAt = "2026-09-17T00:00:00.000Z"
  let client: Client

  async function insertLineage(prefix: string) {
    await client.query("BEGIN")
    await client.query(
      `INSERT INTO recommendation_request (
        id, contract_version, surface_version, manifest_id, strategy_version,
        classifier_version, session_digest, seed_media_id, locale,
        expected_item_count, result, expires_at
      ) VALUES ($1, 'semantic-recommendation-v1', 'watch-below-player-v1',
        'semantic-transcript-pgvector-v1', 'semantic-transcript-pgvector-v1',
        'legacy-position-v0', $2, 'seed-video', 'en', 1, 'served', $3)`,
      [`${prefix}-request`, "a".repeat(64), expiresAt],
    )
    await client.query(
      `INSERT INTO recommendation_served_item (
        id, request_id, position, target_media_id, canonical_href,
        candidate_generator, candidate_provenance, expires_at
      ) VALUES ($1, $2, 0, 'media-1', '/watch/media-1.html/en.html',
        'semantic', '{}'::jsonb, $3)`,
      [`${prefix}-item`, `${prefix}-request`, expiresAt],
    )
    await client.query(
      `INSERT INTO recommendation_selection (
        id, request_id, item_id, capability_jti, event_id, payload_digest,
        claim_nonce_digest, handoff_expires_at, occurred_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7,
        '2026-08-19T03:10:00.000Z', '2026-08-19T03:00:00.000Z', $8)`,
      [
        `${prefix}-selection`,
        `${prefix}-request`,
        `${prefix}-item`,
        `${prefix}-selection-jti`,
        `${prefix}-event`,
        "b".repeat(64),
        (prefix === "existing" ? "c" : "d").repeat(64),
        expiresAt,
      ],
    )
    await client.query("COMMIT")
  }

  beforeAll(async () => {
    client = new Client({ connectionString: env.DATABASE_URL })
    await client.connect()
    await client.query(`CREATE SCHEMA "${schemaName}"`)
    await client.query(`SET search_path TO "${schemaName}", public`)
    for (const name of priorMigrationNames) {
      await client.query(readMigration(name))
    }
    await insertLineage("existing")
    await client.query(
      `INSERT INTO recommendation_playback_episode (
        id, request_id, item_id, selection_id, media_id, session_digest,
        state, capability_jti, signing_kid, active_until, hard_until,
        generation, claimed_at, expires_at
      ) VALUES ('existing-episode', 'existing-request', 'existing-item',
        'existing-selection', 'media-1', $1, 'claimed', 'existing-capability',
        'kid-1', '2026-08-19T07:00:00.000Z',
        '2026-08-19T09:00:00.000Z', 1,
        '2026-08-19T03:00:00.000Z', $2)`,
      ["a".repeat(64), expiresAt],
    )
    await client.query(
      `INSERT INTO recommendation_capability_submission_budget (
        capability_jti, request_id, attempts, expires_at
      ) VALUES
        ('existing-capability', 'existing-request', 2, $1),
        ('delivery-capability', 'existing-request', 1, $1)`,
      [expiresAt],
    )
    await client.query(
      readMigration("0072_recommendation_source_neutral_playback_episodes"),
    )
  })

  afterAll(async () => {
    if (!client) return
    await client.query("ROLLBACK").catch(() => {})
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await client.end()
  })

  it("migrates populated lineage and permits the previous pending writer shape", async () => {
    const migrated = await client.query(
      `SELECT discovery_source, claim_nonce_digest, handoff_expires_at
       FROM recommendation_playback_episode WHERE id = 'existing-episode'`,
    )
    expect(migrated.rows[0]).toMatchObject({
      discovery_source: "recommendation",
      claim_nonce_digest: expect.any(String),
      handoff_expires_at: expect.any(Date),
    })
    const budget = await client.query(
      `SELECT request_id, episode_id, attempts
       FROM recommendation_capability_submission_budget
       WHERE capability_jti = 'existing-capability'`,
    )
    expect(budget.rows).toEqual([
      { request_id: null, episode_id: "existing-episode", attempts: 2 },
    ])
    const unmatchedBudget = await client.query(
      `SELECT request_id, episode_id, attempts
       FROM recommendation_capability_submission_budget
       WHERE capability_jti = 'delivery-capability'`,
    )
    expect(unmatchedBudget.rows).toEqual([
      { request_id: "existing-request", episode_id: null, attempts: 1 },
    ])

    await insertLineage("rolling")
    await expect(
      client.query(
        `INSERT INTO recommendation_playback_episode (
          id, request_id, item_id, selection_id, media_id, session_digest,
          state, active_until, hard_until, generation, expires_at
        ) VALUES ('rolling-episode', 'rolling-request', 'rolling-item',
          'rolling-selection', 'media-1', $1, 'pending',
          '2026-08-19T07:00:00.000Z', '2026-08-19T09:00:00.000Z', 1, $2)`,
        ["a".repeat(64), expiresAt],
      ),
    ).resolves.toBeDefined()
    const rolling = await client.query(
      `SELECT discovery_source, claim_nonce_digest, handoff_expires_at
       FROM recommendation_playback_episode WHERE id = 'rolling-episode'`,
    )
    expect(rolling.rows).toEqual([
      {
        discovery_source: "recommendation",
        claim_nonce_digest: null,
        handoff_expires_at: null,
      },
    ])
    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = $1
         AND indexname IN (
           'recommendation_episode_created_idx',
           'recommendation_episode_finalized_idx',
           'recommendation_outcome_classifier_created_idx'
         )
       ORDER BY indexname`,
      [schemaName],
    )
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "recommendation_episode_created_idx",
      "recommendation_episode_finalized_idx",
      "recommendation_outcome_classifier_created_idx",
    ])
  })
})
