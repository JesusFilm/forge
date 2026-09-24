import {
  getOrCreateWatchChapterCarouselMuxBlurDataUrl,
  getOrCreateWatchHeroPosterMuxBlurDataUrl,
  getOrScheduleWatchChapterCarouselMuxBlurDataUrl,
  getOrScheduleWatchChapterCarouselMuxDominantColor,
  getOrScheduleWatchHeroPosterMuxBlurDataUrl,
  getOrScheduleWatchHeroPosterMuxDominantColor,
  getOrScheduleWatchMuxImageMetadata,
} from "../mux-image-derivative.service"

import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { createLoaders } from "@/graphql/loaders"
import { RecommendationEvidenceService } from "./evidence.service"
import { RecommendationEpisodeService } from "./episode.service"
import { RecommendationOutcomeService } from "./outcome.service"
import { RecommendationPlaybackService } from "./playback.service"
import {
  consumeDeliveryCapabilitySubmissions,
  consumeEpisodeCapabilitySubmissions,
} from "./submission-budget"
import {
  loadPlaybackEpisodeDetail,
  loadPlaybackEvidenceOverview,
} from "./admin-ops/playback.service"
import { refreshPlaybackObservationSnapshots } from "./admin-ops/playback-observation-snapshot"
import { PlaybackProxyReadinessService } from "./proxy-readiness.service"
import { PlaybackSignalReadinessService } from "./playback-signal-readiness.service"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "./token.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)
const recommendationMigrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return (
      (ordinal >= 52 && ordinal <= 82 && name.includes("recommendation")) ||
      name === "0082_user_recommendation_identity" ||
      name === "0099_recommendation_playback_signal_readiness"
    )
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
        adapter: new PrismaPg(
          {
            connectionString: url.toString(),
            options: `-c search_path=${schemaName},public`,
          },
          { schema: schemaName },
        ),
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

    it("serializes concurrent transport replays before assigning receipt ordinals", async () => {
      const replayNow = new Date()
      const sessionDigest = "7".repeat(64)
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "replay-race-test",
              status: "active",
              key: Buffer.alloc(32, 6).toString("base64url"),
            },
          ],
        }),
      )
      const tokenCore = createRecommendationTokenService({
        keyring,
        readRevokedKids: async () => [],
        now: () => replayNow,
      })
      const tokenService = { activeKid: keyring.active.kid, ...tokenCore }
      let id = 0
      const newId = () =>
        id++ === 0 ? "replay-race-episode" : `replay-race-${id}`
      const episodeService = new RecommendationEpisodeService({
        prisma,
        tokenService,
        now: () => replayNow,
        newId,
        newClaimNonce: () => "replay-race-context-nonce",
      })
      const context = await episodeService.issueContext({
        caller,
        sessionDigest,
        mediaId: "replay-race-media",
        discoverySource: "direct",
      })
      const claim = await episodeService.claim({
        caller,
        sessionDigest,
        mediaId: "replay-race-media",
        claimNonce: context.claimNonce,
      })
      const playbackService = new RecommendationPlaybackService({
        prisma,
        tokenService,
        now: () => replayNow,
        newId,
      })
      const replayEvent = {
        eventId: "replay-race-event",
        kind: "playback_start" as const,
        occurredAt: replayNow.toISOString(),
        payload: { positionSeconds: 0 },
      }
      const input = {
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: claim.capability,
        episodeId: claim.episodeId,
        sessionDigest,
        mediaId: "replay-race-media",
        events: [replayEvent],
      }
      await playbackService.record(input)

      await client.query(`
        CREATE FUNCTION slow_replay_counter_update() RETURNS trigger AS $$
        BEGIN
          IF NEW.id = 'replay-race-episode'
             AND NEW.transport_replay_count > OLD.transport_replay_count THEN
            PERFORM pg_sleep(0.1);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER slow_replay_counter_update
          BEFORE UPDATE OF transport_replay_count
          ON recommendation_playback_episode
          FOR EACH ROW EXECUTE FUNCTION slow_replay_counter_update();
      `)

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => playbackService.record(input)),
      )
      await client.query(`
        DROP TRIGGER slow_replay_counter_update ON recommendation_playback_episode;
        DROP FUNCTION slow_replay_counter_update();
      `)
      for (const result of results) {
        expect(result).toEqual({
          status: "fulfilled",
          value: [
            { eventId: replayEvent.eventId, status: "replay", sequence: 1 },
          ],
        })
      }
      const receipts =
        await prisma.recommendationPlaybackTransportReplayReceipt.findMany({
          where: { episodeId: claim.episodeId },
          orderBy: { replayOrdinal: "asc" },
          select: { replayOrdinal: true },
        })
      expect(receipts).toEqual(
        Array.from({ length: 8 }, (_, index) => ({ replayOrdinal: index + 1 })),
      )
      await expect(
        prisma.recommendationPlaybackEpisode.findUnique({
          where: { id: claim.episodeId },
          select: { transportReplayCount: true },
        }),
      ).resolves.toEqual({ transportReplayCount: 8 })

      // A held external lock exhausts only admission retries: no partial
      // receipt is committed, and the exact payload can be replayed later.
      await client.query("BEGIN")
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 368))",
        [claim.episodeId],
      )
      try {
        await expect(playbackService.record(input)).rejects.toMatchObject({
          code: "recommendation_episode_lock_exhausted",
        })
      } finally {
        await client.query("ROLLBACK")
      }
      await expect(
        prisma.recommendationPlaybackTransportReplayReceipt.count({
          where: { episodeId: claim.episodeId },
        }),
      ).resolves.toBe(8)
      await expect(playbackService.record(input)).resolves.toEqual([
        { eventId: replayEvent.eventId, status: "replay", sequence: 1 },
      ])
      await expect(
        prisma.recommendationPlaybackTransportReplayReceipt.count({
          where: { episodeId: claim.episodeId },
        }),
      ).resolves.toBe(9)
    })

    it("reconciles eight simultaneous standalone claims to the persisted capability", async () => {
      const now = new Date()
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "claim-race",
              status: "active",
              key: Buffer.alloc(32, 4).toString("base64url"),
            },
          ],
        }),
      )
      const tokenService = {
        activeKid: keyring.active.kid,
        ...createRecommendationTokenService({
          keyring,
          readRevokedKids: async () => [],
          now: () => now,
        }),
      }
      const episodeService = new RecommendationEpisodeService({
        prisma,
        tokenService,
        now: () => now,
      })
      const sessionDigest = "8".repeat(64)
      const context = await episodeService.issueContext({
        caller,
        sessionDigest,
        mediaId: "claim-race-media",
        discoverySource: "direct",
      })
      const claims = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          episodeService.claim({
            caller,
            sessionDigest,
            mediaId: "claim-race-media",
            claimNonce: context.claimNonce,
          }),
        ),
      )
      const canonical = await episodeService.claim({
        caller,
        sessionDigest,
        mediaId: "claim-race-media",
        claimNonce: context.claimNonce,
      })
      for (const claim of claims)
        expect(claim).toEqual({ status: "fulfilled", value: canonical })
      const playbackService = new RecommendationPlaybackService({
        prisma,
        tokenService,
        now: () => now,
      })
      const event = {
        eventId: "claim-race-start",
        kind: "playback_start",
        occurredAt: now.toISOString(),
        payload: { positionSeconds: 0 },
      }
      const receipts = await Promise.all(
        Array.from({ length: 8 }, () =>
          playbackService.record({
            caller,
            sessionDigest,
            mediaId: "claim-race-media",
            episodeId: canonical.episodeId,
            capability: canonical.capability,
            contractVersion: "recommendation-evidence-v1",
            events: [event],
          }),
        ),
      )
      expect(
        receipts.flat().filter((receipt) => receipt.status === "accepted"),
      ).toHaveLength(1)
      expect(
        receipts.flat().filter((receipt) => receipt.status === "replay"),
      ).toHaveLength(7)
    })

    it("preserves mixed late facts, exact replay and conflicts while finalizers race", async () => {
      const started = new Date()
      let now = started
      const sessionDigest = "9".repeat(64)
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "mixed-race",
              status: "active",
              key: Buffer.alloc(32, 5).toString("base64url"),
            },
          ],
        }),
      )
      const tokenService = {
        activeKid: keyring.active.kid,
        ...createRecommendationTokenService({
          keyring,
          readRevokedKids: async () => [],
          now: () => now,
        }),
      }
      const episodeService = new RecommendationEpisodeService({
        prisma,
        tokenService,
        now: () => now,
      })
      const context = await episodeService.issueContext({
        caller,
        sessionDigest,
        mediaId: "mixed-race-media",
        discoverySource: "direct",
      })
      const claim = await episodeService.claim({
        caller,
        sessionDigest,
        mediaId: "mixed-race-media",
        claimNonce: context.claimNonce,
      })
      const playbackService = new RecommendationPlaybackService({
        prisma,
        tokenService,
        now: () => now,
      })
      const outcomeService = new RecommendationOutcomeService({
        prisma,
        now: () => now,
      })
      const input = {
        caller,
        sessionDigest,
        mediaId: "mixed-race-media",
        episodeId: claim.episodeId,
        capability: claim.capability,
        contractVersion: "recommendation-evidence-v1",
      }
      const end = {
        eventId: "mixed-end",
        kind: "playback_end",
        occurredAt: started.toISOString(),
        payload: {
          reason: "ended",
          positionSeconds: 10,
          durationSeconds: 100,
          progress: 0.1,
          completed: false,
        },
      }
      await playbackService.record({ ...input, events: [end] })
      const finalization = {
        episodeId: claim.episodeId,
        generation: 1,
        reason: "fact-advanced" as const,
      }
      await outcomeService.finalize(finalization)
      const original = await prisma.recommendationPlaybackFact.findFirstOrThrow(
        { where: { episodeId: claim.episodeId } },
      )
      now = new Date(started.getTime() + 4.5 * 60 * 60 * 1000)
      const writes = Array.from({ length: 8 }, (_, index) =>
        playbackService.record({
          ...input,
          events: [
            {
              ...end,
              payload: {
                ...end.payload,
                positionSeconds: index % 2 === 0 ? 10 : 20,
              },
            },
            {
              eventId: `mixed-active-${index}`,
              kind: "playback_active_visible_playing",
              occurredAt: started.toISOString(),
              payload: { activeMilliseconds: 1000, coverage: "complete" },
            },
          ],
        }),
      )
      const results = await Promise.allSettled([
        ...writes,
        ...Array.from({ length: 8 }, () =>
          outcomeService.finalize(finalization),
        ),
      ])
      for (const result of results) expect(result.status).toBe("fulfilled")
      const receipts = await Promise.all(writes)
      expect(
        receipts.flat().filter((receipt) => receipt.status === "accepted"),
      ).toHaveLength(8)
      expect(
        receipts.flat().filter((receipt) => receipt.status === "replay"),
      ).toHaveLength(4)
      expect(
        receipts.flat().filter((receipt) => receipt.status === "conflict"),
      ).toHaveLength(4)
      await expect(
        prisma.recommendationPlaybackFact.findUnique({
          where: { id: original.id },
        }),
      ).resolves.toEqual(original)
      const facts = await prisma.recommendationPlaybackFact.findMany({
        where: { episodeId: claim.episodeId },
        orderBy: { sequence: "asc" },
      })
      expect(facts.map((fact) => fact.sequence)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ])
      expect(facts.filter((fact) => fact.late)).toHaveLength(8)
      const replays =
        await prisma.recommendationPlaybackTransportReplayReceipt.findMany({
          where: { episodeId: claim.episodeId },
          orderBy: { replayOrdinal: "asc" },
        })
      expect(replays.map((receipt) => receipt.replayOrdinal)).toEqual([
        1, 2, 3, 4,
      ])
      await expect(
        prisma.recommendationPlaybackEpisode.findUnique({
          where: { id: claim.episodeId },
          select: {
            nextFactSequence: true,
            transportReplayCount: true,
            conflictCount: true,
          },
        }),
      ).resolves.toEqual({
        nextFactSequence: 10,
        transportReplayCount: 4,
        conflictCount: 4,
      })
      await outcomeService.finalize(finalization)
      await expect(
        outcomeService.rebuildProjection({
          episodeId: claim.episodeId,
          generation: 1,
        }),
      ).resolves.toMatchObject({ status: "matched", factWatermark: 9 })
      const outcomes = await prisma.recommendationOutcomeRevision.findMany({
        where: {
          episodeId: claim.episodeId,
          classifierVersion: "active-watch-proxy-v1",
        },
        orderBy: { revision: "asc" },
      })
      expect(outcomes.length).toBeGreaterThanOrEqual(2)
      for (const [index, outcome] of outcomes.entries()) {
        expect(outcome.revision).toBe(index + 1)
        expect(outcome.supersedesId).toBe(
          index === 0 ? null : outcomes[index - 1].id,
        )
      }
    })

    it("accepts an impression received while selection is pending and preserves exact replay semantics", async () => {
      const raceNow = new Date()
      const impressionNow = new Date(raceNow.getTime() + 100)
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
      let notifySelectionStarted = () => {}
      let resumeSelection = () => {}
      const selectionStarted = new Promise<void>((resolve) => {
        notifySelectionStarted = resolve
      })
      const releaseSelection = new Promise<void>((resolve) => {
        resumeSelection = resolve
      })
      const episodeService = new RecommendationEpisodeService({
        prisma,
        tokenService: {
          ...tokenService,
          verifyDeliveryCapability: async (...args) => {
            const verified = await tokenCore.verifyDeliveryCapability(...args)
            notifySelectionStarted()
            await releaseSelection
            return verified
          },
        },
        now: () => raceNow,
        newId: () => `race-generated-${++raceId}`,
        dispatchProfileFeedback,
      })
      const evidenceService = new RecommendationEvidenceService({
        prisma,
        tokenService,
        now: () => impressionNow,
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
      const selecting = episodeService.select(selectionInput)
      await selectionStarted
      const [selection, impression] = await Promise.all([
        selecting,
        evidenceService
          .record({
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
          })
          .finally(() => resumeSelection()),
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
      expect(committed?.attributionEligibleAt).toEqual(impressionNow)
      expect(dispatchProfileFeedback).not.toHaveBeenCalled()
      const claimInput = {
        caller,
        sessionDigest,
        mediaId: "race-target",
        claimNonce: selectionInput.claimNonce,
      }
      const claims = await Promise.allSettled(
        Array.from({ length: 8 }, () => episodeService.claim(claimInput)),
      )
      const canonical = await episodeService.claim(claimInput)
      for (const claim of claims)
        expect(claim).toEqual({ status: "fulfilled", value: canonical })
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
    it("ingests observation families, recomputes authorized detail, and obeys retention", async () => {
      current = new Date()
      const began = current
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "observations-test",
              status: "active",
              key: Buffer.alloc(32, 8).toString("base64url"),
            },
          ],
        }),
      )
      const tokenService = {
        activeKid: keyring.active.kid,
        ...createRecommendationTokenService({
          keyring,
          readRevokedKids: async () => [],
          now: () => current,
        }),
      }
      const episodes = new RecommendationEpisodeService({
        prisma,
        tokenService,
        now: () => current,
      })
      const context = await episodes.issueContext({
        caller,
        sessionDigest: "c".repeat(64),
        mediaId: "observation-media",
        discoverySource: "search",
      })
      const claim = await episodes.claim({
        caller,
        sessionDigest: "c".repeat(64),
        mediaId: "observation-media",
        claimNonce: context.claimNonce,
      })
      const playback = new RecommendationPlaybackService({
        prisma,
        tokenService,
        now: () => current,
      })
      current = new Date(began.getTime() + 3000)
      const events = [
        {
          eventId: "observation-attempt",
          kind: "playback_attempt",
          occurredAt: began.toISOString(),
          payload: {
            initiation: "manual",
          },
        },
        {
          eventId: "observation-buffer",
          kind: "playback_qoe",
          occurredAt: new Date(began.getTime() + 1000).toISOString(),
          payload: { action: "waiting", cause: "unknown", positionSeconds: 0 },
        },
        {
          eventId: "observation-summary",
          kind: "playback_observation",
          occurredAt: current.toISOString(),
          payload: {
            version: "playback-observations-v1",
            elapsedMilliseconds: 3000,
            visibility: "visible",
            playerState: "buffering",
            startObserved: false,
            errorObserved: false,
            seekCount: 0,
            navigationCount: 0,
            qoeCount: 1,
          },
        },
        {
          eventId: "observation-end",
          kind: "playback_end",
          occurredAt: current.toISOString(),
          payload: {
            reason: "pagehide",
            positionSeconds: 0,
            durationSeconds: 120,
            progress: 0,
            completed: false,
          },
        },
      ]
      const input = {
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: claim.capability,
        episodeId: claim.episodeId,
        sessionDigest: "c".repeat(64),
        mediaId: "observation-media",
        events,
      }
      // A schema-invalid batch is rejected before any baseline fact is persisted.
      await expect(
        playback.record({
          ...input,
          events: [
            events[0],
            {
              eventId: "invalid-optional",
              kind: "playback_qoe",
              occurredAt: current.toISOString(),
              payload: {
                action: "waiting",
                cause: "dislike",
                positionSeconds: 0,
              },
            },
          ],
        }),
      ).rejects.toThrow()
      expect(
        await prisma.recommendationPlaybackFact.count({
          where: { episodeId: claim.episodeId },
        }),
      ).toBe(0)
      await playback.record(input)
      await playback.record(input)
      const outcomes = new RecommendationOutcomeService({
        prisma,
        now: () => current,
      })
      await outcomes.finalize({
        episodeId: claim.episodeId,
        generation: 1,
        reason: "terminal-fact",
      })
      const detail = await loadPlaybackEpisodeDetail(prisma, {
        episodeId: claim.episodeId,
        actorDigest: "f".repeat(64),
        now: current,
      })
      expect(detail?.facts).toHaveLength(4)
      expect(detail?.facts.every((fact) => !("payload" in fact))).toBe(true)
      expect(detail?.observations).toMatchObject({
        preferenceInterpretation: "unknown",
        rankingInfluence: false,
        departure: { classification: "pre_start_departure", immediate: true },
        qoe: { bufferingEpisodes: 1, openBufferingInterval: true },
      })
      expect(detail?.outcomes.every((outcome) => !outcome.qualifiedView)).toBe(
        true,
      )
      const digest = detail?.observations.inputDigest
      current = new Date(current.getTime() + 1000)
      await playback.record({
        ...input,
        events: [
          {
            eventId: "observation-hidden",
            kind: "playback_navigation",
            occurredAt: new Date(began.getTime() + 2000).toISOString(),
            payload: { action: "hidden", cause: "unknown", positionSeconds: 0 },
          },
        ],
      })
      const revised = await loadPlaybackEpisodeDetail(prisma, {
        episodeId: claim.episodeId,
        actorDigest: "f".repeat(64),
        now: current,
      })
      expect(revised?.observations.inputDigest).not.toBe(digest)
      expect(revised?.observations.departure).toMatchObject({
        classification: "interrupted_visibility_or_lifecycle",
        immediate: null,
      })
      await refreshPlaybackObservationSnapshots(prisma, current)
      const overview = await loadPlaybackEvidenceOverview(prisma, {
        window: "24h",
        now: current,
      })
      expect(overview.observationSample.qoeObserved).toBeGreaterThanOrEqual(1)
      expect(overview.observationWindow?.qoe.observed).toBeGreaterThanOrEqual(1)
      expect(overview.observationWindow?.attempts).toBeGreaterThanOrEqual(1)
      const readinessService = new PlaybackSignalReadinessService({
        prisma,
        now: () => current,
      })
      const readinessWindow = {
        windowStart: new Date(began.getTime() - 1000),
        windowEnd: current,
      }
      const evaluations = await readinessService.evaluate(readinessWindow)
      expect(evaluations).toMatchObject([
        {
          family: "navigation",
          decision: "inconclusive",
          rankingInfluence: false,
        },
        { family: "qoe", decision: "inconclusive", rankingInfluence: false },
      ])
      expect(await readinessService.evaluate(readinessWindow)).toEqual(
        evaluations,
      )
      await expect(
        loadPlaybackEpisodeDetail(prisma, {
          episodeId: claim.episodeId,
          actorDigest: "invalid",
          now: current,
        }),
      ).resolves.toBeNull()
      await expect(
        loadPlaybackEpisodeDetail(prisma, {
          episodeId: claim.episodeId,
          actorDigest: "f".repeat(64),
          now: new Date(began.getTime() + 30 * 86400_000),
        }),
      ).resolves.toBeNull()
    })

    it("samples only the 20 newest retained episodes and excludes the oldest classification", async () => {
      // Use a separate reporting window so earlier fixtures cannot enter the sample.
      const began = new Date(startedAt.getTime() + 2 * 86400_000)
      const now = new Date(began.getTime() + 3600_000)
      const expiresAt = new Date(began.getTime() + 29 * 86400_000)
      const episodes = Array.from({ length: 21 }, (_, index) => ({
        id: `sample-bound-${index.toString().padStart(2, "0")}`,
        mediaId: `sample-media-${index}`,
        sessionDigest: "d".repeat(64),
        state: "CLAIMED" as const,
        capabilityJti: `sample-bound-capability-${index}`,
        claimedAt: new Date(began.getTime() + index * 1000),
        activeUntil: new Date(began.getTime() + 4 * 3600_000),
        hardUntil: new Date(began.getTime() + 6 * 3600_000),
        createdAt: new Date(began.getTime() + index * 1000),
        expiresAt,
      }))
      await prisma.recommendationPlaybackEpisode.createMany({ data: episodes })
      await prisma.recommendationPlaybackFact.create({
        data: {
          episodeId: episodes[0].id,
          capabilityJti: episodes[0].capabilityJti,
          eventId: "sample-oldest-completion",
          payloadDigest: "e".repeat(64),
          sequence: 1,
          kind: "playback_end",
          payload: {
            reason: "ended",
            positionSeconds: 120,
            durationSeconds: 120,
            progress: 1,
            completed: true,
          },
          occurredAt: new Date(began.getTime() + 500),
          receivedAt: new Date(began.getTime() + 500),
          expiresAt,
        },
      })
      const oldest = await loadPlaybackEpisodeDetail(prisma, {
        episodeId: episodes[0].id,
        actorDigest: "f".repeat(64),
        now,
      })
      expect(oldest?.observations.departure.classification).toBe("completion")

      const overview = await loadPlaybackEvidenceOverview(prisma, {
        window: "24h",
        now,
      })

      expect(overview.counts.episodes).toBe(21)
      expect(overview.recent.map((episode) => episode.id)).toEqual(
        episodes
          .slice(1)
          .reverse()
          .map((episode) => episode.id),
      )
      expect(overview.observationSample.size).toBe(20)
      expect(overview.observationSample.classificationCounts).toEqual({
        insufficient_evidence: 20,
      })
      expect(
        overview.observationSample.classificationCounts,
      ).not.toHaveProperty("completion")
    })

    it("reconciles a full window beyond the latest-20 sample and excludes stale outcomes", async () => {
      const began = new Date(startedAt.getTime() + 4 * 86_400_000)
      const now = new Date(began.getTime() + 3_600_000)
      const expiresAt = new Date(began.getTime() + 29 * 86_400_000)
      const episodes = Array.from({ length: 21 }, (_, index) => ({
        id: `full-window-${index.toString().padStart(2, "0")}`,
        mediaId: `full-window-media-${index}`,
        sessionDigest: "d".repeat(64),
        state: index < 3 ? ("FINALIZED" as const) : ("CLAIMED" as const),
        capabilityJti: `full-window-capability-${index}`,
        claimedAt: new Date(began.getTime() + index * 1000),
        finalizedAt: index < 3 ? new Date(began.getTime() + 60_000) : null,
        nextFactSequence: index === 1 ? 6 : index < 3 ? 4 : 1,
        activeUntil: new Date(began.getTime() + 4 * 3_600_000),
        hardUntil: new Date(began.getTime() + 6 * 3_600_000),
        createdAt: new Date(began.getTime() + index * 1000),
        expiresAt,
      }))
      await prisma.recommendationPlaybackEpisode.createMany({ data: episodes })
      const payloads = [
        [
          { kind: "playback_attempt", payload: { initiation: "manual" } },
          {
            kind: "playback_observation",
            payload: {
              version: "playback-observations-v1",
              elapsedMilliseconds: 3000,
              visibility: "visible",
              playerState: "paused",
              startObserved: false,
              errorObserved: false,
              seekCount: 0,
              navigationCount: 0,
              qoeCount: 0,
            },
          },
          {
            kind: "playback_end",
            payload: { reason: "route_exit", completed: false },
          },
        ],
        [
          { kind: "playback_attempt", payload: { initiation: "manual" } },
          {
            kind: "playback_navigation",
            payload: {
              action: "manual_skip",
              cause: "user",
              positionSeconds: 0,
            },
          },
          {
            kind: "playback_qoe",
            payload: {
              action: "startup_timeout",
              cause: "unknown",
              positionSeconds: 0,
            },
          },
          {
            kind: "playback_observation",
            payload: {
              version: "playback-observations-v2",
              elapsedMilliseconds: 3000,
              visibility: "visible",
              playerState: "paused",
              startObserved: false,
              errorObserved: false,
              seekCount: 0,
              navigationCount: 1,
              qoeCount: 1,
              deviceClass: "mobile",
              networkClass: "3g",
            },
          },
          {
            kind: "playback_end",
            payload: { reason: "route_exit", completed: false },
          },
        ],
        [
          { kind: "playback_attempt", payload: { initiation: "manual" } },
          {
            kind: "playback_observation",
            payload: {
              version: "playback-observations-v2",
              elapsedMilliseconds: 3000,
              visibility: "visible",
              playerState: "paused",
              startObserved: false,
              errorObserved: false,
              seekCount: 0,
              navigationCount: 1,
              qoeCount: 0,
              deviceClass: "unknown",
              networkClass: "unknown",
            },
          },
          {
            kind: "playback_end",
            payload: { reason: "route_exit", completed: false },
          },
        ],
      ] as const
      await prisma.recommendationPlaybackFact.createMany({
        data: payloads.flatMap((items, index) =>
          items.map((item, offset) => ({
            episodeId: episodes[index]!.id,
            capabilityJti: episodes[index]!.capabilityJti,
            eventId: `full-window-${index}-${offset}`,
            payloadDigest: `${index + 1}${offset + 1}`.padStart(64, "0"),
            sequence: offset + 1,
            kind: item.kind,
            payload: item.payload,
            occurredAt: new Date(began.getTime() + 1000 * (offset + 1)),
            receivedAt: new Date(began.getTime() + 1000 * (offset + 1)),
            expiresAt,
          })),
        ),
      })
      await prisma.recommendationOutcomeRevision.createMany({
        data: [0, 1, 2].map((index) => ({
          id: `full-window-outcome-${index}`,
          episodeId: episodes[index]!.id,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: index === 1 ? 5 : index === 2 ? 2 : 3,
          inputDigest: `${index + 1}`.repeat(64),
          revision: 1,
          qualifiedView: false,
          viewQualityWeight: 0,
          viewQualityWeightReason:
            "active_time_against_30_seconds_without_duration",
          activePlaybackMilliseconds: 0,
          durationCohort: "unknown",
          activeCoverage: "missing",
          generation: 1,
          expiresAt,
        })),
      })
      expect(await refreshPlaybackObservationSnapshots(prisma, now)).toEqual({
        refreshed: ["24h", "7d", "29d"],
        failed: [],
      })
      const overview = await loadPlaybackEvidenceOverview(prisma, { now })
      expect(overview.observationSample.size).toBe(20)
      expect(overview.observationSample.navigationObserved).toBe(1)
      expect(overview.observationWindow).toMatchObject({
        episodes: 21,
        attempts: 3,
        finalized: 3,
        outcomes: 2,
        navigation: {
          observed: 2,
          v2Observed: 1,
          legacyObserved: 1,
          partial: 1,
          missing: 18,
          manualSkips: 1,
        },
        qoe: { observed: 3, v2Observed: 2, legacyObserved: 1 },
      })
      const timedOutAggregate = {
        $queryRaw: prisma.$queryRaw.bind(prisma),
        playbackProxyEvaluation: prisma.playbackProxyEvaluation,
        recommendationPlaybackEpisode: prisma.recommendationPlaybackEpisode,
        recommendationPlaybackSignalReadiness:
          prisma.recommendationPlaybackSignalReadiness,
        recommendationPlaybackObservationSnapshot: {
          findUnique: vi
            .fn()
            .mockRejectedValue(new Error("snapshot read timeout")),
        },
      } as unknown as PrismaClient
      const degraded = await loadPlaybackEvidenceOverview(timedOutAggregate, {
        now,
      })
      expect(degraded.counts.episodes).toBe(21)
      expect(degraded.observationWindow).toBeNull()
      expect(degraded.observationSample.size).toBe(20)
      const olderFailedRefresh = {
        $transaction: vi.fn().mockRejectedValue(new Error("late failure")),
        recommendationPlaybackObservationSnapshot:
          prisma.recommendationPlaybackObservationSnapshot,
      } as unknown as PrismaClient
      expect(
        await refreshPlaybackObservationSnapshots(
          olderFailedRefresh,
          new Date(now.getTime() - 1_000),
        ),
      ).toEqual({ refreshed: [], failed: ["24h", "7d", "29d"] })
      const lastSuccess =
        await prisma.recommendationPlaybackObservationSnapshot.findUniqueOrThrow(
          {
            where: { preset: "24h" },
          },
        )
      expect(lastSuccess.computedAt).toEqual(now)
      expect(lastSuccess.lastErrorCode).toBeNull()
    })
  },
)

