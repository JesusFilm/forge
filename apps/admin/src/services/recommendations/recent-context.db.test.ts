import { readdirSync, readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { getRecommendationRecentContext } from "./recent-context.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)
const migrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return ordinal >= 52 && ordinal <= 75 && name.includes("recommendation")
  })
  .sort()
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"),
  )

describe.skipIf(!RUN_REAL_DB_TEST)(
  "recommendation recent context against Postgres",
  () => {
    const schema = `recommendation_recent_context_${Date.now()}`
    const now = new Date("2026-08-26T12:00:00.000Z")
    const currentSession = "a".repeat(64)
    const linkedSession = "b".repeat(64)
    const tokenDigest = "d".repeat(64)
    let admin: Client
    let adminConnected = false
    let prisma: PrismaClient

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      adminConnected = true
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of migrations) await admin.query(migration)
      await admin.query(`
        INSERT INTO recommendation_strategy_manifest (
          id, strategy_version, contract_version, surface_version, generator,
          max_items
        ) VALUES (
          'recent-context-manifest', 'recent-context-strategy-v1',
          'semantic-recommendation-v1', 'watch-below-player-v1', 'semantic', 6
        );
        INSERT INTO recommendation_profile (
          id, token_digest, privacy_generation, choice, state, expires_at,
          updated_at
        ) VALUES (
          'recent-context-profile', '${tokenDigest}', 2, 'durable_allowed',
          'active', '2027-02-01T00:00:00.000Z', '${now.toISOString()}'
        );
        INSERT INTO recommendation_profile_session_link (
          id, profile_id, privacy_generation, session_digest, linked_at,
          expires_at
        ) VALUES
          (
            'recent-context-current-link', 'recent-context-profile', 2,
            '${currentSession}', '2026-08-26T09:30:00.000Z',
            '2026-08-27T00:00:00.000Z'
          ),
          (
            'recent-context-linked-link', 'recent-context-profile', 2,
            '${linkedSession}', '2026-08-25T00:00:00.000Z',
            '2026-08-27T00:00:00.000Z'
          );
      `)
      await insertIssuedItem({
        requestId: "pre-consent-selected-request",
        sessionDigest: currentSession,
        targetMediaId: "pre-consent-selected-video",
        createdAt: "2026-08-26T09:00:00.000Z",
        selected: true,
      })
      await insertIssuedItem({
        requestId: "current-selected-request",
        sessionDigest: currentSession,
        targetMediaId: "current-selected-video",
        createdAt: "2026-08-26T10:00:00.000Z",
        selected: true,
      })
      await insertIssuedItem({
        requestId: "current-once-request",
        sessionDigest: currentSession,
        targetMediaId: "current-served-once-video",
        createdAt: "2026-08-26T09:00:00.000Z",
        selected: false,
      })
      await insertIssuedItem({
        requestId: "linked-repeat-request-1",
        sessionDigest: linkedSession,
        targetMediaId: "linked-repeated-video",
        createdAt: "2026-08-25T10:00:00.000Z",
        selected: false,
      })
      await insertIssuedItem({
        requestId: "linked-repeat-request-2",
        sessionDigest: linkedSession,
        targetMediaId: "linked-repeated-video",
        createdAt: "2026-08-25T11:00:00.000Z",
        selected: false,
      })
      const fixtureUrl = new URL(env.DATABASE_URL)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (adminConnected) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    async function insertIssuedItem(input: {
      requestId: string
      sessionDigest: string
      targetMediaId: string
      createdAt: string
      selected: boolean
    }): Promise<void> {
      const expiry = "2026-09-24T12:00:00.000Z"
      await admin.query("BEGIN")
      try {
        await admin.query(
          `INSERT INTO recommendation_request (
            id, contract_version, surface_version, manifest_id,
            strategy_version, classifier_version, session_digest,
            seed_media_id, locale, expected_item_count, state, result,
            delivery_jti, signing_kid, created_at, issued_at, expires_at
          ) VALUES (
            $1, 'semantic-recommendation-v1', 'watch-below-player-v1',
            'recent-context-manifest', 'recent-context-strategy-v1',
            'legacy-position-v0', $2, 'seed-video', 'en', 1, 'issued',
            'served', $3, 'test-kid', $4, $4, $5
          )`,
          [
            input.requestId,
            input.sessionDigest,
            `${input.requestId}-delivery`,
            input.createdAt,
            expiry,
          ],
        )
        await admin.query(
          `INSERT INTO recommendation_served_item (
            id, request_id, position, target_media_id, canonical_href,
            candidate_generator, candidate_provenance, capability_jti,
            signing_kid, created_at, expires_at
          ) VALUES (
            $1, $2, 0, $3, $4, 'semantic', '{}'::jsonb, $5, 'test-kid',
            $6, $7
          )`,
          [
            `${input.requestId}-item`,
            input.requestId,
            input.targetMediaId,
            `/watch/${input.targetMediaId}.html`,
            `${input.requestId}-item-capability`,
            input.createdAt,
            expiry,
          ],
        )
        if (input.selected) {
          await admin.query(
            `INSERT INTO recommendation_impression (
              id, request_id, item_id, capability_jti, event_id,
              payload_digest, visibility_policy, occurred_at, received_at,
              expires_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, 'visibility-qualified', $7, $7, $8
            )`,
            [
              `${input.requestId}-impression`,
              input.requestId,
              `${input.requestId}-item`,
              `${input.requestId}-impression-capability`,
              `${input.requestId}-impression-event`,
              "f".repeat(64),
              input.createdAt,
              expiry,
            ],
          )
          await admin.query(
            `INSERT INTO recommendation_selection (
              id, request_id, item_id, capability_jti, event_id,
              payload_digest, claim_nonce_digest, handoff_expires_at,
              attribution_eligible_at, occurred_at, expires_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10
            )`,
            [
              `${input.requestId}-selection`,
              input.requestId,
              `${input.requestId}-item`,
              `${input.requestId}-selection-capability`,
              `${input.requestId}-selection-event`,
              "e".repeat(64),
              Buffer.from(input.requestId)
                .toString("hex")
                .padEnd(64, "0")
                .slice(0, 64),
              "2026-08-26T12:05:00.000Z",
              input.createdAt,
              expiry,
            ],
          )
        }
        await admin.query("COMMIT")
      } catch (error) {
        await admin.query("ROLLBACK")
        throw error
      }
    }

    it("uses only post-authorization current-session facts and explicitly authorized linked sessions", async () => {
      await expect(
        getRecommendationRecentContext(prisma, {
          sessionDigest: currentSession,
          profileTokenDigest: tokenDigest,
          allowDurableProfileLinks: false,
          now,
        }),
      ).resolves.toEqual({
        videos: [
          {
            targetMediaId: "current-selected-video",
            reasonCodes: ["recent_selection"],
          },
        ],
      })

      await expect(
        getRecommendationRecentContext(prisma, {
          sessionDigest: currentSession,
          profileTokenDigest: tokenDigest,
          allowDurableProfileLinks: true,
          now,
        }),
      ).resolves.toEqual({
        videos: [
          {
            targetMediaId: "current-selected-video",
            reasonCodes: ["recent_selection"],
          },
          {
            targetMediaId: "linked-repeated-video",
            reasonCodes: ["repeatedly_served"],
          },
        ],
      })
    })

    it("bounds high-history work to the newest request roots before lifecycle joins", async () => {
      for (let index = 0; index < 40; index += 1) {
        const minute = String(index).padStart(2, "0")
        await insertIssuedItem({
          requestId: `bounded-history-request-${index}`,
          sessionDigest: currentSession,
          targetMediaId: `bounded-history-video-${index}`,
          createdAt: `2026-08-26T11:${minute}:00.000Z`,
          selected: true,
        })
      }

      const result = await getRecommendationRecentContext(prisma, {
        sessionDigest: currentSession,
        profileTokenDigest: null,
        allowDurableProfileLinks: false,
        now,
      })

      expect(result.videos).toHaveLength(24)
      expect(
        result.videos.some(
          (video) => video.targetMediaId === "bounded-history-video-39",
        ),
      ).toBe(true)
      expect(
        result.videos.some(
          (video) => video.targetMediaId === "bounded-history-video-0",
        ),
      ).toBe(false)
    })
  },
)
