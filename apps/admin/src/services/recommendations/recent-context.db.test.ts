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
    return (
      (ordinal >= 52 && ordinal <= 76 && name.includes("recommendation")) ||
      name === "0082_user_recommendation_identity" ||
      name === "0096_recommendation_recent_episode_index"
    )
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
    const observedQueries: Array<{ query: string; params: string }> = []

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
      const client = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
        log: [{ emit: "event", level: "query" }],
      })
      client.$on("query", (query) => observedQueries.push(query))
      prisma = client
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

    async function insertStandalonePlayback(input: {
      id: string
      sessionDigest: string
      mediaId?: string
      requestId?: string
      discoverySource?: string
      createdAt?: string
      expiresAt?: string
      kind?: string
      late?: boolean
      conflictCount?: number
      occurredAt?: string
      receivedAt?: string
    }) {
      const createdAt = input.createdAt ?? "2026-08-26T11:00:00.000Z"
      const expiresAt = input.expiresAt ?? "2026-09-24T12:00:00.000Z"
      await admin.query(
        `INSERT INTO recommendation_playback_episode (
          id, media_id, session_digest, state, discovery_source,
          created_at, claimed_at, active_until, hard_until, expires_at, conflict_count,
          request_id, item_id, selection_id
        ) VALUES ($1, $6, $2, 'claimed', $7, $3::timestamptz, $3::timestamptz, LEAST($3::timestamptz + interval '5 minutes', $4::timestamptz - interval '1 second'), LEAST($3::timestamptz + interval '6 hours', $4::timestamptz), $4::timestamptz, $5, $8, $9, $10)`,
        [
          input.id,
          input.sessionDigest,
          createdAt,
          expiresAt,
          input.conflictCount ?? 0,
          input.mediaId ?? input.id,
          input.discoverySource ?? "direct",
          input.requestId ?? null,
          input.requestId ? `${input.requestId}-item` : null,
          input.requestId ? `${input.requestId}-selection` : null,
        ],
      )
      await admin.query(
        `INSERT INTO recommendation_playback_fact (
          id, episode_id, event_id, capability_jti, payload_digest, sequence, kind,
          occurred_at, received_at, expires_at, late, request_id, item_id
        ) VALUES ($1::text, $1::text, $1::text, $1::text, $2, 1, $3, $4, $9, $5, $6, $7, $8)`,
        [
          input.id,
          "e".repeat(64),
          input.kind ?? "playback_start",
          input.occurredAt ?? createdAt,
          expiresAt,
          input.late ?? false,
          input.requestId ?? null,
          input.requestId ? `${input.requestId}-item` : null,
          input.receivedAt ?? createdAt,
        ],
      )
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

    it("includes direct playback only within the current authorized profile scope", async () => {
      for (const input of [
        { id: "direct-current", sessionDigest: currentSession },
        { id: "direct-linked", sessionDigest: linkedSession },
        {
          id: "search-current",
          sessionDigest: currentSession,
          discoverySource: "search",
        },
        {
          id: "recommendation-current",
          mediaId: "current-selected-video",
          sessionDigest: currentSession,
          requestId: "current-selected-request",
          discoverySource: "recommendation",
        },
        { id: "direct-foreign", sessionDigest: "c".repeat(64) },
        {
          id: "direct-before-link",
          sessionDigest: currentSession,
          createdAt: "2026-08-26T09:00:00.000Z",
        },
        {
          id: "direct-expired",
          sessionDigest: currentSession,
          expiresAt: "2026-08-26T11:30:00.000Z",
        },
        {
          id: "attempt-only",
          sessionDigest: currentSession,
          kind: "playback_attempt",
        },
        { id: "direct-late", sessionDigest: currentSession, late: true },
        {
          id: "direct-conflicted",
          sessionDigest: currentSession,
          conflictCount: 1,
        },
        {
          id: "direct-future",
          sessionDigest: currentSession,
          receivedAt: "2026-08-26T13:00:00.000Z",
        },
      ])
        await insertStandalonePlayback(input)

      const read = (
        allowDurableProfileLinks: boolean,
        profileTokenDigest: string | null = tokenDigest,
      ) =>
        getRecommendationRecentContext(prisma, {
          sessionDigest: currentSession,
          profileTokenDigest,
          allowDurableProfileLinks,
          now,
        })
      const started = (result: Awaited<ReturnType<typeof read>>) =>
        result.videos
          .filter((video) =>
            video.reasonCodes.includes("recent_playback_start"),
          )
          .map((video) => video.targetMediaId)
          .sort()

      expect(started(await read(false))).toEqual([
        "current-selected-video",
        "direct-current",
        "search-current",
      ])
      expect(started(await read(true))).toEqual([
        "current-selected-video",
        "direct-current",
        "direct-linked",
        "search-current",
      ])
      expect(started(await read(false, null))).toEqual([
        "current-selected-video",
        "direct-before-link",
        "direct-current",
        "search-current",
      ])
      expect((await read(true, "f".repeat(64))).videos).toEqual([])

      await admin.query(
        `UPDATE recommendation_profile_session_link SET expires_at = '2026-08-26T11:30:00Z' WHERE id = 'recent-context-linked-link'`,
      )
      expect(started(await read(true))).not.toContain("direct-linked")

      await admin.query(
        `UPDATE recommendation_profile SET privacy_generation = 3 WHERE id = 'recent-context-profile'`,
      )
      expect((await read(true)).videos).toEqual([])
    })

    it("bounds standalone playback history before joining facts", async () => {
      const sessionDigest = "9".repeat(64)
      for (let index = 0; index < 40; index += 1) {
        await insertStandalonePlayback({
          id: `direct-bounded-${index}`,
          sessionDigest,
          createdAt: `2026-08-26T11:${String(index).padStart(2, "0")}:00.000Z`,
          // Old starts must not leak through a newer window of attempts.
          kind: index < 8 ? "playback_start" : "playback_attempt",
        })
      }
      expect(
        await getRecommendationRecentContext(prisma, {
          sessionDigest,
          profileTokenDigest: null,
          allowDurableProfileLinks: false,
          now,
        }),
      ).toEqual({ videos: [] })
    })

    it("retains accepted starts buffered before issuance or with an ahead client clock", async () => {
      const sessionDigest = "8".repeat(64)
      await insertStandalonePlayback({
        id: "buffered-before-issuance",
        sessionDigest,
        occurredAt: "2026-08-26T10:59:55.000Z",
      })
      await insertStandalonePlayback({
        id: "clock-ahead",
        sessionDigest,
        createdAt: "2026-08-26T12:00:00.000Z",
        occurredAt: "2026-08-26T12:00:05.000Z",
      })
      const result = await getRecommendationRecentContext(prisma, {
        sessionDigest,
        profileTokenDigest: null,
        allowDurableProfileLinks: false,
        now,
      })
      expect(result.videos).toEqual([
        {
          targetMediaId: "clock-ahead",
          reasonCodes: ["recent_playback_start"],
        },
        {
          targetMediaId: "buffered-before-issuance",
          reasonCodes: ["recent_playback_start"],
        },
      ])
    })

    it("uses the session index for bounded lookup amid unrelated episode history", async () => {
      await admin.query(`INSERT INTO recommendation_playback_episode (
        id, media_id, session_digest, state, discovery_source,
        created_at, active_until, hard_until, expires_at
      ) SELECT 'noise-' || n, 'noise-video-' || n, repeat('7', 64), 'claimed', 'search',
        '2026-08-26T10:00:00Z'::timestamptz, '2026-08-26T11:00:00Z'::timestamptz,
        '2026-08-26T16:00:00Z'::timestamptz, '2026-09-24T10:00:00Z'::timestamptz
      FROM generate_series(1, 10000) n`)
      await admin.query("ANALYZE recommendation_playback_episode")
      const timings: number[] = []
      for (let i = 0; i < 25; i += 1) {
        const start = performance.now()
        await getRecommendationRecentContext(prisma, {
          sessionDigest: currentSession,
          profileTokenDigest: null,
          allowDurableProfileLinks: false,
          now,
        })
        timings.push(performance.now() - start)
      }
      const query = observedQueries.at(-1)!
      const explained = await admin.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`,
        JSON.parse(query.params),
      )
      expect(JSON.stringify(explained.rows)).toContain(
        "recommendation_episode_session_created_idx",
      )
      timings.sort((a, b) => a - b)
      console.info(
        "Recent-context local benchmark (10000 unrelated episodes)",
        {
          samples: timings.length,
          medianMs: timings[12],
          p95Ms: timings[23],
          executionMs: explained.rows[0]["QUERY PLAN"][0]["Execution Time"],
        },
      )
    })
  },
)
