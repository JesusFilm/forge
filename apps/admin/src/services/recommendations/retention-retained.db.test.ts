import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  purgeExpiredRecommendationRequests,
  readRecommendationRetentionHealth,
} from "./retention.service"

/** Exercises the ordinary service against retained roots after behavioral retirement. */
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "retained recommendation expiry on PostgreSQL",
  () => {
    let db: PrismaClient
    const id = randomUUID()
    const manifestId = `retained-expiry-${id}`
    const requestId = `retained-request-${id}`
    const itemId = `retained-item-${id}`
    const episodeId = `retained-episode-${id}`
    const viewerDigest = "a".repeat(32) + id.replaceAll("-", "")
    const watchExpiredId = `retained-watch-expired-${id}`
    const watchFutureId = `retained-watch-future-${id}`
    const experimentId = `retained-experiment-${id}`
    const assignmentId = `retained-assignment-${id}`
    const traceId = `retained-trace-${id}`
    const extraRequestIds: string[] = []
    const extraEpisodeIds: string[] = []
    const extraWatchIds: string[] = []

    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_test database required")
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
      })
    })

    afterAll(async () => {
      if (!db) return
      await db.recommendationRequest.deleteMany({ where: { id: requestId } })
      await db.recommendationRequest.deleteMany({
        where: { id: { in: extraRequestIds } },
      })
      await db.recommendationExperiment.deleteMany({
        where: { id: experimentId },
      })
      await db.recommendationPlaybackEpisode.deleteMany({
        where: { id: episodeId },
      })
      await db.recommendationPlaybackEpisode.deleteMany({
        where: { id: { in: extraEpisodeIds } },
      })
      await db.watchSurfaceExposure.deleteMany({
        where: { id: { in: [watchExpiredId, watchFutureId] } },
      })
      await db.watchSurfaceExposure.deleteMany({
        where: { id: { in: extraWatchIds } },
      })
      await db.recommendationTraceAccessAudit.deleteMany({
        where: { id: traceId },
      })
      await db.recommendationViewer.deleteMany({
        where: { tokenDigest: viewerDigest },
      })
      await db.$disconnect()
    })

    it("deletes stored-expired request descendants, Watch facts, viewer and experiment roots with truthful ledger counts", async () => {
      const now = new Date()
      const expired = new Date(now.getTime() - 36 * 60 * 60_000)
      const future = new Date(now.getTime() + 24 * 60 * 60_000)
      await db.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: manifestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 6,
        },
      })
      await db.recommendationViewer.create({
        data: {
          tokenDigest: viewerDigest,
          consentReceiptDigest: "b".repeat(64),
          expiresAt: expired,
        },
      })
      await db.recommendationExperiment.create({
        data: {
          id: experimentId,
          experimentVersion: experimentId,
          surfaceVersion: "watch-below-player-v1",
          controlManifestId: manifestId,
          challengerManifestId: manifestId,
          assignmentPolicyVersion: "semantic-aa-v1",
          outcomePolicyVersion: "fixture-v1",
          integrityPolicyVersion: "fixture-v1",
          evaluationPolicyVersion: "fixture-v1",
          configurationDigest: "c".repeat(64),
          challengerProbability: 0.5,
          state: "CLOSED",
          startsAt: new Date(expired.getTime() - 2 * 60 * 60_000),
          endsAt: new Date(expired.getTime() - 60 * 60_000),
          expiresAt: expired,
        },
      })
      await db.recommendationExperimentAssignment.create({
        data: {
          id: assignmentId,
          experimentId,
          unitKind: "ANONYMOUS_SESSION",
          unitDigest: "d".repeat(64),
          arm: "CONTROL",
          assignmentProbability: 0.5,
          configurationDigest: "c".repeat(64),
          assignedAt: expired,
          expiresAt: expired,
        },
      })
      await db.$transaction(async (tx) => {
        await tx.recommendationRequest.create({
          data: {
            id: requestId,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId,
            strategyVersion: manifestId,
            classifierVersion: "active-watch-proxy-v1",
            sessionDigest: "e".repeat(64),
            seedMediaId: "fixture-seed",
            locale: "en",
            expectedItemCount: 1,
            state: "ISSUED",
            result: "SERVED",
            issuedAt: expired,
            signingKid: "fixture",
            deliveryJti: `retained-jti-${id}`,
            createdAt: new Date(expired.getTime() - 60_000),
            expiresAt: expired,
          },
        })
        await tx.recommendationServedItem.create({
          data: {
            id: itemId,
            requestId,
            position: 0,
            targetMediaId: "fixture-video",
            canonicalHref: "/watch/fixture-video",
            candidateGenerator: "semantic",
            candidateProvenance: {},
            createdAt: expired,
            expiresAt: expired,
          },
        })
      })
      await db.recommendationTraceAccessAudit.create({
        data: {
          id: traceId,
          requestId,
          actorDigest: "f".repeat(64),
          reasonCode: "fixture",
          accessedAt: expired,
          expiresAt: future,
        },
      })
      await db.recommendationPlaybackEpisode.create({
        data: {
          id: episodeId,
          mediaId: "fixture-video",
          discoverySource: "direct",
          state: "FINALIZED",
          finalizedAt: new Date(expired.getTime() - 30_000),
          sessionDigest: "e".repeat(64),
          activeUntil: new Date(expired.getTime() - 2 * 60_000),
          hardUntil: new Date(expired.getTime() - 60_000),
          createdAt: new Date(expired.getTime() - 3 * 60_000),
          expiresAt: expired,
        },
      })
      const watchData = (watchId: string, expiresAt: Date) => ({
        id: watchId,
        eventId: randomUUID(),
        windowId: randomUUID(),
        surface: "watch",
        block: "below",
        presentation: "cards",
        placement: "fixture",
        policyVersion: "fixture-v1",
        position: 0,
        itemPath: "/watch/fixture-video",
        kind: "eligible",
        occurredAt: expired,
        receivedAt: expired,
        expiresAt,
      })
      await db.watchSurfaceExposure.createMany({
        data: [
          watchData(watchExpiredId, expired),
          watchData(watchFutureId, future),
        ],
      })

      const result = await purgeExpiredRecommendationRequests(
        db,
        now,
        100,
        "scheduled",
      )
      expect(result.status).toBe("succeeded")
      expect(result.rootsDeleted).toBeGreaterThanOrEqual(1)
      expect(
        result.rowCounts.expiredWatchSurfaceExposures,
      ).toBeGreaterThanOrEqual(1)
      expect(
        result.rowCounts.expiredExperimentAssignments,
      ).toBeGreaterThanOrEqual(1)
      expect(result.rowCounts.expiredExperiments).toBeGreaterThanOrEqual(1)
      expect(
        await db.recommendationRequest.count({ where: { id: requestId } }),
      ).toBe(0)
      expect(result.rowCounts.traceAccessLinksCleared).toBeGreaterThanOrEqual(1)
      expect(
        await db.recommendationTraceAccessAudit.findUniqueOrThrow({
          where: { id: traceId },
        }),
      ).toMatchObject({ requestId: null })
      expect(
        await db.recommendationServedItem.count({ where: { id: itemId } }),
      ).toBe(0)
      expect(
        await db.recommendationPlaybackEpisode.count({
          where: { id: episodeId },
        }),
      ).toBe(0)
      expect(
        await db.recommendationViewer.count({
          where: { tokenDigest: viewerDigest },
        }),
      ).toBe(0)
      expect(
        await db.watchSurfaceExposure.count({ where: { id: watchExpiredId } }),
      ).toBe(0)
      expect(
        await db.watchSurfaceExposure.count({ where: { id: watchFutureId } }),
      ).toBe(1)
      expect(
        await db.recommendationExperiment.count({
          where: { id: experimentId },
        }),
      ).toBe(0)
      const ledger = await db.recommendationRetentionRun.findUniqueOrThrow({
        where: { id: result.runId },
      })
      expect(ledger.status).toBe("SUCCEEDED")
      expect(ledger.rootsDeleted).toBe(result.rootsDeleted)
      expect(ledger.rowCounts).toEqual(result.rowCounts)
      expect(
        (await readRecommendationRetentionHealth(db, now)).latestSuccessAt,
      ).toBeTruthy()
    }, 60_000)

    it("keeps a lock skip durable and leaves an expired request for the next pass", async () => {
      const now = new Date()
      const expired = new Date(now.getTime() - 86_400_000)
      const lockedRequestId = `retained-locked-${randomUUID()}`
      extraRequestIds.push(lockedRequestId)
      await db.recommendationRequest.create({
        data: {
          id: lockedRequestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId,
          strategyVersion: manifestId,
          classifierVersion: "active-watch-proxy-v1",
          sessionDigest: "f".repeat(64),
          seedMediaId: "fixture-seed",
          locale: "en",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          signingKid: "fixture",
          deliveryJti: `${lockedRequestId}-delivery`,
          createdAt: new Date(expired.getTime() - 60_000),
          issuedAt: new Date(expired.getTime() - 60_000),
          expiresAt: expired,
        },
      })
      const lock = new Client({ connectionString: env.DATABASE_URL })
      await lock.connect()
      try {
        await lock.query("SELECT pg_advisory_lock(368000001)")
        const result = await purgeExpiredRecommendationRequests(db, now, 1)
        expect(result).toMatchObject({ status: "skipped", rootsDeleted: 0 })
        expect(
          await db.recommendationRequest.count({
            where: { id: lockedRequestId },
          }),
        ).toBe(1)
        expect(
          await db.recommendationRetentionRun.findUniqueOrThrow({
            where: { id: result.runId },
          }),
        ).toMatchObject({
          status: "SKIPPED",
          reasonCode: "lock_not_acquired",
          rootsDeleted: 0,
        })
      } finally {
        await lock.query("SELECT pg_advisory_unlock(368000001)")
        await lock.end()
        await db.recommendationRequest.deleteMany({
          where: { id: lockedRequestId },
        })
      }
    }, 60_000)

    it("records failed standalone deletion with prior committed Watch counts and no success watermark", async () => {
      const now = new Date()
      const expired = new Date(now.getTime() - 86_400_000)
      const episodePrefix = randomUUID()
      const episodeIds = Array.from(
        { length: 5 },
        (_, index) => `retained-fail-${episodePrefix}-${index}`,
      )
      extraEpisodeIds.push(...episodeIds)
      const exposureId = `retained-fail-watch-${randomUUID()}`
      extraWatchIds.push(exposureId)
      await db.recommendationPlaybackEpisode.createMany({
        data: episodeIds.map((episodeId) => ({
          id: episodeId,
          mediaId: "fixture-video",
          sessionDigest: "b".repeat(64),
          state: "FINALIZED" as const,
          activeUntil: new Date(expired.getTime() - 120_000),
          hardUntil: new Date(expired.getTime() - 60_000),
          createdAt: new Date(expired.getTime() - 180_000),
          expiresAt: expired,
        })),
      })
      await db.watchSurfaceExposure.create({
        data: {
          id: exposureId,
          eventId: randomUUID(),
          windowId: randomUUID(),
          surface: "watch",
          block: "below",
          presentation: "cards",
          placement: "fixture",
          policyVersion: "fixture-v1",
          position: 0,
          itemPath: "/watch/fixture-video",
          kind: "eligible",
          occurredAt: expired,
          receivedAt: expired,
          expiresAt: expired,
        },
      })
      const priorSuccessAt = (await readRecommendationRetentionHealth(db, now))
        .latestSuccessAt
      await db.$executeRawUnsafe(`CREATE FUNCTION owned_retained_episode_failure() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF OLD.id = '${episodeIds[4]}' THEN RAISE EXCEPTION 'owned episode failure'; END IF;
          RETURN OLD;
        END $$`)
      await db.$executeRawUnsafe(`CREATE TRIGGER owned_retained_episode_failure
        BEFORE DELETE ON recommendation_playback_episode
        FOR EACH ROW EXECUTE FUNCTION owned_retained_episode_failure()`)
      try {
        await expect(
          purgeExpiredRecommendationRequests(db, now, 100),
        ).rejects.toThrow("owned episode failure")
        const failed = await db.recommendationRetentionRun.findFirstOrThrow({
          orderBy: { startedAt: "desc" },
        })
        expect(failed).toMatchObject({
          status: "FAILED",
          rootsDeleted: 0,
          rowCounts: {
            expiredWatchSurfaceExposures: 1,
            expiredStandaloneEpisodes: 4,
          },
        })
        expect(
          await db.recommendationPlaybackEpisode.count({
            where: { id: { in: episodeIds } },
          }),
        ).toBe(1)
        expect(
          await db.watchSurfaceExposure.count({ where: { id: exposureId } }),
        ).toBe(0)
        expect(
          (await readRecommendationRetentionHealth(db, now)).latestSuccessAt,
        ).toEqual(priorSuccessAt)
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER owned_retained_episode_failure ON recommendation_playback_episode`,
        )
        await db.$executeRawUnsafe(
          `DROP FUNCTION owned_retained_episode_failure()`,
        )
      }
    }, 60_000)

    it("yields after an acknowledged root commit without advancing the success watermark", async () => {
      const now = new Date()
      const expired = new Date(now.getTime() - 86_400_000)
      const yieldedRequestId = `retained-yield-${randomUUID()}`
      extraRequestIds.push(yieldedRequestId)
      await db.recommendationRequest.create({
        data: {
          id: yieldedRequestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId,
          strategyVersion: manifestId,
          classifierVersion: "active-watch-proxy-v1",
          sessionDigest: "c".repeat(64),
          seedMediaId: "fixture-seed",
          locale: "en",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          signingKid: "fixture",
          deliveryJti: `${yieldedRequestId}-delivery`,
          createdAt: new Date(expired.getTime() - 60_000),
          issuedAt: new Date(expired.getTime() - 60_000),
          expiresAt: expired,
        },
      })
      const priorSuccessAt = (await readRecommendationRetentionHealth(db, now))
        .latestSuccessAt
      let delayed = false
      const delayedTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
        options?: { maxWait?: number; timeout?: number },
      ): Promise<T> => {
        const result = await db.$transaction(callback, options)
        if (
          !delayed &&
          (await db.recommendationRequest.count({
            where: { id: yieldedRequestId },
          })) === 0
        ) {
          delayed = true
          await new Promise((resolve) => setTimeout(resolve, 5_100))
        }
        return result
      }
      const delayedDb = new Proxy(db, {
        get(target, property) {
          return property === "$transaction"
            ? delayedTransaction
            : Reflect.get(target, property)
        },
      }) as PrismaClient
      const result = await purgeExpiredRecommendationRequests(delayedDb, now)
      expect(delayed).toBe(true)
      expect(result).toMatchObject({
        status: "yielded",
        rootsDeleted: 1,
        continuationRequired: true,
        oldestExpiredAtAfter: null,
        overdueAfterRun: null,
        rowCounts: { requests: 1 },
      })
      expect(
        await db.recommendationRetentionRun.findUniqueOrThrow({
          where: { id: result.runId },
        }),
      ).toMatchObject({
        status: "SKIPPED",
        reasonCode: "budget_yield",
        rootsDeleted: 1,
      })
      expect(
        (await readRecommendationRetentionHealth(db, now)).latestSuccessAt,
      ).toEqual(priorSuccessAt)
    }, 60_000)

    it("advances an expired request while a standalone playback page remains loaded", async () => {
      const now = new Date()
      const expired = new Date(now.getTime() - 86_400_000)
      const requestId = `retained-loaded-request-${randomUUID()}`
      const episodePrefix = randomUUID()
      const episodeIds = Array.from(
        { length: 30 },
        (_, index) =>
          `retained-loaded-${episodePrefix}-${String(index).padStart(2, "0")}`,
      )
      extraRequestIds.push(requestId)
      extraEpisodeIds.push(...episodeIds)
      await db.recommendationRequest.create({
        data: {
          id: requestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId,
          strategyVersion: manifestId,
          classifierVersion: "active-watch-proxy-v1",
          sessionDigest: "d".repeat(64),
          seedMediaId: "fixture-seed",
          locale: "en",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          signingKid: "fixture",
          deliveryJti: `${requestId}-delivery`,
          createdAt: new Date(expired.getTime() - 60_000),
          issuedAt: new Date(expired.getTime() - 60_000),
          expiresAt: expired,
        },
      })
      await db.recommendationPlaybackEpisode.createMany({
        data: episodeIds.map((episodeId) => ({
          id: episodeId,
          mediaId: "fixture-video",
          sessionDigest: "e".repeat(64),
          state: "FINALIZED" as const,
          activeUntil: new Date(expired.getTime() - 120_000),
          hardUntil: new Date(expired.getTime() - 60_000),
          createdAt: new Date(expired.getTime() - 180_000),
          expiresAt: expired,
        })),
      })

      const result = await purgeExpiredRecommendationRequests(db, now, 25)
      const remaining = await db.recommendationPlaybackEpisode.count({
        where: { id: { in: episodeIds } },
      })
      expect(result.status).toBe("succeeded")
      expect(result.rootsDeleted).toBe(1)
      expect(result.rowCounts.expiredStandaloneEpisodes).toBeGreaterThanOrEqual(
        5,
      )
      expect(result.rowCounts.expiredStandaloneEpisodes).toBeLessThanOrEqual(25)
      expect(remaining).toBe(30 - result.rowCounts.expiredStandaloneEpisodes)
      expect(remaining).toBeGreaterThan(0)
      expect(
        await db.recommendationRequest.count({ where: { id: requestId } }),
      ).toBe(0)
      expect(
        await db.recommendationRetentionRun.findUniqueOrThrow({
          where: { id: result.runId },
        }),
      ).toMatchObject({
        status: "SUCCEEDED",
        rootsDeleted: 1,
        rowCounts: {
          expiredStandaloneEpisodes: result.rowCounts.expiredStandaloneEpisodes,
        },
      })
    }, 60_000)

    it("deletes only expired closed precomputed experiments and retains a future configuration", async () => {
      const now = new Date()
      const generationId = `retained-generation-${randomUUID()}`
      const expiredExperimentId = `retained-precomputed-expired-${randomUUID()}`
      const futureExperimentId = `retained-precomputed-future-${randomUUID()}`
      await db.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "fixture",
          promptVersion: "fixture-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: now,
          expectedSourceCount: 0,
          status: "complete",
          completedAt: now,
        },
      })
      const experiment = (experimentId: string, expiresAt: Date) => ({
        id: experimentId,
        generationId,
        controlManifestId: "semantic-transcript-pgvector-v1",
        challengerManifestId: "precomputed-watch-preview-v1",
        controlManifestDigest: "c".repeat(64),
        controlRoutingDigest: "d".repeat(64),
        sourceSetDigest: "b".repeat(64),
        assignmentPolicyVersion: "fixture-v1",
        eligibilityPolicyVersion: "fixture-v1",
        deliveryPolicyVersion: "fixture-v1",
        configurationDigest: "e".repeat(64),
        state: "closed",
        startsAt: new Date(now.getTime() - 3 * 86_400_000),
        endsAt: new Date(now.getTime() - 2 * 86_400_000),
        expiresAt,
      })
      try {
        await db.recommendationPrecomputedExperiment.createMany({
          data: [
            experiment(
              expiredExperimentId,
              new Date(now.getTime() - 86_400_000),
            ),
            experiment(
              futureExperimentId,
              new Date(now.getTime() + 86_400_000),
            ),
          ],
        })
        const result = await purgeExpiredRecommendationRequests(db, now, 1)
        expect(result).toMatchObject({
          status: "succeeded",
          rowCounts: { expiredPrecomputedExperiments: 1 },
          batchLimitReached: true,
        })
        expect(
          await db.recommendationPrecomputedExperiment.count({
            where: { id: expiredExperimentId },
          }),
        ).toBe(0)
        expect(
          await db.recommendationPrecomputedExperiment.count({
            where: { id: futureExperimentId },
          }),
        ).toBe(1)
      } finally {
        await db.recommendationPrecomputedExperiment.deleteMany({
          where: {
            id: { in: [expiredExperimentId, futureExperimentId] },
          },
        })
        await db.recommendationPrecomputedGeneration.delete({
          where: { id: generationId },
        })
      }
    }, 60_000)
  },
)
