import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)
const priorMigrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return ordinal >= 52 && ordinal <= 75 && name.includes("recommendation")
  })
  .sort()
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"),
  )
const migration = readFileSync(
  new URL(
    "../../../prisma/migrations/0076_recommendation_profile_eligibility_reconciliation/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

describe("recommendation profile reconciliation migration contract", () => {
  it("adds source revisions, exact replay receipts, and bounded run leases", () => {
    expect(migration).toContain(
      "recommendation_playback_transport_replay_receipt",
    )
    expect(migration).toContain("input_digest")
    expect(migration).toContain("evidence_watermark")
    expect(migration).toContain("attempt_count")
    expect(migration).toContain("lease_expires_at")
    expect(migration).toContain("expected_pointer_generation")
    expect(migration).toContain(
      "recommendation_profile_contribution_eligibility_idx",
    )
  })
})

describe.skipIf(!RUN_REAL_DB_TEST)(
  "recommendation profile reconciliation migration against PostgreSQL",
  () => {
    const schemaName = `recommendation_reconcile_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    const expiresAt = new Date("2026-10-01T00:00:00.000Z")
    let client: Client

    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      for (const sql of priorMigrations) await client.query(sql)

      await client.query("BEGIN")
      await client.query(
        `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, result, expires_at
        ) VALUES ('reconcile-request', 'semantic-recommendation-v1',
          'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
          'semantic-transcript-pgvector-v1', 'legacy-position-v0', $1,
          'reconcile-seed', 'en', 1, 'served', $2)`,
        ["a".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, expires_at
        ) VALUES ('reconcile-item', 'reconcile-request', 0,
          'reconcile-target', '/watch/reconcile-target.html',
          'semantic', '{}'::jsonb, $1)`,
        [expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_impression (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, visibility_policy, occurred_at, expires_at
        ) VALUES ('reconcile-impression', 'reconcile-request',
          'reconcile-item', 'reconcile-impression-jti',
          'reconcile-impression-event', $1, 'watch-below-player-v1',
          now(), $2)`,
        ["b".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, claim_nonce_digest, handoff_expires_at,
          attribution_eligible_at, occurred_at, expires_at
        ) VALUES ('reconcile-selection', 'reconcile-request',
          'reconcile-item', 'reconcile-selection-jti',
          'reconcile-selection-event', $1, $2, $3, now(), now(), $3)`,
        ["c".repeat(64), "d".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, request_id, item_id, selection_id, media_id, session_digest,
          state, capability_jti, signing_kid, claimed_at, active_until,
          hard_until, expires_at
        ) VALUES ('reconcile-episode', 'reconcile-request', 'reconcile-item',
          'reconcile-selection', 'reconcile-target', $1, 'claimed',
          'reconcile-episode-jti', 'reconcile-kid', now(),
          now() + interval '1 hour',
          now() + interval '2 hours', $2)`,
        ["a".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_fact (
          id, request_id, item_id, episode_id, capability_jti,
          event_id, payload_digest, sequence, kind, occurred_at, expires_at
        ) VALUES ('reconcile-fact', 'reconcile-request', 'reconcile-item',
          'reconcile-episode', 'reconcile-episode-jti',
          'reconcile-fact-event', $1, 1, 'progress', now(), $2)`,
        ["e".repeat(64), expiresAt],
      )
      await client.query("COMMIT")
      await client.query(migration)
    })

    afterAll(async () => {
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    it("accepts one-source selection revisions and rejects mixed lineage", async () => {
      await expect(
        client.query(
          `INSERT INTO recommendation_eligibility_decision (
            id, source_type, source_key, selection_id, policy_version,
            revision, actor_class, state, contribution_weight,
            contribution_ordinal, distinct_support, identity_concentration,
            input_digest, evidence_watermark, expires_at
          ) VALUES ('selection-decision', 'selection', 'selection:reconcile-selection',
            'reconcile-selection', 'recommendation-integrity-v1', 1,
            'human_anonymous', 'eligible', 1, 1, 1, 1, $1, now(), $2)`,
          ["f".repeat(64), expiresAt],
        ),
      ).resolves.toBeDefined()

      await expect(
        client.query(
          `INSERT INTO recommendation_eligibility_decision (
            id, source_type, source_key, selection_id, content_action_id,
            policy_version, revision, actor_class, state,
            contribution_weight, contribution_ordinal, distinct_support,
            identity_concentration, input_digest, expires_at
          ) VALUES ('mixed-decision', 'selection', 'selection:mixed',
            'reconcile-selection', 'missing', 'recommendation-integrity-v1',
            1, 'human_anonymous', 'eligible', 1, 1, 1, 1, $1, $2)`,
          ["f".repeat(64), expiresAt],
        ),
      ).rejects.toThrow()
    })

    it("accepts only attributable exact replay receipts", async () => {
      await expect(
        client.query(
          `INSERT INTO recommendation_playback_transport_replay_receipt (
            id, episode_id, capability_jti, event_id, payload_digest,
            replay_ordinal, observed_at, expires_at
          ) VALUES ('reconcile-replay', 'reconcile-episode',
            'reconcile-episode-jti', 'reconcile-fact-event', $1, 1, now(), $2)`,
          ["e".repeat(64), expiresAt],
        ),
      ).resolves.toBeDefined()

      await expect(
        client.query(
          `INSERT INTO recommendation_playback_transport_replay_receipt (
            id, episode_id, capability_jti, event_id, payload_digest,
            replay_ordinal, observed_at, expires_at
          ) VALUES ('reconcile-replay-mismatch', 'reconcile-episode',
            'reconcile-episode-jti', 'reconcile-fact-event', $1, 2, now(), $2)`,
          ["0".repeat(64), expiresAt],
        ),
      ).rejects.toThrow("requires an accepted playback fact")
    })

    it("bounds projection attempts and pointer fences", async () => {
      await expect(
        client.query(
          `INSERT INTO recommendation_profile_projection_run (
            id, scope, session_digest, state, generation, attempt_count,
            expected_pointer_generation, expected_generation_id, expires_at
          ) VALUES ('absent-pointer-run', 'session', $1, 'pending', 1, 0,
            0, NULL, $2)`,
          ["a".repeat(64), expiresAt],
        ),
      ).resolves.toBeDefined()

      await expect(
        client.query(
          `INSERT INTO recommendation_profile_projection_run (
            id, scope, session_digest, state, generation, attempt_count,
            expected_pointer_generation, expected_generation_id, expires_at
          ) VALUES ('invalid-run', 'session', $1, 'pending', 1, 4,
            1, 'generation-id', $2)`,
          ["a".repeat(64), expiresAt],
        ),
      ).rejects.toThrow()
    })
  },
)
