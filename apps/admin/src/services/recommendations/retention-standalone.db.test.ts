import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { compositionGraphFixture } from "./composition/graph.test-fixture"
import { compositionDigest } from "./composition/policy"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "./integrity-policy"
import { COWATCH_MMR_TRIAL_MANIFEST } from "./promotion/manifest"
import {
  purgeExpiredRecommendationRequests,
  readRecommendationRetentionHealth,
} from "./retention.service"

const day = 86_400_000

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "standalone episode retention on PostgreSQL",
  () => {
    let db: PrismaClient
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_retention_standalone_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback retention database required")
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 1 }),
      })
      const [requests, episodes, graphs] = await Promise.all([
        db.recommendationRequest.count(),
        db.recommendationPlaybackEpisode.count(),
        db.recommendationCowatchGeneration.count(),
      ])
      if (requests !== 0 || episodes !== 0 || graphs !== 0)
        throw new Error("Fresh owned retention database required")
      await db.$executeRawUnsafe(`
        CREATE TABLE owned_retention_failure (episode_id text PRIMARY KEY)
      `)
      // The owned database models the per-row work seen in production without
      // changing the application's five-second transaction/run deadline.
      await db.$executeRawUnsafe(`
        CREATE FUNCTION owned_retention_episode_latency() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF EXISTS (SELECT 1 FROM owned_retention_failure WHERE episode_id = OLD.id) THEN
            RAISE EXCEPTION 'owned episode delete failure';
          END IF;
          PERFORM pg_sleep(0.04);
          RETURN OLD;
        END $$
      `)
      await db.$executeRawUnsafe(`
        CREATE TRIGGER owned_retention_episode_latency
        BEFORE DELETE ON recommendation_playback_episode
        FOR EACH ROW EXECUTE FUNCTION owned_retention_episode_latency()
      `)
    })
    afterAll(async () => {
      if (!db) return
      await db.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS owned_retention_episode_latency ON recommendation_playback_episode
      `)
      await db.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS owned_retention_episode_latency()`,
      )
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS owned_retention_failure`)
      await db.$disconnect()
    })

    it("reaches expired request roots while a loaded standalone backlog continues", async () => {
      const pageSize = 5
      const now = new Date()
      const createdAt = new Date(now.getTime() - 30 * day)
      const expiredAt = new Date(now.getTime() - day)
      const liveUntil = new Date(now.getTime() + day)
      const prefix = randomUUID()
      const expiredRequestIds = Array.from(
        { length: 12 },
        (_, index) => `${prefix}-request-${index}`,
      )
      const liveRequestId = `${prefix}-live-request`
      await db.recommendationRequest.createMany({
        data: expiredRequestIds.slice(1).map((id) => ({
          id,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          strategyVersion: COWATCH_MMR_TRIAL_MANIFEST.strategyVersion,
          classifierVersion: "legacy-position-v0",
          sessionDigest: compositionDigest(id),
          locale: "en",
          seedMediaId: "fixture-seed",
          expectedItemCount: 0,
          state: "ISSUED" as const,
          result: "EMPTY" as const,
          deliveryJti: randomUUID(),
          signingKid: "fixture",
          issuedAt: createdAt,
          createdAt,
          expiresAt: expiredAt,
        })),
      })
      const liveLineage = await db.$transaction(async (tx) => {
        await tx.recommendationRequest.create({
          data: {
            id: liveRequestId,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
            strategyVersion: COWATCH_MMR_TRIAL_MANIFEST.strategyVersion,
            classifierVersion: "legacy-position-v0",
            sessionDigest: compositionDigest(liveRequestId),
            locale: "en",
            seedMediaId: "fixture-seed",
            expectedItemCount: 1,
            state: "ISSUED",
            result: "SERVED",
            deliveryJti: randomUUID(),
            signingKid: "fixture",
            issuedAt: createdAt,
            createdAt,
            expiresAt: liveUntil,
          },
        })
        const item = await tx.recommendationServedItem.create({
          data: {
            requestId: liveRequestId,
            position: 0,
            targetMediaId: "fixture-media",
            canonicalHref: "/watch/fixture.html",
            candidateGenerator: "semantic",
            candidateProvenance: {},
            capabilityJti: randomUUID(),
            signingKid: "fixture",
            presentation: {},
            createdAt,
            expiresAt: liveUntil,
          },
        })
        const selection = await tx.recommendationSelection.create({
          data: {
            requestId: liveRequestId,
            itemId: item.id,
            capabilityJti: randomUUID(),
            eventId: randomUUID(),
            payloadDigest: compositionDigest(`${liveRequestId}-payload`),
            claimNonceDigest: compositionDigest(`${liveRequestId}-claim`),
            handoffExpiresAt: liveUntil,
            occurredAt: createdAt,
            receivedAt: createdAt,
            expiresAt: liveUntil,
          },
        })
        return { item, selection }
      })
      const expiredEpisodeIds = Array.from(
        { length: 100 },
        (_, index) => `${prefix}-episode-${index}`,
      )
      const liveEpisodeId = `${prefix}-live-episode`
      const requestOwnedEpisodeId = `${prefix}-request-episode`
      await db.recommendationPlaybackEpisode.createMany({
        data: [...expiredEpisodeIds, liveEpisodeId, requestOwnedEpisodeId].map(
          (id) => ({
            id,
            requestId: id === requestOwnedEpisodeId ? liveRequestId : null,
            itemId: id === requestOwnedEpisodeId ? liveLineage.item.id : null,
            selectionId:
              id === requestOwnedEpisodeId ? liveLineage.selection.id : null,
            mediaId: "fixture-media",
            sessionDigest: compositionDigest(id),
            state: "FINALIZED" as const,
            activeUntil: new Date(createdAt.getTime() + day),
            hardUntil: new Date(createdAt.getTime() + 2 * day),
            createdAt,
            expiresAt: expiredEpisodeIds.includes(id) ? expiredAt : liveUntil,
          }),
        ),
      })
      await db.recommendationPlaybackFact.createMany({
        data: expiredEpisodeIds.map((episodeId) => ({
          id: `${episodeId}-fact`,
          episodeId,
          capabilityJti: `${episodeId}-capability`,
          eventId: `${episodeId}-event`,
          payloadDigest: compositionDigest(episodeId),
          sequence: 1,
          kind: "heartbeat",
          occurredAt: createdAt,
          receivedAt: createdAt,
          expiresAt: expiredAt,
        })),
      })
      await db.recommendationOutcomeRevision.createMany({
        data: expiredEpisodeIds.map((episodeId) => ({
          id: `${episodeId}-outcome`,
          episodeId,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: compositionDigest(episodeId),
          revision: 1,
          qualifiedView: true,
          viewQualityWeight: 1,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 30_000,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 1,
          createdAt,
          expiresAt: expiredAt,
        })),
      })
      const graph = await compositionGraphFixture(db)
      const template =
        await db.recommendationCowatchSourceContribution.findFirstOrThrow({
          where: { generationId: graph.generationId },
        })
      const sourceEpisodeId = expiredEpisodeIds[0]!
      const decision = await db.recommendationEligibilityDecision.create({
        data: {
          sourceType: "PLAYBACK_OUTCOME",
          sourceKey: sourceEpisodeId,
          outcomeId: `${sourceEpisodeId}-outcome`,
          policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
          revision: 1,
          actorClass: "HUMAN_SIGNED_IN",
          state: "ELIGIBLE",
          eligibleScopes: ["aggregate", "profile"],
          contributionWeight: 1,
          contributionOrdinal: 1,
          distinctSupport: 10,
          identityConcentration: 0.1,
          inputDigest: compositionDigest(`${sourceEpisodeId}-eligible`),
          expiresAt: expiredAt,
        },
      })
      const linkedSourceId = randomUUID()
      await db.recommendationCowatchSourceContribution.create({
        data: {
          ...template,
          id: linkedSourceId,
          outcomeId: `${sourceEpisodeId}-outcome`,
          eligibilityDecisionId: decision.id,
          sessionDigest: compositionDigest(sourceEpisodeId),
          occurredAt: createdAt,
          expiresAt: expiredAt,
        },
      })
      expect(
        await db.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: graph.generationId },
          select: { invalidatedAt: true },
        }),
      ).toEqual({ invalidatedAt: null })

      const requestEpisodeId = `${prefix}-request-expired-episode`
      const requestOutcomeId = `${prefix}-request-outcome`
      const { requestItem, requestSelection } = await db.$transaction(
        async (tx) => {
          await tx.recommendationRequest.create({
            data: {
              id: expiredRequestIds[0]!,
              contractVersion: "semantic-recommendation-v1",
              surfaceVersion: "watch-below-player-v1",
              manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
              strategyVersion: COWATCH_MMR_TRIAL_MANIFEST.strategyVersion,
              classifierVersion: "legacy-position-v0",
              sessionDigest: compositionDigest(expiredRequestIds[0]!),
              locale: "en",
              seedMediaId: "fixture-seed",
              expectedItemCount: 1,
              state: "ISSUED",
              result: "SERVED",
              deliveryJti: randomUUID(),
              signingKid: "fixture",
              issuedAt: createdAt,
              createdAt,
              expiresAt: expiredAt,
            },
          })
          const requestItem = await tx.recommendationServedItem.create({
            data: {
              requestId: expiredRequestIds[0]!,
              position: 0,
              targetMediaId: "fixture-media",
              canonicalHref: "/watch/fixture.html",
              candidateGenerator: "semantic",
              candidateProvenance: {},
              capabilityJti: randomUUID(),
              signingKid: "fixture",
              presentation: {},
              createdAt,
              expiresAt: expiredAt,
            },
          })
          const requestSelection = await tx.recommendationSelection.create({
            data: {
              requestId: expiredRequestIds[0]!,
              itemId: requestItem.id,
              capabilityJti: randomUUID(),
              eventId: randomUUID(),
              payloadDigest: compositionDigest(`${requestEpisodeId}-payload`),
              claimNonceDigest: compositionDigest(`${requestEpisodeId}-claim`),
              handoffExpiresAt: expiredAt,
              occurredAt: createdAt,
              receivedAt: createdAt,
              expiresAt: expiredAt,
            },
          })
          return { requestItem, requestSelection }
        },
      )
      await db.recommendationPlaybackEpisode.create({
        data: {
          id: requestEpisodeId,
          requestId: expiredRequestIds[0],
          itemId: requestItem.id,
          selectionId: requestSelection.id,
          mediaId: "fixture-media",
          sessionDigest: compositionDigest(requestEpisodeId),
          state: "FINALIZED",
          activeUntil: new Date(createdAt.getTime() + day),
          hardUntil: new Date(createdAt.getTime() + 2 * day),
          createdAt,
          expiresAt: expiredAt,
        },
      })
      await db.recommendationOutcomeRevision.create({
        data: {
          id: requestOutcomeId,
          requestId: expiredRequestIds[0],
          itemId: requestItem.id,
          episodeId: requestEpisodeId,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: compositionDigest(requestOutcomeId),
          revision: 1,
          qualifiedView: true,
          viewQualityWeight: 1,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 30_000,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 1,
          expiresAt: expiredAt,
        },
      })
      const liveOutcomeId = `${prefix}-live-outcome`
      await db.recommendationOutcomeRevision.create({
        data: {
          id: liveOutcomeId,
          requestId: liveRequestId,
          itemId: liveLineage.item.id,
          episodeId: requestOwnedEpisodeId,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: compositionDigest(liveOutcomeId),
          revision: 1,
          qualifiedView: true,
          viewQualityWeight: 1,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 30_000,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 1,
          expiresAt: liveUntil,
        },
      })
      const actionId = `${prefix}-request-action`
      await db.recommendationContentAction.create({
        data: {
          id: actionId,
          contractVersion: "content-action-v1",
          sessionDigest: compositionDigest(actionId),
          eventId: randomUUID(),
          payloadDigest: compositionDigest(`${actionId}-payload`),
          actionClass: "HUMAN_ACTION",
          actionKind: "SHARE",
          actorClass: "HUMAN_SIGNED_IN",
          purpose: "WATCH",
          targetMediaId: "fixture-media",
          requestId: expiredRequestIds[1],
          occurredAt: createdAt,
          receivedAt: createdAt,
          expiresAt: expiredAt,
        },
      })
      const liveActionId = `${prefix}-live-action`
      await db.recommendationContentAction.create({
        data: {
          id: liveActionId,
          contractVersion: "content-action-v1",
          sessionDigest: compositionDigest(liveActionId),
          eventId: randomUUID(),
          payloadDigest: compositionDigest(`${liveActionId}-payload`),
          actionClass: "HUMAN_ACTION",
          actionKind: "SHARE",
          actorClass: "HUMAN_SIGNED_IN",
          purpose: "WATCH",
          targetMediaId: "fixture-media",
          requestId: liveRequestId,
          itemId: liveLineage.item.id,
          occurredAt: createdAt,
          receivedAt: createdAt,
          expiresAt: liveUntil,
        },
      })
      const eligibilityDecisionIds = new Map<string, string>()
      for (const [key, sourceType, linked] of [
        ["outcome", "PLAYBACK_OUTCOME", { outcomeId: requestOutcomeId }],
        ["action", "CONTENT_ACTION", { contentActionId: actionId }],
        ["live-outcome", "PLAYBACK_OUTCOME", { outcomeId: liveOutcomeId }],
        ["live-action", "CONTENT_ACTION", { contentActionId: liveActionId }],
        ["unrelated", "SELECTION", { selectionId: liveLineage.selection.id }],
      ] as const) {
        const decision = await db.recommendationEligibilityDecision.create({
          data: {
            sourceType,
            sourceKey: `${prefix}-${key}`,
            ...linked,
            policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
            revision: 1,
            actorClass: "HUMAN_SIGNED_IN",
            state: "ELIGIBLE",
            contributionWeight: 1,
            contributionOrdinal: 1,
            distinctSupport: 1,
            identityConcentration: 0,
            inputDigest: compositionDigest(`${prefix}-${key}-eligible`),
            expiresAt:
              key === "unrelated" || key.startsWith("live-")
                ? liveUntil
                : expiredAt,
          },
        })
        eligibilityDecisionIds.set(key, decision.id)
      }

      const projectionRunIds = Array.from(
        { length: 100 },
        (_, index) => `${prefix}-projection-${index}`,
      )
      await db.recommendationProfileProjectionRun.createMany({
        data: projectionRunIds.map((id) => ({
          id,
          scope: "SESSION" as const,
          sessionDigest: compositionDigest(id),
          state: "COMPLETED" as const,
          completedAt: createdAt,
          createdAt,
          expiresAt: expiredAt,
        })),
      })

      const startedAt = performance.now()
      const first = await purgeExpiredRecommendationRequests(db, now)
      const firstElapsedMs = performance.now() - startedAt
      console.info(
        "owned-standalone-loaded-first-ms",
        Math.round(firstElapsedMs),
      )
      expect(firstElapsedMs).toBeLessThan(5000)
      expect(first.rowCounts).toMatchObject({
        episodes: 1,
        outcomes: 1,
        contentActions: 1,
        eligibilityDecisions: 2,
        expiredProfileProjectionRuns: 100,
      })
      expect(
        await db.recommendationProfileProjectionRun.count({
          where: { id: { in: projectionRunIds } },
        }),
      ).toBe(0)
      expect(
        await db.recommendationRetentionRun.findUniqueOrThrow({
          where: { id: first.runId },
          select: { status: true, rootsDeleted: true, rowCounts: true },
        }),
      ).toMatchObject({
        status: "SUCCEEDED",
        rootsDeleted: 12,
        rowCounts: { expiredProfileProjectionRuns: 100 },
      })
      expect(
        await db.recommendationEligibilityDecision.count({
          where: {
            id: {
              in: [
                eligibilityDecisionIds.get("outcome")!,
                eligibilityDecisionIds.get("action")!,
              ],
            },
          },
        }),
      ).toBe(0)
      expect(
        await db.recommendationEligibilityDecision.count({
          where: {
            id: {
              in: [
                eligibilityDecisionIds.get("live-outcome")!,
                eligibilityDecisionIds.get("live-action")!,
                eligibilityDecisionIds.get("unrelated")!,
              ],
            },
          },
        }),
      ).toBe(3)
      expect(first).toMatchObject({
        status: "succeeded",
        rootsDeleted: 12,
        batchLimitReached: true,
        rowCounts: {
          expiredStandaloneEpisodes: pageSize,
          expiredStandalonePlaybackFacts: pageSize,
          expiredStandaloneOutcomes: pageSize,
        },
      })
      expect(
        await db.recommendationPlaybackEpisode.count({
          where: { id: { in: expiredEpisodeIds } },
        }),
      ).toBe(100 - pageSize)
      for (let page = 0; page < 100 / pageSize - 1; page++) {
        const next = await purgeExpiredRecommendationRequests(db, now)
        expect(next).toMatchObject({
          status: "succeeded",
          rootsDeleted: 0,
          batchLimitReached: true,
          rowCounts: {
            expiredStandaloneEpisodes: pageSize,
            expiredStandalonePlaybackFacts: pageSize,
            expiredStandaloneOutcomes: pageSize,
          },
        })
      }
      const completed = await purgeExpiredRecommendationRequests(db, now)
      expect(completed).toMatchObject({
        status: "succeeded",
        rootsDeleted: 0,
        batchLimitReached: false,
        rowCounts: { expiredStandaloneEpisodes: 0 },
      })
      expect(
        await db.recommendationRetentionRun.findUniqueOrThrow({
          where: { id: completed.runId },
          select: { status: true, oldestExpiredAtAfter: true },
        }),
      ).toMatchObject({ status: "SUCCEEDED", oldestExpiredAtAfter: null })
      expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
        healthy: true,
        reason: "healthy",
        latestSuccessAt: now,
        oldestOverdueAt: null,
      })
      expect(
        await db.recommendationPlaybackEpisode.count({
          where: { id: { in: expiredEpisodeIds } },
        }),
      ).toBe(0)
      expect(
        await db.recommendationPlaybackFact.count({
          where: { episodeId: { in: expiredEpisodeIds } },
        }),
      ).toBe(0)
      expect(
        await db.recommendationOutcomeRevision.count({
          where: { episodeId: { in: expiredEpisodeIds } },
        }),
      ).toBe(0)
      expect(
        await db.recommendationCowatchSourceContribution.count({
          where: { id: linkedSourceId },
        }),
      ).toBe(0)
      expect(
        await db.recommendationCowatchSourceContribution.count({
          where: { generationId: graph.generationId },
        }),
      ).toBeGreaterThan(0)
      expect(
        (
          await db.recommendationCowatchGeneration.findUniqueOrThrow({
            where: { id: graph.generationId },
            select: { invalidatedAt: true },
          })
        ).invalidatedAt,
      ).not.toBeNull()
      expect(
        await db.recommendationPlaybackEpisode.count({
          where: { id: { in: [liveEpisodeId, requestOwnedEpisodeId] } },
        }),
      ).toBe(2)
      expect(
        await db.recommendationRequest.count({
          where: { id: { in: [liveRequestId, ...expiredRequestIds] } },
        }),
      ).toBe(1)
    }, 30_000)

    it("rolls back a failed episode while preserving earlier committed counts", async () => {
      const now = new Date()
      const createdAt = new Date(now.getTime() - 30 * day)
      const expiresAt = new Date(now.getTime() - day)
      const prefix = randomUUID()
      const episodeIds = Array.from(
        { length: 10 },
        (_, index) => `${prefix}-episode-${index}`,
      )
      await db.recommendationPlaybackEpisode.createMany({
        data: episodeIds.map((id) => ({
          id,
          mediaId: "fixture-media",
          sessionDigest: compositionDigest(id),
          state: "FINALIZED" as const,
          activeUntil: new Date(createdAt.getTime() + day),
          hardUntil: new Date(createdAt.getTime() + 2 * day),
          createdAt,
          expiresAt,
        })),
      })
      const exposureId = randomUUID()
      await db.watchSurfaceExposure.create({
        data: {
          id: exposureId,
          eventId: randomUUID(),
          windowId: randomUUID(),
          surface: "watch",
          block: "recommendations",
          presentation: "cards",
          placement: "below-player",
          policyVersion: "fixture",
          position: 0,
          itemPath: "/watch/fixture.html",
          kind: "rendered",
          occurredAt: createdAt,
          receivedAt: createdAt,
          expiresAt,
        },
      })
      await db.$executeRaw(Prisma.sql`
        INSERT INTO owned_retention_failure (episode_id) VALUES (${episodeIds[4]})
      `)
      try {
        await expect(
          purgeExpiredRecommendationRequests(db, now),
        ).rejects.toThrow("owned episode delete failure")
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
          await db.watchSurfaceExposure.count({ where: { id: exposureId } }),
        ).toBe(0)
        expect(
          await db.recommendationPlaybackEpisode.count({
            where: { id: { in: episodeIds } },
          }),
        ).toBe(6)
      } finally {
        await db.$executeRaw(Prisma.sql`
          DELETE FROM owned_retention_failure WHERE episode_id = ${episodeIds[4]}
        `)
      }
      const retry = await purgeExpiredRecommendationRequests(db, now)
      expect(retry).toMatchObject({
        status: "succeeded",
        batchLimitReached: true,
        rowCounts: { expiredStandaloneEpisodes: 5 },
      })
      expect(await purgeExpiredRecommendationRequests(db, now)).toMatchObject({
        status: "succeeded",
        batchLimitReached: false,
        rowCounts: { expiredStandaloneEpisodes: 1 },
      })
      expect(
        await db.recommendationPlaybackEpisode.count({
          where: { id: { in: episodeIds } },
        }),
      ).toBe(0)
    }, 30_000)

    it("keeps a slow projection-tail timeout failed after committing a request root", async () => {
      const now = new Date()
      const createdAt = new Date(now.getTime() - 30 * day)
      const expiredAt = new Date(now.getTime() - day)
      const requestId = randomUUID()
      const projectionRunIds = Array.from({ length: 100 }, () => randomUUID())
      await db.recommendationRequest.create({
        data: {
          id: requestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          strategyVersion: COWATCH_MMR_TRIAL_MANIFEST.strategyVersion,
          classifierVersion: "legacy-position-v0",
          sessionDigest: compositionDigest(requestId),
          locale: "en",
          seedMediaId: "fixture-seed",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          deliveryJti: randomUUID(),
          signingKid: "fixture",
          issuedAt: createdAt,
          createdAt,
          expiresAt: expiredAt,
        },
      })
      await db.recommendationProfileProjectionRun.createMany({
        data: projectionRunIds.map((id) => ({
          id,
          scope: "SESSION" as const,
          sessionDigest: compositionDigest(id),
          state: "COMPLETED" as const,
          completedAt: createdAt,
          createdAt,
          expiresAt: expiredAt,
        })),
      })
      const before = await readRecommendationRetentionHealth(db, now)
      const successfulRunsBefore = await db.recommendationRetentionRun.count({
        where: { status: "SUCCEEDED" },
      })
      // Slow only this owned database. The existing five-second whole-run
      // deadline must still fail the attempt after the earlier root commits.
      await db.$executeRawUnsafe(`
        CREATE FUNCTION owned_retention_slow_projection() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.08); RETURN OLD; END $$
      `)
      await db.$executeRawUnsafe(`
        CREATE TRIGGER owned_retention_slow_projection
        BEFORE DELETE ON recommendation_profile_projection_run
        FOR EACH ROW EXECUTE FUNCTION owned_retention_slow_projection()
      `)
      try {
        await expect(
          purgeExpiredRecommendationRequests(db, now),
        ).rejects.toThrow(/transaction|deadline|timeout/i)
        const failed = await db.recommendationRetentionRun.findFirstOrThrow({
          orderBy: { startedAt: "desc" },
        })
        expect(failed).toMatchObject({
          status: "FAILED",
          rootsDeleted: 1,
          rowCounts: { requests: 1 },
          oldestExpiredAtAfter: null,
        })
        expect(failed.rowCounts).not.toHaveProperty(
          "expiredProfileProjectionRuns",
        )
        expect(
          await db.recommendationRequest.count({ where: { id: requestId } }),
        ).toBe(0)
        expect(
          await db.recommendationProfileProjectionRun.count({
            where: { id: { in: projectionRunIds } },
          }),
        ).toBe(100)
        expect(
          await db.recommendationRetentionRun.count({
            where: { status: "SUCCEEDED" },
          }),
        ).toBe(successfulRunsBefore)
        expect(
          (await readRecommendationRetentionHealth(db, now)).latestSuccessAt,
        ).toEqual(before.latestSuccessAt)
      } finally {
        await db.$executeRawUnsafe(`
          DROP TRIGGER IF EXISTS owned_retention_slow_projection
          ON recommendation_profile_projection_run
        `)
        await db.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS owned_retention_slow_projection()`,
        )
        await db.recommendationProfileProjectionRun.deleteMany({
          where: { id: { in: projectionRunIds } },
        })
      }
    }, 30_000)
  },
)