// Keep the shared Admin hydration regression in CI's existing Watch database entry point.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "duration loader with real PostgreSQL result cardinality",
  () => {
    const schema = `duration_${randomUUID().replaceAll("-", "")}`
    const sql = new Client({ connectionString: env.DATABASE_URL })
    const queries: Prisma.QueryEvent[] = []
    const prisma = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: env.DATABASE_URL,
          max: 10,
          options: `-c search_path=${schema}`,
        },
        { schema },
      ),
      log: [{ emit: "event", level: "query" }],
    })

    beforeAll(async () => {
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(env.DATABASE_URL).hostname,
        )
      ) {
        throw new Error("This isolated fixture requires local Postgres")
      }
      await sql.connect()
      await sql.query(`CREATE SCHEMA "${schema}"`)
      await sql.query(`SET search_path TO "${schema}"`)
      await sql.query(`
        CREATE TABLE video (id text PRIMARY KEY, primary_language_id text, deleted_at timestamp);
        CREATE TABLE video_dub (
          id text PRIMARY KEY, video_id text NOT NULL, language_id text,
          duration integer, hls text, published boolean, deleted_at timestamp
        );
        CREATE INDEX ON video_dub(video_id);
        CREATE INDEX ON video_dub(video_id,duration DESC,id ASC)
          WHERE deleted_at IS NULL AND published=true AND hls IS NOT NULL;
        INSERT INTO video(id, primary_language_id) VALUES
          ('primary', 'en'), ('outside-five', 'en'), ('fallback', 'missing'),
          ('empty-hls', NULL), ('unplayable', NULL), ('empty', NULL), ('empty-primary', '');
        INSERT INTO video VALUES ('deleted', 'en', now());
        INSERT INTO video_dub
          SELECT v.id || '-' || n, v.id, CASE WHEN n=2 THEN 'en' ELSE 'es' END,
            100-n, 'stream', true, NULL
          FROM video v CROSS JOIN generate_series(1,8) n
          WHERE v.id IN ('primary','fallback','deleted');
        INSERT INTO video_dub
          SELECT 'outside-' || n, 'outside-five', CASE WHEN n=6 THEN 'en' ELSE 'es' END,
            100-n, 'stream', true, NULL FROM generate_series(1,8) n;
        INSERT INTO video_dub VALUES
          ('empty-primary-long', 'empty-primary', 'es', 20, 'stream', true, NULL),
          ('empty-primary-short', 'empty-primary', '', 10, 'stream', true, NULL),
          ('blank', 'empty-hls', NULL, 10, '', true, NULL),
          ('zero', 'unplayable', NULL, 0, 'stream', true, NULL),
          ('negative', 'unplayable', NULL, -1, 'stream', true, NULL),
          ('null-duration', 'unplayable', NULL, NULL, 'stream', true, NULL),
          ('no-hls', 'unplayable', NULL, 100, NULL, true, NULL),
          ('unpublished', 'unplayable', NULL, 100, 'stream', false, NULL),
          ('withdrawn', 'unplayable', NULL, 100, 'stream', true, now());
        INSERT INTO video(id) SELECT 'large-' || n FROM generate_series(1,216) n;
        INSERT INTO video_dub
          SELECT v.id || '-' || n, v.id, 'language-' || n, 1000-n, 'stream', true, NULL
          FROM video v CROSS JOIN generate_series(1,662) n WHERE v.id LIKE 'large-%';
        ANALYZE video; ANALYZE video_dub;
      `)
      prisma.$on("query", (event) => queries.push(event))
    })

    afterAll(async () => {
      await prisma.$disconnect()
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await sql.end()
    })

    it("preserves primary-within-five, fallback, visibility, null and HLS semantics", async () => {
      const result = await createLoaders(
        prisma,
      ).videoPrimaryDubDurationById.loadMany([
        "fallback",
        "primary",
        "outside-five",
        "empty-hls",
        "empty-primary",
        "unplayable",
        "empty",
        "deleted",
        "missing",
        "primary",
      ])
      expect(result).toEqual([99, 98, 99, 10, 20, null, null, null, null, 98])
    })

    it("bounds database rows independently of the full dubbed catalog", async () => {
      queries.length = 0
      const ids = Array.from(
        { length: 216 },
        (_, index) => `large-${index + 1}`,
      )
      const result =
        await createLoaders(prisma).videoPrimaryDubDurationById.loadMany(ids)
      expect(result).toEqual(ids.map(() => 999))
      // Re-execute the emitted, parameterized SELECTs to inspect wire cardinality.
      // Mocking findMany cannot catch Prisma trimming nested take in JavaScript.
      const reads = queries.filter((query) => /SELECT/i.test(query.query))
      expect(reads.length).toBeGreaterThan(0)
      let transferredRows = 0
      for (const query of reads) {
        transferredRows +=
          (await sql.query(query.query, JSON.parse(query.params))).rowCount ?? 0
      }
      expect(transferredRows).toBeLessThanOrEqual(ids.length * 6)
    })
  },
)

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "Watch catalog image metadata with the production PostgreSQL adapter",
  () => {
    const schema = `watch_mux_${randomUUID().replaceAll("-", "")}`
    let db: Client
    let prisma: PrismaClient
    const videos = Array.from({ length: 192 }, (_, i) => ({
      muxVideoId: `mux-${i + 1}`,
      playbackId: `playback-${i + 1}`,
    }))

    beforeAll(async () => {
      db = new Client({ connectionString: env.DATABASE_URL })
      await db.connect()
      await db.query(`CREATE SCHEMA "${schema}";
        CREATE TABLE "${schema}".mux_image_derivative (
          id text PRIMARY KEY, mux_video_id text NOT NULL, purpose text NOT NULL,
          params_hash text NOT NULL, params jsonb NOT NULL DEFAULT '{}',
          source_url text NOT NULL, lqip_url text NOT NULL,
          blur_data_url text NOT NULL, dominant_color text,
          generated_at timestamp NOT NULL DEFAULT now(),
          created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL,
          UNIQUE(mux_video_id, purpose, params_hash)
        )`)
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          { connectionString: env.DATABASE_URL, max: 10 },
          { schema },
        ),
      })
      const bytes = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#336699"/></svg>',
      )
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(bytes, {
              headers: { "content-type": "image/svg+xml" },
            }),
        ),
      )
      for (const generate of [
        getOrCreateWatchChapterCarouselMuxBlurDataUrl,
        getOrCreateWatchHeroPosterMuxBlurDataUrl,
      ]) {
        await generate({ prisma, muxVideoId: "seed", playbackId: "seed" })
      }
      await db.query(`INSERT INTO "${schema}".mux_image_derivative
        SELECT 'fixture-' || n || purpose, 'mux-' || n, purpose, params_hash,
          params, source_url, lqip_url, purpose || '-blur-' || n,
          CASE WHEN purpose = 'watch-hero-poster' THEN '#123456' ELSE '#abcdef' END,
          generated_at, created_at, updated_at
        FROM "${schema}".mux_image_derivative CROSS JOIN generate_series(1,192) n
        WHERE mux_video_id = 'seed'`)
      // A stale recipe must not displace the current recipe for the same video.
      await db.query(`INSERT INTO "${schema}".mux_image_derivative
        SELECT id || '-stale', mux_video_id, purpose, 'stale', params, source_url,
          lqip_url, 'wrong-blur', '#000000', generated_at, created_at, updated_at
        FROM "${schema}".mux_image_derivative WHERE mux_video_id = 'mux-1'`)
      vi.mocked(fetch).mockImplementation(async () => {
        throw new Error("A complete cached catalog must not fetch images")
      })
    })

    afterAll(async () => {
      vi.unstubAllGlobals()
      await prisma?.$disconnect()
      if (db) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await db.end()
      }
    })

    it("matches all four existing fields for 192 videos with one Prisma operation", async () => {
      const expected = new Map(
        await Promise.all(
          videos.map(async (video) => {
            const args = { prisma, ...video }
            const [chapterBlur, chapterColor, heroBlur, heroColor] =
              await Promise.all([
                getOrScheduleWatchChapterCarouselMuxBlurDataUrl(args),
                getOrScheduleWatchChapterCarouselMuxDominantColor(args),
                getOrScheduleWatchHeroPosterMuxBlurDataUrl(args),
                getOrScheduleWatchHeroPosterMuxDominantColor(args),
              ])
            return [
              video.muxVideoId,
              {
                muxThumbnailBlurDataUrl: chapterBlur,
                muxThumbnailDominantColor: chapterColor,
                muxHeroPosterBlurDataUrl: heroBlur,
                muxHeroPosterDominantColor: heroColor,
              },
            ] as const
          }),
        ),
      )
      const operations: string[] = []
      const observed = prisma.$extends({
        query: {
          muxImageDerivative: {
            async $allOperations({ operation, args, query }) {
              operations.push(operation)
              return query(args)
            },
          },
        },
      }) as unknown as PrismaClient
      const actual = await getOrScheduleWatchMuxImageMetadata({
        prisma: observed,
        videos: [...videos, videos[0]!],
      })
      expect(actual).toEqual(expected)
      expect(actual.size).toBe(192)
      expect(actual.get("mux-1")).toEqual({
        muxThumbnailBlurDataUrl: "watch-chapter-carousel-blur-1",
        muxThumbnailDominantColor: "#abcdef",
        muxHeroPosterBlurDataUrl: "watch-hero-poster-blur-1",
        muxHeroPosterDominantColor: "#123456",
      })
      expect(operations).toEqual(["findMany"])
    })
  },
)

