import { readdirSync, readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { RecommendationEvidenceService } from "./evidence.service"
import { RecommendationEpisodeService } from "./episode.service"
import { RecommendationOutcomeService } from "./outcome.service"
import { RecommendationPlaybackService } from "./playback.service"
import {
  loadPlaybackEpisodeDetail,
  loadPlaybackEvidenceOverview,
} from "./admin-ops/playback.service"
import { PlaybackProxyReadinessService } from "./proxy-readiness.service"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "./token.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)
const recommendationMigrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return ordinal >= 52 && ordinal <= 75 && name.includes("recommendation")
  })
  .sort()
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"),
  )

const caller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "source-neutral playback episodes against real PostgreSQL",
  () => {
    const schemaName = `playback_episode_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    const startedAt = new Date()
    let current = startedAt
    let client: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      for (const migration of recommendationMigrations) {
        await client.query(migration)
      }
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schemaName)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    it("publishes superseding revisions and rebuilds exactly from standalone immutable facts", async () => {
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "playback-test",
              status: "active",
              key: Buffer.alloc(32, 7).toString("base64url"),
            },
          ],
        }),
      )
      const tokenCore = createRecommendationTokenService({
        keyring,
        readRevokedKids: async () => [],
        now: () => current,
      })
      let id = 0
      let nonce = 0
      const newId = () => `playback-test-${++id}`
      const tokenService = { activeKid: keyring.active.kid, ...tokenCore }
      const episodeService = new RecommendationEpisodeService({
        prisma,
        tokenService,
        now: () => current,
        newId,
        newClaimNonce: () => `standalone-context-claim-nonce-${++nonce}`,
      })
      const context = await episodeService.issueContext({
        caller,
        sessionDigest: "a".repeat(64),
        mediaId: "direct-media",
        discoverySource: "direct",
        provenance: { entry: "canonical" },
      })
      const claim = await episodeService.claim({
        caller,
        sessionDigest: "a".repeat(64),
        mediaId: "direct-media",
        claimNonce: context.claimNonce,
      })
      const playbackService = new RecommendationPlaybackService({
        prisma,
        tokenService,
        now: () => current,
        newId,
      })
      current = new Date(startedAt.getTime() + 20_000)
      await playbackService.record({
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: claim.capability,
        episodeId: claim.episodeId,
        sessionDigest: "a".repeat(64),
        mediaId: "direct-media",
        events: [
          {
            eventId: "attempt",
            kind: "playback_attempt",
            occurredAt: startedAt.toISOString(),
            payload: { initiation: "manual" },
          },
          {
            eventId: "start",
            kind: "playback_start",
            occurredAt: startedAt.toISOString(),
            payload: { positionSeconds: 0 },
          },
          {
            eventId: "active-first",
            kind: "playback_active_visible_playing",
            occurredAt: new Date(startedAt.getTime() + 10_000).toISOString(),
            payload: { activeMilliseconds: 10_000, coverage: "complete" },
          },
          {
            eventId: "end",
            kind: "playback_end",
            occurredAt: new Date(startedAt.getTime() + 20_000).toISOString(),
            payload: {
              reason: "route_exit",
              positionSeconds: 45,
              durationSeconds: 100,
              progress: 0.45,
              completed: false,
            },
          },
        ],
      })
      const outcomeService = new RecommendationOutcomeService({
        prisma,
        now: () => current,
        newId,
      })
      const first = await outcomeService.finalize({
        episodeId: claim.episodeId,
        generation: 1,
        reason: "terminal-fact",
      })
      expect(first).toMatchObject({ status: "published", factWatermark: 4 })

      current = new Date(startedAt.getTime() + 4.5 * 60 * 60 * 1_000)
      await playbackService.record({
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: claim.capability,
        episodeId: claim.episodeId,
        sessionDigest: "a".repeat(64),
        mediaId: "direct-media",
        events: [
          {
            eventId: "active-late-reordered",
            kind: "playback_active_visible_playing",
            occurredAt: new Date(startedAt.getTime() + 15_000).toISOString(),
            payload: { activeMilliseconds: 10_000, coverage: "complete" },
          },
        ],
      })
      const [racedA, racedB] = await Promise.all([
        outcomeService.finalize({
          episodeId: claim.episodeId,
          generation: 1,
          reason: "fact-advanced",
        }),
        outcomeService.finalize({
          episodeId: claim.episodeId,
          generation: 1,
          reason: "fact-advanced",
        }),
      ])
      expect([racedA.status, racedB.status].sort()).toEqual([
        "existing",
        "published",
      ])
      const active = await prisma.recommendationOutcomeRevision.findMany({
        where: {
          episodeId: claim.episodeId,
          classifierVersion: "active-watch-proxy-v1",
        },
        orderBy: { revision: "asc" },
      })
      expect(active).toHaveLength(2)
      expect(active[1]).toMatchObject({
        revision: 2,
        factWatermark: 5,
        supersedesId: active[0]!.id,
        activePlaybackMilliseconds: 15_000,
        durationCohort: "medium",
        learningEligible: false,
      })
      expect(active[1]!.activeIntervals).toEqual([
        {
          startMilliseconds: startedAt.getTime(),
          endMilliseconds: startedAt.getTime() + 15_000,
        },
      ])
      await expect(
        outcomeService.rebuildProjection({
          episodeId: claim.episodeId,
          generation: 1,
        }),
      ).resolves.toMatchObject({
        status: "matched",
        factWatermark: 5,
        activePlaybackMilliseconds: 15_000,
      })
      await expect(
        outcomeService.finalize({
          episodeId: claim.episodeId,
          generation: 2,
          reason: "recovery",
        }),
      ).resolves.toEqual({
        status: "fenced",
        reason: "generation_changed",
      })

      current = new Date(current.getTime() + 1_000)
      const evaluation = await new PlaybackProxyReadinessService({
        prisma,
        now: () => current,
        newId,
      }).evaluate({
        windowStart: new Date(startedAt.getTime() - 1_000),
        windowEnd: current,
      })
      expect(evaluation).toMatchObject({
        revision: 1,
        sampleCount: 1,
        pairedCount: 1,
        missingCount: 0,
        decision: "inconclusive",
        reasonCodes: ["insufficient_sample"],
        rankingInfluence: false,
      })

      const overview = await loadPlaybackEvidenceOverview(prisma, {
        window: "24h",
        now: current,
      })
      expect(overview.counts).toMatchObject({
        episodes: 1,
        facts: 5,
        outcomes: 4,
      })
      expect(overview.sourceCounts).toEqual([{ source: "direct", count: 1 }])
      expect(overview.latestEvaluation?.inputDigest).toMatch(/^[a-f0-9]{64}$/)

      const detail = await loadPlaybackEpisodeDetail(prisma, {
        episodeId: claim.episodeId,
        actorDigest: "f".repeat(64),
        now: current,
      })
      expect(detail).toMatchObject({
        id: claim.episodeId,
        requestId: null,
        discoverySource: "direct",
        provenance: { entry: "canonical" },
      })
      expect(detail?.facts).toHaveLength(5)
      expect(detail?.outcomes).toHaveLength(4)
      await expect(
        prisma.recommendationTraceAccessAudit.count({
          where: { episodeId: claim.episodeId, requestId: null },
        }),
      ).resolves.toBe(1)

      const timeoutStartedAt = current
      const timeoutContext = await episodeService.issueContext({
        caller,
        sessionDigest: "b".repeat(64),
        mediaId: "timeout-media",
        discoverySource: "direct",
      })
      const timeoutClaim = await episodeService.claim({
        caller,
        sessionDigest: "b".repeat(64),
        mediaId: "timeout-media",
        claimNonce: timeoutContext.claimNonce,
      })
      current = new Date(timeoutStartedAt.getTime() + 10_000)
      await playbackService.record({
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: timeoutClaim.capability,
        episodeId: timeoutClaim.episodeId,
        sessionDigest: "b".repeat(64),
        mediaId: "timeout-media",
        events: [
          {
            eventId: "timeout-start",
            kind: "playback_start",
            occurredAt: timeoutStartedAt.toISOString(),
            payload: { positionSeconds: 0 },
          },
          {
            eventId: "timeout-active-first",
            kind: "playback_active_visible_playing",
            occurredAt: current.toISOString(),
            payload: { activeMilliseconds: 10_000, coverage: "complete" },
          },
        ],
      })
      current = new Date(timeoutStartedAt.getTime() + 4 * 60 * 60 * 1_000 + 1)
      await expect(
        outcomeService.finalize({
          episodeId: timeoutClaim.episodeId,
          generation: 1,
          reason: "timeout",
        }),
      ).resolves.toMatchObject({ status: "published", factWatermark: 2 })
      await playbackService.record({
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: timeoutClaim.capability,
        episodeId: timeoutClaim.episodeId,
        sessionDigest: "b".repeat(64),
        mediaId: "timeout-media",
        events: [
          {
            eventId: "timeout-active-late",
            kind: "playback_active_visible_playing",
            occurredAt: new Date(
              timeoutStartedAt.getTime() + 20_000,
            ).toISOString(),
            payload: { activeMilliseconds: 10_000, coverage: "complete" },
          },
        ],
      })
      await expect(
        outcomeService.finalize({
          episodeId: timeoutClaim.episodeId,
          generation: 1,
          reason: "timeout",
        }),
      ).resolves.toMatchObject({
        status: "published",
        revision: 2,
        factWatermark: 3,
      })
    })

    it("serializes concurrent selection and impression while preserving exact replay semantics", async () => {
      const raceNow = new Date()
      const raceExpiresAt = new Date(raceNow.getTime() + 24 * 60 * 60 * 1_000)
      const sessionDigest = "9".repeat(64)
      const capabilityJti = "race-item-capability-jti"
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "race-test",
              status: "active",
              key: Buffer.alloc(32, 9).toString("base64url"),
            },
          ],
        }),
      )
      const tokenCore = createRecommendationTokenService({
        keyring,
        readRevokedKids: async () => [],
        now: () => raceNow,
      })
      const tokenService = { activeKid: keyring.active.kid, ...tokenCore }
      const capability = await tokenCore.signDeliveryCapability({
        jti: capabilityJti,
        requestId: "race-request",
        itemId: "race-item",
        sessionDigest,
        surface: "watch-below-player-v1",
        manifestId: "semantic-transcript-pgvector-v1",
      })

      await client.query("BEGIN")
      await client.query(
        `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, state, result,
          delivery_jti, signing_kid, issued_at, expires_at
        ) VALUES (
          'race-request', 'semantic-recommendation-v1',
          'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
          'semantic-transcript-pgvector-v1', 'legacy-position-v0', $1,
          'race-seed', 'en', 1, 'prepared', 'served',
          'race-delivery-jti', 'race-test', $2, $3
        )`,
        [sessionDigest, raceNow, raceExpiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, capability_jti,
          signing_kid, expires_at
        ) VALUES (
          'race-item', 'race-request', 0, 'race-target',
          '/watch/race-target.html', 'semantic', '{}'::jsonb, $1,
          'race-test', $2
        )`,
        [capabilityJti, raceExpiresAt],
      )
      await client.query(
        `UPDATE recommendation_request SET state = 'issued'
         WHERE id = 'race-request'`,
      )
      await client.query("COMMIT")

      let raceId = 0
      const dispatchProfileFeedback = vi.fn(async () => undefined)
      const episodeService = new RecommendationEpisodeService({
        prisma,
        tokenService,
        now: () => raceNow,
        newId: () => `race-generated-${++raceId}`,
        dispatchProfileFeedback,
      })
      const evidenceService = new RecommendationEvidenceService({
        prisma,
        tokenService,
        now: () => raceNow,
        dispatchProfileFeedback,
      })
      const selectionInput = {
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability,
        requestId: "race-request",
        itemId: "race-item",
        sessionDigest,
        eventId: "race-selection-event",
        occurredAt: raceNow.toISOString(),
        tabDigest: "8".repeat(64),
        claimNonce: "race-client-handoff-nonce",
      }
      const [selection, impression] = await Promise.all([
        episodeService.select(selectionInput),
        evidenceService.record({
          caller,
          contractVersion: "recommendation-evidence-v1",
          capability,
          requestId: "race-request",
          itemId: "race-item",
          sessionDigest,
          events: [
            {
              eventId: "race-impression-event",
              kind: "impression" as const,
              occurredAt: raceNow.toISOString(),
              payload: { visibilityPolicy: "watch-below-player-v1" },
            },
          ],
        }),
      ])

      expect(selection).toMatchObject({
        status: "accepted",
        claimNonce: selectionInput.claimNonce,
      })
      expect(impression).toEqual([
        { eventId: "race-impression-event", status: "accepted" },
      ])
      await expect(
        episodeService.select(selectionInput),
      ).resolves.toMatchObject({
        status: "replay",
        claimNonce: selectionInput.claimNonce,
      })
      await expect(
        episodeService.select({
          ...selectionInput,
          claimNonce: "different-client-handoff-nonce",
        }),
      ).resolves.toMatchObject({ status: "conflict", claimNonce: null })
      const committed = await prisma.recommendationSelection.findUnique({
        where: { itemId: "race-item" },
        select: { attributionEligibleAt: true },
      })
      expect(committed?.attributionEligibleAt).toEqual(raceNow)
      expect(dispatchProfileFeedback).not.toHaveBeenCalled()
    })

    it("keeps navigation-only selections out of attribution and separates transport replays", async () => {
      const receivedAt = new Date()
      const expiresAt = new Date(receivedAt.getTime() + 24 * 60 * 60 * 1_000)
      const activeUntil = new Date(receivedAt.getTime() + 60 * 60 * 1_000)
      const hardUntil = new Date(receivedAt.getTime() + 2 * 60 * 60 * 1_000)
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, result, expires_at
        ) VALUES (
          'attribution-request', 'semantic-recommendation-v1',
          'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
          'semantic-transcript-pgvector-v1', 'legacy-position-v0', $1,
          'seed-media', 'en', 1, 'served', $2
        )`,
        ["b".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, expires_at
        ) VALUES (
          'attribution-item', 'attribution-request', 0, 'target-media',
          '/watch/target.html', 'semantic', '{}'::jsonb, $1
        )`,
        [expiresAt],
      )
      await client.query("COMMIT")
      await client.query(
        `INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, claim_nonce_digest, handoff_expires_at,
          occurred_at, received_at, expires_at
        ) VALUES (
          'attribution-selection', 'attribution-request', 'attribution-item',
          'attribution-selection-jti', 'selection-event', $1, $2, $3,
          $4, $4, $3
        )`,
        ["c".repeat(64), "d".repeat(64), expiresAt, receivedAt],
      )

      const pending = await client.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM recommendation_selection
         WHERE id = 'attribution-selection'
           AND attribution_eligible_at <= $1`,
        [receivedAt],
      )
      expect(pending.rows[0]?.count).toBe(0)
      await expect(
        client.query(
          `UPDATE recommendation_selection
           SET attribution_eligible_at = $1
           WHERE id = 'attribution-selection'`,
          [receivedAt],
        ),
      ).rejects.toThrow("requires an eligible impression")

      await client.query(
        `INSERT INTO recommendation_impression (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, visibility_policy, occurred_at, received_at,
          expires_at
        ) VALUES (
          'attribution-impression', 'attribution-request', 'attribution-item',
          'attribution-impression-jti', 'impression-event', $1,
          'watch-below-player-v1', $2, $2, $3
        )`,
        ["e".repeat(64), receivedAt, expiresAt],
      )
      await client.query(
        `UPDATE recommendation_selection
         SET attribution_eligible_at = $1
         WHERE id = 'attribution-selection'`,
        [receivedAt],
      )
      await expect(
        client.query(
          `UPDATE recommendation_selection
           SET attribution_eligible_at = $1
           WHERE id = 'attribution-selection'`,
          [new Date(receivedAt.getTime() + 1)],
        ),
      ).rejects.toThrow("immutable once eligible")

      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, request_id, item_id, selection_id, media_id, session_digest,
          state, active_until, hard_until, expires_at
        ) VALUES (
          'attribution-episode', 'attribution-request', 'attribution-item',
          'attribution-selection', 'target-media', $1, 'pending', $2, $3, $4
        )`,
        ["b".repeat(64), activeUntil, hardUntil, expiresAt],
      )
      await client.query(
        `UPDATE recommendation_playback_episode
         SET transport_replay_count = transport_replay_count + 5
         WHERE id = 'attribution-episode'`,
      )
      const episode = await client.query<{
        replayCount: number
        transportReplayCount: number
        conflictCount: number
      }>(
        `SELECT replay_count AS "replayCount",
                transport_replay_count AS "transportReplayCount",
                conflict_count AS "conflictCount"
         FROM recommendation_playback_episode
         WHERE id = 'attribution-episode'`,
      )
      expect(episode.rows[0]).toEqual({
        replayCount: 0,
        transportReplayCount: 5,
        conflictCount: 0,
      })
    })
  },
)
