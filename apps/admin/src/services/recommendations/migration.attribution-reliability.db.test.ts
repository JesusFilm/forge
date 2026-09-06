import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)
const priorMigrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return ordinal >= 52 && ordinal <= 72 && name.includes("recommendation")
  })
  .sort()
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"),
  )
const migration = readFileSync(
  new URL(
    "../../../prisma/migrations/0075_recommendation_selection_attribution_eligibility/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

describe.skipIf(!RUN_REAL_DB_TEST)(
  "recommendation attribution reliability migration",
  () => {
    const schemaName = `recommendation_attribution_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    const receivedAt = new Date("2026-09-04T09:00:00.000Z")
    const impressionAt = new Date("2026-09-04T09:00:01.000Z")
    const expiresAt = new Date("2026-09-10T00:00:00.000Z")
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
        ) VALUES (
          'migration-request', 'semantic-recommendation-v1',
          'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
          'semantic-transcript-pgvector-v1', 'legacy-position-v0', $1,
          'migration-seed', 'en', 2, 'served', $2
        )`,
        ["a".repeat(64), expiresAt],
      )
      for (const position of [0, 1]) {
        await client.query(
          `INSERT INTO recommendation_served_item (
            id, request_id, position, target_media_id, canonical_href,
            candidate_generator, candidate_provenance, expires_at
          ) VALUES ($1, 'migration-request', $2, $3, $4,
            'semantic', '{}'::jsonb, $5)`,
          [
            `migration-item-${position}`,
            position,
            `migration-target-${position}`,
            `/watch/migration-target-${position}.html`,
            expiresAt,
          ],
        )
        await client.query(
          `INSERT INTO recommendation_selection (
            id, request_id, item_id, capability_jti, event_id,
            payload_digest, claim_nonce_digest, handoff_expires_at,
            occurred_at, received_at, expires_at
          ) VALUES ($1, 'migration-request', $2, $3, $4, $5, $6, $7,
            $8, $8, $7)`,
          [
            `migration-selection-${position}`,
            `migration-item-${position}`,
            `migration-selection-jti-${position}`,
            `migration-selection-event-${position}`,
            position === 0 ? "b".repeat(64) : "c".repeat(64),
            position === 0 ? "d".repeat(64) : "e".repeat(64),
            expiresAt,
            receivedAt,
          ],
        )
        await client.query(
          `INSERT INTO recommendation_playback_episode (
            id, request_id, item_id, selection_id, media_id, session_digest,
            state, active_until, hard_until, replay_count, expires_at
          ) VALUES ($1, 'migration-request', $2, $3, $4, $5, 'pending',
            '2026-09-04T11:00:00.000Z',
            '2026-09-04T12:00:00.000Z', $6, $7)`,
          [
            `migration-episode-${position}`,
            `migration-item-${position}`,
            `migration-selection-${position}`,
            `migration-target-${position}`,
            "a".repeat(64),
            position === 0 ? 5 : 0,
            expiresAt,
          ],
        )
      }
      await client.query(
        `INSERT INTO recommendation_impression (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, visibility_policy, occurred_at, received_at,
          expires_at
        ) VALUES (
          'migration-impression', 'migration-request', 'migration-item-0',
          'migration-impression-jti', 'migration-impression-event', $1,
          'watch-below-player-v1', $2, $2, $3
        )`,
        ["f".repeat(64), impressionAt, expiresAt],
      )
      await client.query("COMMIT")
    })

    afterAll(async () => {
      if (!client) return
      await client.query("ROLLBACK").catch(() => undefined)
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    it("backfills only observed impressions and preserves replay meaning", async () => {
      await client.query(migration)

      const selections = await client.query<{
        id: string
        attributionEligibleAt: Date | null
      }>(
        `SELECT id, attribution_eligible_at AS "attributionEligibleAt"
         FROM recommendation_selection ORDER BY id`,
      )
      expect(selections.rows).toEqual([
        {
          id: "migration-selection-0",
          attributionEligibleAt: impressionAt,
        },
        { id: "migration-selection-1", attributionEligibleAt: null },
      ])
      const episodes = await client.query<{
        id: string
        replayCount: number
        transportReplayCount: number
      }>(
        `SELECT id, replay_count AS "replayCount",
                transport_replay_count AS "transportReplayCount"
         FROM recommendation_playback_episode ORDER BY id`,
      )
      expect(episodes.rows).toEqual([
        {
          id: "migration-episode-0",
          replayCount: 0,
          transportReplayCount: 5,
        },
        {
          id: "migration-episode-1",
          replayCount: 0,
          transportReplayCount: 0,
        },
      ])
      await expect(
        client.query(
          `UPDATE recommendation_selection
           SET attribution_eligible_at = $1
           WHERE id = 'migration-selection-1'`,
          [receivedAt],
        ),
      ).rejects.toThrow("requires an eligible impression")
    })
  },
)