// Keep the Mux loader regression in the existing Watch PostgreSQL CI entry point.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "Mux playback loader with the production PostgreSQL adapter",
  () => {
    const schema = `mux_playback_${randomUUID().replaceAll("-", "")}`
    const sql = new Client({ connectionString: env.DATABASE_URL })
    const queries: Prisma.QueryEvent[] = []
    const prisma = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: env.DATABASE_URL,
          max: 10,
          options: `-c search_path=${schema}`,
        },
        { schema },
      ),
      log: [{ emit: "event", level: "query" }],
    })

    beforeAll(async () => {
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(env.DATABASE_URL).hostname,
        )
      ) {
        throw new Error("This isolated fixture requires local Postgres")
      }
      await sql.connect()
      await sql.query(`CREATE SCHEMA "${schema}"`)
      await sql.query(`SET search_path TO "${schema}"`)
      await sql.query(`
        CREATE TABLE video (id text PRIMARY KEY, primary_language_id text, deleted_at timestamp);
        CREATE TABLE language (id text PRIMARY KEY, slug text, deleted_at timestamp);
        CREATE TABLE mux_video (id text PRIMARY KEY, playback_id text, deleted_at timestamp);
        CREATE TABLE video_dub (
          id text PRIMARY KEY, video_id text NOT NULL, language_id text,
          mux_video_id text, duration integer, hls text, published boolean, deleted_at timestamp
        );
        CREATE INDEX ON video_dub(video_id);
        CREATE INDEX ON video_dub(video_id,duration DESC,id ASC)
          WHERE deleted_at IS NULL AND published=true AND hls IS NOT NULL;
        INSERT INTO language VALUES ('en','english',NULL),('es','spanish',NULL),('withdrawn','withdrawn',now());
        INSERT INTO video(id,primary_language_id) VALUES
          ('primary','en'),('outside-five','en'),('fallback','missing'),
          ('empty-primary',''),('null-duration',NULL),('null-language','en'),('tie',NULL),
          ('visibility',NULL),('empty',NULL),('empty-playback',NULL),('deleted','en');
        UPDATE video SET deleted_at=now() WHERE id='deleted';
        INSERT INTO video_dub
          SELECT v.id||'-'||n,v.id,CASE WHEN n=2 THEN 'en' ELSE 'es' END,
            v.id||'-'||n,100-n,'stream',true,NULL
          FROM video v CROSS JOIN generate_series(1,8) n
          WHERE v.id IN ('primary','fallback','deleted');
        INSERT INTO video_dub
          SELECT 'outside-'||n,'outside-five',CASE WHEN n=6 THEN 'en' ELSE 'es' END,
            'outside-'||n,100-n,'stream',true,NULL FROM generate_series(1,8) n;
        INSERT INTO video_dub VALUES
          ('empty-primary-long','empty-primary','es','empty-primary-long',20,'stream',true,NULL),
          ('empty-primary-short','empty-primary','','empty-primary-short',10,'stream',true,NULL),
          ('null-duration-first','null-duration',NULL,'null-duration-first',NULL,'stream',true,NULL),
          ('null-duration-second','null-duration',NULL,'null-duration-second',100,'stream',true,NULL),
          ('null-language-first','null-language',NULL,'null-language-first',100,'stream',true,NULL),
          ('null-language-second','null-language','es','null-language-second',90,'stream',true,NULL),
          ('tie-b','tie',NULL,'tie-b',10,'stream',true,NULL),
          ('tie-a','tie',NULL,'tie-a',10,'stream',true,NULL),
          ('no-hls','visibility',NULL,'no-hls',999,NULL,true,NULL),
          ('unpublished','visibility',NULL,'unpublished',998,'stream',false,NULL),
          ('withdrawn-dub','visibility',NULL,'withdrawn-dub',997,'stream',true,now()),
          ('withdrawn-mux','visibility',NULL,'withdrawn-mux',996,'stream',true,NULL),
          ('null-playback','visibility',NULL,'null-playback',995,'stream',true,NULL),
          ('missing-mux','visibility',NULL,NULL,994,'stream',true,NULL),
          ('blank-hls','visibility',NULL,'blank-hls',-1,'',true,NULL),
          ('empty-playback','empty-playback',NULL,'empty-playback',0,'stream',true,NULL);
        INSERT INTO mux_video SELECT mux_video_id,'playback-'||id,NULL FROM video_dub WHERE mux_video_id IS NOT NULL;
        UPDATE mux_video SET deleted_at=now() WHERE id='withdrawn-mux';
        UPDATE mux_video SET playback_id=NULL WHERE id='null-playback';
        UPDATE mux_video SET playback_id='' WHERE id='empty-playback';
        INSERT INTO video(id) SELECT 'large-'||n FROM generate_series(1,206) n;
        INSERT INTO video_dub
          SELECT v.id||'-'||n,v.id,'language-'||n,v.id||'-'||n,1000-n,'stream',true,NULL
          FROM video v CROSS JOIN generate_series(1,662) n WHERE v.id LIKE 'large-%';
        INSERT INTO mux_video SELECT id,'playback-'||id,NULL FROM video_dub WHERE video_id LIKE 'large-%';
        ANALYZE video; ANALYZE video_dub; ANALYZE mux_video;
      `)
      prisma.$on("query", (event) => queries.push(event))
    })

    afterAll(async () => {
      await prisma.$disconnect()
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await sql.end()
    })

    it("preserves primary-within-five, ordering, nulls and visibility", async () => {
      const ids = [
        "primary",
        "outside-five",
        "fallback",
        "empty-primary",
        "null-duration",
        "null-language",
        "tie",
        "visibility",
        "empty",
        "empty-playback",
        "deleted",
        "missing",
        "primary",
      ]
      const result = await createLoaders(
        prisma,
      ).videoMuxPlaybackIdByIdAndLanguageSlug.loadMany(
        ids.map((videoId) => ({ videoId, languageSlug: null })),
      )
      expect(result).toEqual([
        "playback-primary-2",
        "playback-outside-1",
        "playback-fallback-1",
        "playback-empty-primary-long",
        "playback-null-duration-first",
        "playback-null-language-first",
        "playback-tie-a",
        "playback-blank-hls",
        null,
        "",
        null,
        null,
        "playback-primary-2",
      ])
    })

    it("preserves requested language preference and fallback in the same batch", async () => {
      const result = await createLoaders(
        prisma,
      ).videoMuxPlaybackIdByIdAndLanguageSlug.loadMany([
        { videoId: "primary", languageSlug: "spanish" },
        { videoId: "primary", languageSlug: "missing" },
        { videoId: "outside-five", languageSlug: "english" },
        { videoId: "missing", languageSlug: "english" },
      ])
      expect(result).toEqual([
        "playback-primary-1",
        "playback-primary-2",
        "playback-outside-6",
        null,
      ])
    })

    it("bounds transferred rows independently of the number of dubs", async () => {
      queries.length = 0
      const ids = Array.from(
        { length: 206 },
        (_, index) => `large-${index + 1}`,
      )
      const result = await createLoaders(
        prisma,
      ).videoMuxPlaybackIdByIdAndLanguageSlug.loadMany(
        ids.map((videoId) => ({ videoId, languageSlug: null })),
      )
      expect(result).toEqual(ids.map((id) => `playback-${id}-1`))
      const reads = queries.filter((query) => /SELECT/i.test(query.query))
      expect(reads.length).toBeGreaterThan(0)
      let transferredRows = 0
      for (const query of reads) {
        transferredRows +=
          (await sql.query(query.query, JSON.parse(query.params))).rowCount ?? 0
      }
      // Prisma's nested take used to transfer the complete dubbed catalog.
      // Assert real wire cardinality, not the already-trimmed ORM result.
      expect(transferredRows).toBeLessThanOrEqual(ids.length * 6)
    })
  },
)

