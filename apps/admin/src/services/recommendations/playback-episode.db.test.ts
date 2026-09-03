import { readdirSync, readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
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
    return ordinal >= 52 && ordinal <= 72 && name.includes("recommendation")
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
  },
)