describe.skipIf(!RUN_REAL_DB_TEST)(
  "submission budget timing against PostgreSQL",
  () => {
    const schema = `budget_timing_${Date.now()}_${randomUUID().replaceAll("-", "")}`
    const expiresAt = new Date(Date.now() + 86_400_000)
    let client: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET search_path TO "${schema}", public`)
      for (const migration of recommendationMigrations)
        await client.query(migration)
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: env.DATABASE_URL,
            options: `-c search_path=${schema},public`,
            max: 2,
          },
          { schema },
        ),
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    })

    async function deliveryInput() {
      const requestId = randomUUID()
      const capabilityJti = randomUUID()
      await client.query("BEGIN")
      try {
        await client.query(
          `INSERT INTO recommendation_request (
      id, contract_version, surface_version, manifest_id, strategy_version,
      classifier_version, session_digest, locale, expected_item_count, result, expires_at, seed_media_id
    ) VALUES ($1, 'semantic-recommendation-v1', 'watch-below-player-v1',
      'semantic-transcript-pgvector-v1', 'semantic-transcript-pgvector-v1',
      'legacy-position-v0', $2, 'en', 1, 'served', $3, 'budget-timing-seed')`,
          [requestId, "a".repeat(64), expiresAt],
        )
        await client.query(
          `INSERT INTO recommendation_served_item (
      id, request_id, position, target_media_id, canonical_href,
      candidate_generator, candidate_provenance, expires_at, capability_jti
    ) VALUES ($1, $2, 0, 'budget-timing-video', '/watch/budget-timing-video',
      'semantic', '{}'::jsonb, $3, $4)`,
          [randomUUID(), requestId, expiresAt, capabilityJti],
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
      return { requestId, capabilityJti, expiresAt, attempts: 1 }
    }

    it("executes consumption once, retains the concurrent limit, and commits before a later rollback", async () => {
      const input = await deliveryInput()
      const results = await Promise.allSettled([
        consumeDeliveryCapabilitySubmissions(prisma, {
          ...input,
          attempts: 24,
        }),
        consumeDeliveryCapabilitySubmissions(prisma, {
          ...input,
          attempts: 24,
        }),
      ])
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1)
      await consumeDeliveryCapabilitySubmissions(prisma, {
        ...input,
        attempts: 8,
      })
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1`
          throw new Error("later mutation rolled back")
        }),
      ).rejects.toThrow("later mutation rolled back")
      await expect(
        consumeDeliveryCapabilitySubmissions(prisma, input),
      ).rejects.toThrow("submission budget is exhausted")
      expect(
        (
          await client.query(
            `SELECT attempts FROM recommendation_capability_submission_budget WHERE capability_jti=$1`,
            [input.capabilityJti],
          )
        ).rows,
      ).toEqual([{ attempts: 32 }])
      expect(
        (
          await client.query(
            `SELECT count FROM recommendation_evidence_audit WHERE request_id=$1 AND reason_code='delivery_submission_budget_exceeded'`,
            [input.requestId],
          )
        ).rows,
      ).toEqual([{ count: 25 }])
    })

    it("brackets server work and distinguishes a later client delay", async () => {
      const input = await deliveryInput()
      const log = vi.spyOn(console, "info").mockImplementation(() => {})
      try {
        await client.query(
          `CREATE FUNCTION "${schema}".budget_timing_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.22); RETURN NEW; END $$`,
        )
        await client.query(
          `CREATE TRIGGER budget_timing_delay BEFORE INSERT ON recommendation_capability_submission_budget FOR EACH ROW EXECUTE FUNCTION "${schema}".budget_timing_delay()`,
        )
        try {
          await consumeDeliveryCapabilitySubmissions(prisma, input)
        } finally {
          await client.query(
            `DROP TRIGGER budget_timing_delay ON recommendation_capability_submission_budget`,
          )
          await client.query(`DROP FUNCTION "${schema}".budget_timing_delay()`)
        }
        const serverLog = log.mock.calls
          .flat()
          .map(String)
          .find((line) =>
            line.startsWith("event=recommendation.submission_budget "),
          )
        expect(serverLog).toBeDefined()
        expect(
          Number(serverLog?.match(/serverElapsedMs=(\d+)/)?.[1]),
        ).toBeGreaterThanOrEqual(200)
        expect(
          (
            await client.query(
              `SELECT attempts FROM recommendation_capability_submission_budget WHERE capability_jti=$1`,
              [input.capabilityJti],
            )
          ).rows,
        ).toEqual([{ attempts: 1 }])

        log.mockClear()
        const delayedDb = {
          $queryRaw: vi.fn().mockImplementation(async (sql: Prisma.Sql) => {
            const rows = await prisma.$queryRaw(sql)
            await new Promise((resolve) => setTimeout(resolve, 250))
            return rows
          }),
        }
        await consumeDeliveryCapabilitySubmissions(delayedDb, input)
        const clientLog = log.mock.calls
          .flat()
          .map(String)
          .find((line) =>
            line.startsWith("event=recommendation.submission_budget "),
          )
        expect(clientLog).toBeDefined()
        expect(
          Number(clientLog?.match(/outsideServerMs=(\d+)/)?.[1]),
        ).toBeGreaterThanOrEqual(200)
        expect(
          (
            await client.query(
              `SELECT attempts FROM recommendation_capability_submission_budget WHERE capability_jti=$1`,
              [input.capabilityJti],
            )
          ).rows,
        ).toEqual([{ attempts: 2 }])
      } finally {
        log.mockRestore()
      }
    })

    it("retains standalone episode consumption and the 256-attempt bound", async () => {
      const id = randomUUID()
      const capabilityJti = randomUUID()
      const now = new Date()
      await client.query(
        `INSERT INTO recommendation_playback_episode (
      id, media_id, session_digest, state, capability_jti, signing_kid,
      active_until, hard_until, generation, claimed_at, expires_at
    ) VALUES ($1, 'budget-timing-video', $2, 'claimed', $3, 'budget-timing-test',
      $4, $5, 1, $6, $7)`,
        [
          id,
          "b".repeat(64),
          capabilityJti,
          new Date(now.getTime() + 900_000),
          new Date(now.getTime() + 1_800_000),
          now,
          expiresAt,
        ],
      )
      const input = {
        requestId: null,
        episodeId: id,
        capabilityJti,
        expiresAt,
        attempts: 128,
      }
      await consumeEpisodeCapabilitySubmissions(prisma, input)
      await consumeEpisodeCapabilitySubmissions(prisma, input)
      await expect(
        consumeEpisodeCapabilitySubmissions(prisma, { ...input, attempts: 3 }),
      ).rejects.toThrow("playback submission budget is exhausted")
      expect(
        (
          await client.query(
            `SELECT attempts FROM recommendation_capability_submission_budget WHERE capability_jti=$1`,
            [capabilityJti],
          )
        ).rows,
      ).toEqual([{ attempts: 256 }])
      expect(
        (
          await client.query(
            `SELECT count FROM recommendation_evidence_audit WHERE id=$1`,
            [`episode-submission-budget:${capabilityJti}`],
          )
        ).rows,
        // Standalone episodes do not invent a request-owned rejection audit.
      ).toEqual([])
    })
  },
)
