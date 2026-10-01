import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { compositionGraphFixture } from "./composition/graph.test-fixture"
import { compositionDigest } from "./composition/policy"
import { nominations } from "./composition/test-helpers"
import { COWATCH_SHADOW_GENERATOR_KEY } from "./cowatch/graph"
import { COWATCH_MMR_TRIAL_MANIFEST } from "./promotion/manifest"
import { lockRetentionRoots } from "./retention-locks"
import {
  purgeExpiredRecommendationRequests,
  RECOMMENDATION_RETENTION_BATCH_SIZE,
} from "./retention.service"

const day = 86_400_000
function latch() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "composition retention lock order on PostgreSQL",
  () => {
    let db: PrismaClient
    beforeAll(() => {
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
    afterAll(async () => db?.$disconnect())

    async function fixture(expiredRequest: boolean) {
      const source = await compositionGraphFixture(db)
      const now = new Date()
      const graphId = compositionDigest(randomUUID()),
        protocolId = randomUUID(),
        evaluationId = randomUUID(),
        requestId = randomUUID(),
        runId = randomUUID()
      const graph = await db.recommendationCowatchGeneration.findUniqueOrThrow({
        where: { id: source.generationId },
      })
      const graphExpiry = new Date(now.getTime() - 60_000)
      await db.recommendationCowatchGeneration.create({
        data: { ...graph, id: graphId, expiresAt: graphExpiry },
      })
      const sourceRow =
        await db.recommendationCowatchSourceContribution.findFirstOrThrow({
          where: {
            generationId: source.generationId,
            viewerProfileId: source.profileId,
          },
        })
      await db.recommendationCowatchSourceContribution.create({
        data: { ...sourceRow, id: randomUUID(), generationId: graphId },
      })
      const createdAt = new Date(now.getTime() - 10 * 60_000)
      const requestExpiry = new Date(
        now.getTime() + (expiredRequest ? -60_000 : day),
      )
      await db.recommendationCompositionProtocol.create({
        data: {
          id: protocolId,
          shadowEvaluationId: evaluationId,
          sourceManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
          challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          composerVersion: "source-interest-theme-mmr-v1",
          protocolVersion: "fixture-lock-order",
          config: {
            cowatchGenerationId: graphId,
            cowatchDependencyExpiresAt: graphExpiry.toISOString(),
          },
          configDigest: compositionDigest(protocolId),
          actorId: "owned-retention-fixture",
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 365 * day),
        },
      })
      await db.recommendationShadowEvaluation.create({
        data: {
          id: evaluationId,
          manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
          cowatchGenerationId: graphId,
          contextVersion: "fixture",
          eligibilityVersion: "fixture",
          samplingVersion: "fixture",
          retentionPolicyVersion: "fixture",
          windowStart: new Date(now.getTime() - 2 * day),
          windowEnd: new Date(now.getTime() - day),
          requestedSampleSize: 1,
          createdAt,
          expiresAt: new Date(now.getTime() + day),
        },
      })
      await db.$transaction(async (tx) => {
        await tx.recommendationRequest.create({
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
            expectedItemCount: 1,
            state: "ISSUED",
            result: "SERVED",
            deliveryJti: randomUUID(),
            signingKid: "fixture",
            issuedAt: createdAt,
            createdAt,
            expiresAt: requestExpiry,
          },
        })
        const candidate = nominations()[0]!
        await tx.recommendationServedItem.create({
          data: {
            requestId,
            position: 0,
            targetMediaId: candidate.targetMediaId,
            canonicalHref: "/watch/fixture.html",
            candidateGenerator: "semantic",
            candidateProvenance: {},
            capabilityJti: randomUUID(),
            signingKid: "fixture",
            presentation: candidate.presentation,
            createdAt,
            expiresAt: requestExpiry,
          },
        })
      })
      await db.recommendationShadowRun.create({
        data: {
          id: runId,
          evaluationId,
          requestId,
          projectionProfileId: source.profileId,
          privacyGeneration: 1,
          sampleOrdinal: 0,
          samplingDigest: compositionDigest(runId),
          contextProjectionVersion: "fixture",
          eligibilityVersion: "fixture",
          retentionPolicyVersion: "fixture",
          inputCapturedAt: createdAt,
          state: "PUBLISHED",
          claimedAt: createdAt,
          expiresAt: requestExpiry,
        },
      })
      await db.recommendationCompositionObservation.create({
        data: {
          runId,
          protocolId,
          inputDigest: compositionDigest(runId),
          outputDigest: compositionDigest(requestId),
          metrics: {},
          createdAt,
          expiresAt: new Date(now.getTime() - 2 * 60_000),
        },
      })
      return {
        now,
        graphId,
        protocolId,
        requestId,
        runId,
        profileId: source.profileId,
        siblingGraphId: source.generationId,
        sourceOutcomeId: sourceRow.outcomeId,
        evaluationId,
      }
    }

    it("completes observation expiry and concurrent privacy invalidation without a protocol/graph cycle", async () => {
      const f = await fixture(false)
      const removed = latch(),
        resume = latch(),
        graphLocked = latch()
      let intercepted = false
      const retentionDb = db.$extends({
        query: {
          recommendationCompositionObservation: {
            async deleteMany({ args, query }) {
              const result = await query(args)
              if (!intercepted) {
                intercepted = true
                removed.release()
                await resume.promise
              }
              return result
            },
          },
        },
      })
      const retention = purgeExpiredRecommendationRequests(
        retentionDb as PrismaClient,
        f.now,
        500,
      )
      // Attach handlers immediately: either participant can be the deadlock victim.
      const retentionOutcome = retention.then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      await removed.promise
      const privacy = db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM recommendation_profile WHERE id = ${f.profileId} FOR UPDATE`,
          )
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM recommendation_cowatch_generation WHERE id = ${f.graphId} FOR UPDATE`,
          )
          graphLocked.release()
          await tx.recommendationProfile.update({
            where: { id: f.profileId },
            data: { privacyGeneration: { increment: 1 } },
          })
        },
        { timeout: 4_000 },
      )
      const privacyOutcome = privacy.then(
        () => ({ success: true }),
        (error) => ({ error }),
      )
      await graphLocked.promise
      resume.release()
      const results = await Promise.all([retentionOutcome, privacyOutcome])
      expect(results[0]).toMatchObject({ value: { status: "succeeded" } })
      expect(results[1]).toEqual({ success: true })
      expect(
        await db.recommendationCompositionObservation.findUnique({
          where: { runId: f.runId },
        }),
      ).toBeNull()
      expect(
        await db.recommendationCowatchGeneration.findUnique({
          where: { id: f.graphId },
        }),
      ).toBeNull()
      expect(
        (
          await db.recommendationCompositionProtocol.findUniqueOrThrow({
            where: { id: f.protocolId },
          })
        ).revokedAt,
      ).not.toBeNull()
    }, 15_000)
    it("drains 1000 simple roots with one connection inside the batch deadline", async () => {
      const now = new Date(),
        prefix = randomUUID()
      const createdAt = new Date(now.getTime() - day),
        expiresAt = new Date(now.getTime() - 60_000)
      await db.recommendationRequest.createMany({
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `${prefix}-${index}`,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          strategyVersion: COWATCH_MMR_TRIAL_MANIFEST.strategyVersion,
          classifierVersion: "legacy-position-v0",
          sessionDigest: compositionDigest(`${prefix}-${index}`),
          locale: "en",
          seedMediaId: "fixture-seed",
          expectedItemCount: 0,
          state: "ISSUED" as const,
          result: "EMPTY" as const,
          deliveryJti: randomUUID(),
          signingKid: "fixture",
          issuedAt: createdAt,
          createdAt,
          expiresAt,
        })),
      })
      const single = new PrismaClient({
        adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 1 }),
      })
      const started = performance.now()
      try {
        const result = await purgeExpiredRecommendationRequests(
          single,
          now,
          1000,
        )
        expect(result).toMatchObject({
          status: "succeeded",
          rootsDeleted: 1000,
        })
        expect(performance.now() - started).toBeLessThan(5000)
      } finally {
        console.info(
          "owned-retention-1000-root-pool1-ms",
          Math.round(performance.now() - started),
        )
        await single.$disconnect()
      }
    }, 15_000)

    it("continues a loaded legacy-stage backlog with the default bounded batch", async () => {
      const now = new Date(),
        prefix = randomUUID(),
        createdAt = new Date(now.getTime() - 11 * day),
        expiresAt = new Date(now.getTime() - 10 * day)
      const roots = Array.from({ length: 120 }, (_, index) => ({
        id: `${prefix}-${index}`,
        runId: `${prefix}-run-${index}`,
      }))
      await db.recommendationRequest.createMany({
        data: roots.map(({ id }) => ({
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
          expiresAt,
        })),
      })
      await db.recommendationCandidateRun.createMany({
        data: roots.map(({ id, runId }) => ({
          id: runId,
          requestId: id,
          purpose: "watch",
          contextVersion: "fixture",
          generatorVersion: "fixture",
          unionVersion: "fixture",
          eligibilityVersion: "fixture",
          rankerVersion: "fixture",
          composerVersion: "fixture",
          candidateEligibilityParity: "not_evaluated",
          rankerParity: "not_evaluated",
          nominatedCount: 42,
          canonicalizedCount: 0,
          deduplicatedCount: 0,
          rejectedCount: 0,
          scoredCount: 0,
          orderedCount: 0,
          composedCount: 0,
          evidenceComplete: false,
          createdAt,
          expiresAt,
        })),
      })
      await db.recommendationCandidateStageEvidence.createMany({
        data: roots.flatMap(({ runId }) =>
          Array.from({ length: 42 }, (_, ordinal) => ({
            id: `${runId}-stage-${ordinal}`,
            runId,
            stage: "nominated",
            ordinal,
            candidateKey: `fixture-${ordinal}`,
            sourceEvidence: [],
            reasonCodes: [],
            createdAt,
            expiresAt,
          })),
        ),
      })
      const projectionIds = Array.from(
        { length: 3_000 },
        (_, index) => `${prefix}-projection-${index}`,
      )
      await db.recommendationProfileProjectionRun.createMany({
        data: projectionIds.map((id) => ({
          id,
          scope: "SESSION" as const,
          sessionDigest: compositionDigest(id),
          createdAt,
          expiresAt,
        })),
      })
      const profileId = `${prefix}-profile`
      await db.recommendationProfile.create({
        data: {
          id: profileId,
          tokenDigest: compositionDigest(profileId),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt: new Date(now.getTime() + day),
        },
      })
      const linkIds = Array.from(
        { length: 3_000 },
        (_, index) => `${prefix}-link-${index}`,
      )
      await db.recommendationProfileSessionLink.createMany({
        data: linkIds.map((id) => ({
          id,
          profileId,
          privacyGeneration: 1,
          sessionDigest: compositionDigest(id),
          linkedAt: createdAt,
          expiresAt,
        })),
      })
      expect(RECOMMENDATION_RETENTION_BATCH_SIZE).toBe(100)
      const firstStartedAt = performance.now()
      const first = await purgeExpiredRecommendationRequests(db, now)
      const firstElapsedMs = performance.now() - firstStartedAt
      expect(first).toMatchObject({
        status: "succeeded",
        rootsDeleted: 100,
        batchLimitReached: true,
        rowCounts: {
          candidateRuns: 100,
          candidateStageEvidence: 4_200,
          expiredProfileProjectionRuns: 3_000,
          expiredProfileSessionLinks: 3_000,
        },
      })
      const secondStartedAt = performance.now()
      const second = await purgeExpiredRecommendationRequests(db, now)
      const secondElapsedMs = performance.now() - secondStartedAt
      console.info({ firstElapsedMs, secondElapsedMs })
      expect(second).toMatchObject({
        status: "succeeded",
        rootsDeleted: 20,
        rowCounts: { candidateRuns: 20, candidateStageEvidence: 840 },
      })
      expect(
        await db.recommendationRequest.count({
          where: { id: { in: roots.map(({ id }) => id) } },
        }),
      ).toBe(0)
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: { in: roots.map(({ runId }) => runId) } },
        }),
      ).toBe(0)
      expect(
        await db.recommendationProfileProjectionRun.count({
          where: { id: { in: projectionIds } },
        }),
      ).toBe(0)
      expect(
        await db.recommendationProfileSessionLink.count({
          where: { id: { in: linkIds } },
        }),
      ).toBe(0)
      await db.recommendationProfile.delete({ where: { id: profileId } })
    }, 30_000)

    it("locks sibling graphs reached by private source suppression before deleting a graph", async () => {
      const f = await fixture(false)
      const locked = latch(),
        resume = latch()
      const deletion = db.$transaction(
        async (tx) => {
          await lockRetentionRoots(tx, { graphIds: [f.graphId] })
          locked.release()
          await resume.promise
          await tx.recommendationCowatchGeneration.delete({
            where: { id: f.graphId },
          })
        },
        { timeout: 4000 },
      )
      await locked.promise
      try {
        // A concurrent invalidator cannot own the sibling while deletion owns
        // the selected graph. Without the dependency closure this succeeds,
        // allowing sibling->selected and selected->sibling to form a cycle.
        await expect(
          db.$transaction((tx) =>
            tx.$queryRaw(Prisma.sql`
          SELECT id FROM recommendation_cowatch_generation WHERE id = ${f.siblingGraphId} FOR UPDATE NOWAIT
        `),
          ),
        ).rejects.toThrow(/55P03|could not obtain lock/)
      } finally {
        resume.release()
      }
      await deletion
      expect(
        (
          await db.recommendationCowatchGeneration.findUniqueOrThrow({
            where: { id: f.siblingGraphId },
          })
        ).invalidatedAt,
      ).not.toBeNull()
      expect(
        (
          await db.recommendationCompositionProtocol.findUniqueOrThrow({
            where: { id: f.protocolId },
          })
        ).revokedAt,
      ).not.toBeNull()
    }, 15000)

    it("records committed root erasure when a later phase fails, without a success watermark", async () => {
      const f = await fixture(true)
      const expiredObservations =
        await db.recommendationCompositionObservation.count({
          where: { expiresAt: { lte: f.now } },
        })
      let runId = ""
      const failing = db.$extends({
        query: {
          recommendationRetentionRun: {
            async create({ args, query }) {
              const row = await query(args)
              if (!row.id)
                throw new Error("Owned retention fixture missing run ID")
              runId = row.id
              return row
            },
          },
          recommendationTraceAccessAudit: {
            async deleteMany() {
              throw new Error("owned fixture failure after root phase")
            },
          },
        },
      })
      await expect(
        purgeExpiredRecommendationRequests(
          failing as PrismaClient,
          f.now,
          1000,
        ),
      ).rejects.toThrow("owned fixture failure")
      expect(
        await db.recommendationRequest.findUnique({
          where: { id: f.requestId },
        }),
      ).toBeNull()
      expect(
        await db.recommendationCowatchGeneration.findUnique({
          where: { id: f.graphId },
        }),
      ).not.toBeNull()
      expect(
        await db.recommendationRetentionRun.findUniqueOrThrow({
          where: { id: runId },
        }),
      ).toMatchObject({
        status: "FAILED",
        rootsDeleted: 1,
        rowCounts: {
          requests: 1,
          items: 1,
          expiredCompositionObservations: Math.min(500, expiredObservations),
        },
      })
      expect(
        await purgeExpiredRecommendationRequests(db, f.now, 1000),
      ).toMatchObject({ status: "succeeded", rootsDeleted: 0 })
    }, 15000)
    it("atomically fences and erases a loaded expired profile on one connection", async () => {
      const f = await fixture(false)
      await db.recommendationProfile.update({
        where: { id: f.profileId },
        data: { expiresAt: new Date(f.now.getTime() - 1000) },
      })
      const single = new PrismaClient({
        adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 1 }),
      })
      const started = performance.now()
      try {
        expect(
          await purgeExpiredRecommendationRequests(single, f.now, 500),
        ).toMatchObject({
          status: "succeeded",
          rowCounts: { expiredProfilesFenced: 1, profileErasuresCompleted: 1 },
        })
        expect(
          await db.recommendationProfile.findUniqueOrThrow({
            where: { id: f.profileId },
          }),
        ).toMatchObject({
          state: "EXPIRED",
          tokenDigest: null,
          erasureState: "COMPLETED",
        })
        expect(
          await db.recommendationCowatchSourceContribution.count({
            where: { viewerProfileId: f.profileId },
          }),
        ).toBe(0)
        expect(
          await db.recommendationProfileSessionLink.count({
            where: { profileId: f.profileId },
          }),
        ).toBe(0)
      } finally {
        console.info(
          "owned-retention-loaded-profile-pool1-ms",
          Math.round(performance.now() - started),
        )
        await single.$disconnect()
      }
    }, 15000)
    it("includes retained session aliases before suppressing a shared source outcome", async () => {
      const f = await fixture(false)
      const oldSource =
        await db.recommendationCowatchSourceContribution.findFirstOrThrow({
          where: { generationId: f.graphId },
        })
      const outcome = await db.recommendationOutcomeRevision.findUniqueOrThrow({
        where: { id: f.sourceOutcomeId },
      })
      const episode = await db.recommendationPlaybackEpisode.findUniqueOrThrow({
        where: { id: outcome.episodeId! },
      })
      const eligibility =
        await db.recommendationEligibilityDecision.findUniqueOrThrow({
          where: { id: oldSource.eligibilityDecisionId },
        })
      const graph = await db.recommendationCowatchGeneration.findUniqueOrThrow({
        where: { id: f.graphId },
      })
      const sessionB = compositionDigest(randomUUID()),
        graphB = compositionDigest(randomUUID()),
        graphC = compositionDigest(randomUUID()),
        episodeC = randomUUID(),
        outcomeC = randomUUID(),
        eligibilityC = randomUUID()
      await db.recommendationPlaybackEpisode.update({
        where: { id: episode.id },
        data: { sessionDigest: sessionB },
      })
      for (const id of [graphB, graphC])
        await db.recommendationCowatchGeneration.create({
          data: {
            ...graph,
            id,
            invalidatedAt: null,
            invalidationReason: null,
            expiresAt: new Date(f.now.getTime() + day),
          },
        })
      await db.recommendationCowatchSourceContribution.create({
        data: {
          ...oldSource,
          id: randomUUID(),
          generationId: graphB,
          sessionDigest: sessionB,
        },
      })
      await db.recommendationPlaybackEpisode.create({
        data: {
          ...episode,
          provenance:
            episode.provenance === null ? Prisma.JsonNull : episode.provenance,
          id: episodeC,
          sessionDigest: sessionB,
        },
      })
      await db.recommendationOutcomeRevision.create({
        data: {
          ...outcome,
          activeIntervals:
            outcome.activeIntervals === null
              ? Prisma.DbNull
              : outcome.activeIntervals,
          id: outcomeC,
          episodeId: episodeC,
          supersedesId: null,
        },
      })
      await db.recommendationEligibilityDecision.create({
        data: {
          ...eligibility,
          id: eligibilityC,
          sourceKey: episodeC,
          outcomeId: outcomeC,
        },
      })
      await db.recommendationCowatchSourceContribution.create({
        data: {
          ...oldSource,
          id: randomUUID(),
          generationId: graphC,
          outcomeId: outcomeC,
          eligibilityDecisionId: eligibilityC,
          sessionDigest: sessionB,
        },
      })
      const acquired = latch(),
        resume = latch()
      const deletion = db.$transaction(
        async (tx) => {
          await lockRetentionRoots(tx, { graphIds: [f.graphId] })
          acquired.release()
          await resume.promise
          await tx.recommendationCowatchGeneration.delete({
            where: { id: f.graphId },
          })
        },
        { timeout: 4000 },
      )
      await acquired.promise
      try {
        await expect(
          db.$transaction((tx) =>
            tx.$queryRaw(
              Prisma.sql`SELECT id FROM recommendation_cowatch_generation WHERE id = ${graphC} FOR UPDATE NOWAIT`,
            ),
          ),
        ).rejects.toThrow(/55P03|could not obtain lock/)
      } finally {
        resume.release()
      }
      await deletion
      expect(
        (
          await db.recommendationCowatchGeneration.findUniqueOrThrow({
            where: { id: graphC },
          })
        ).invalidatedAt,
      ).not.toBeNull()
      expect(
        await db.recommendationCowatchSuppression.findUnique({
          where: { episodeId: episodeC },
        }),
      ).not.toBeNull()
    }, 15000)
    it("commits each deletion count in the same phase as its rows", async () => {
      const now = new Date(),
        tokenDigest = compositionDigest(randomUUID())
      await db.recommendationViewer.create({
        data: {
          tokenDigest,
          consentReceiptDigest: compositionDigest(randomUUID()),
          expiresAt: new Date(now.getTime() - 1000),
        },
      })
      let runId = "",
        inspected = false
      const observed = db.$extends({
        query: {
          recommendationRetentionRun: {
            async create({ args, query }) {
              const row = await query(args)
              if (!row.id) throw new Error("Owned fixture missing run ID")
              runId = row.id
              return row
            },
          },
          recommendationConsentReceipt: {
            async updateMany({ args, query }) {
              if (!inspected) {
                inspected = true
                expect(
                  await db.recommendationViewer.findUnique({
                    where: { tokenDigest },
                  }),
                ).toBeNull()
                expect(
                  await db.recommendationRetentionRun.findUniqueOrThrow({
                    where: { id: runId },
                  }),
                ).toMatchObject({
                  status: "RUNNING",
                  rowCounts: { expiredViewers: 1 },
                })
              }
              return query(args)
            },
          },
        },
      })
      expect(
        await purgeExpiredRecommendationRequests(
          observed as PrismaClient,
          now,
          500,
        ),
      ).toMatchObject({ status: "succeeded" })
      expect(inspected).toBe(true)
    }, 15000)

    it("preserves durable counts after a committed phase loses its acknowledgement", async () => {
      const f = await fixture(true)
      let lost = false
      const uncertain = new Proxy(db, {
        get(target, key) {
          if (key === "$transaction")
            return async (...args: unknown[]) => {
              const value = await Reflect.apply(
                target.$transaction,
                target,
                args,
              )
              if (
                !lost &&
                (await db.recommendationRequest.count({
                  where: { id: f.requestId },
                })) === 0
              ) {
                lost = true
                throw new Error("owned fixture lost commit acknowledgement")
              }
              return value
            }
          const value = Reflect.get(target, key)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      await expect(
        purgeExpiredRecommendationRequests(uncertain, f.now, 500),
      ).rejects.toThrow("lost commit acknowledgement")
      expect(lost).toBe(true)
      expect(
        await db.recommendationRetentionRun.findFirstOrThrow({
          orderBy: { startedAt: "desc" },
        }),
      ).toMatchObject({
        status: "FAILED",
        rootsDeleted: 1,
        rowCounts: { requests: 1, items: 1 },
      })
    }, 15000)

    it("deduplicates 225 retained outcomes in one private session before dependency admission", async () => {
      const f = await fixture(false)
      const source =
        await db.recommendationCowatchSourceContribution.findFirstOrThrow({
          where: { generationId: f.graphId },
        })
      const outcome = await db.recommendationOutcomeRevision.findUniqueOrThrow({
        where: { id: source.outcomeId },
      })
      const episode = await db.recommendationPlaybackEpisode.findUniqueOrThrow({
        where: { id: outcome.episodeId! },
      })
      const eligibility =
        await db.recommendationEligibilityDecision.findUniqueOrThrow({
          where: { id: source.eligibilityDecisionId },
        })
      const ids = Array.from({ length: 225 }, () => randomUUID())
      await db.recommendationPlaybackEpisode.createMany({
        data: ids.map((id) => ({
          ...episode,
          provenance:
            episode.provenance === null ? Prisma.JsonNull : episode.provenance,
          id,
        })),
      })
      await db.recommendationOutcomeRevision.createMany({
        data: ids.map((id) => ({
          ...outcome,
          activeIntervals:
            outcome.activeIntervals === null
              ? Prisma.DbNull
              : outcome.activeIntervals,
          id,
          episodeId: id,
          supersedesId: null,
        })),
      })
      await db.recommendationEligibilityDecision.createMany({
        data: ids.map((id) => ({
          ...eligibility,
          id,
          sourceKey: id,
          outcomeId: id,
        })),
      })
      await db.recommendationCowatchSourceContribution.createMany({
        data: ids.map((id) => ({
          ...source,
          id,
          outcomeId: id,
          eligibilityDecisionId: id,
        })),
      })
      await db.$transaction(
        (tx) => lockRetentionRoots(tx, { profileIds: [f.profileId] }),
        { timeout: 4000 },
      )
    }, 15000)

    it("waits before evaluation deletion while terminal publication owns its protocol", async () => {
      const f = await fixture(false)
      await db.recommendationShadowEvaluation.update({
        where: { id: f.evaluationId },
        data: { expiresAt: new Date(f.now.getTime() - 1000) },
      })
      const held = latch(),
        proceed = latch(),
        protocolAttempt = latch()
      const publication = db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM recommendation_cowatch_generation WHERE id = ${f.graphId} FOR SHARE`,
          )
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM recommendation_composition_protocol WHERE id = ${f.protocolId}::uuid FOR SHARE`,
          )
          held.release()
          await proceed.promise
          await tx.recommendationShadowEvaluation.update({
            where: { id: f.evaluationId },
            data: { state: "TERMINAL" },
          })
        },
        { timeout: 4000 },
      )
      await held.promise
      const observed = db.$extends({
        query: {
          async $queryRaw({ args, query }) {
            const sql = args
            if (
              sql.sql.includes("recommendation_cowatch_generation") &&
              sql.sql.includes("ORDER BY") &&
              !sql.sql.includes("WITH selected_assignments")
            )
              protocolAttempt.release()
            return query(args)
          },
        },
      })
      const deletion = (observed as PrismaClient).$transaction(
        async (tx) => {
          await lockRetentionRoots(tx, { evaluationIds: [f.evaluationId] })
          await tx.recommendationShadowEvaluation.delete({
            where: { id: f.evaluationId },
          })
        },
        { timeout: 4000 },
      )
      await protocolAttempt.promise
      proceed.release()
      await Promise.all([publication, deletion])
      expect(
        await db.recommendationShadowEvaluation.findUnique({
          where: { id: f.evaluationId },
        }),
      ).toBeNull()
    }, 15000)

    async function assignmentFixture() {
      const id = randomUUID(),
        now = new Date(),
        future = new Date(now.getTime() + day)
      const profile = await db.recommendationProfile.create({
        data: {
          tokenDigest: compositionDigest(id),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt: future,
        },
      })
      await db.recommendationExperiment.create({
        data: {
          id,
          experimentVersion: id,
          surfaceVersion: "owned-retention-lock-order",
          controlManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          assignmentPolicyVersion: "fixture",
          outcomePolicyVersion: "fixture",
          integrityPolicyVersion: "fixture",
          evaluationPolicyVersion: "fixture",
          configurationDigest: compositionDigest(id),
          challengerProbability: 0.5,
          startsAt: new Date(now.getTime() - day),
          endsAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationStudy.create({
        data: {
          experimentId: id,
          protocol: {},
          protocolDigest: compositionDigest(id),
          preparedById: "owned-fixture",
          expiresAt: new Date(now.getTime() - 1000),
        },
      })
      const assignment = await db.recommendationExperimentAssignment.create({
        data: {
          experimentId: id,
          unitKind: "ANONYMOUS_PROFILE",
          unitDigest: compositionDigest(id),
          profileId: profile.id,
          privacyGeneration: 1,
          arm: "CONTROL",
          assignmentProbability: 0.5,
          configurationDigest: compositionDigest(id),
          expiresAt: new Date(now.getTime() - 1000),
        },
      })
      return { id, profileId: profile.id, assignmentId: assignment.id, now }
    }

    it("admits assignment deletion after profile reset without a study/assignment cycle", async () => {
      const f = await assignmentFixture()
      const held = latch(),
        proceed = latch(),
        rootAttempt = latch()
      const privacy = db.$transaction(
        async (tx) => {
          await tx.recommendationProfile.update({
            where: { id: f.profileId },
            data: { privacyGeneration: { increment: 1 } },
          })
          held.release()
          await proceed.promise
          await tx.recommendationExperimentAssignment.update({
            where: { id: f.assignmentId },
            data: {
              state: "FENCED",
              fencedAt: f.now,
              fenceReason: "profile_reset",
            },
          })
        },
        { timeout: 4000 },
      )
      await held.promise
      const observed = db.$extends({
        query: {
          async $queryRaw({ args, query }) {
            const sql = args
            if (
              sql.sql.includes("FROM recommendation_profile") &&
              sql.sql.includes("ORDER BY") &&
              !sql.sql.includes("WITH selected_assignments")
            )
              rootAttempt.release()
            return query(args)
          },
        },
      })
      const deletion = (observed as PrismaClient).$transaction(
        async (tx) => {
          await lockRetentionRoots(tx, { assignmentIds: [f.assignmentId] })
          await tx.recommendationExperimentAssignment.delete({
            where: { id: f.assignmentId },
          })
        },
        { timeout: 4000 },
      )
      await rootAttempt.promise
      proceed.release()
      await Promise.all([privacy, deletion])
      expect(
        await db.recommendationExperimentAssignment.findUnique({
          where: { id: f.assignmentId },
        }),
      ).toBeNull()
    }, 15000)

    it("fails fast instead of deadlocking an emergency rollback that already owns an assignment", async () => {
      const f = await assignmentFixture()
      const held = latch(),
        proceed = latch()
      const rollback = db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM recommendation_experiment_assignment WHERE id = ${f.assignmentId} FOR UPDATE`,
          )
          held.release()
          await proceed.promise
          await tx.recommendationExperimentAssignment.update({
            where: { id: f.assignmentId },
            data: {
              state: "FENCED",
              fencedAt: f.now,
              fenceReason: "kill_switch",
            },
          })
        },
        { timeout: 4000 },
      )
      await held.promise
      try {
        await expect(
          db.$transaction(
            (tx) => lockRetentionRoots(tx, { assignmentIds: [f.assignmentId] }),
            { timeout: 2000 },
          ),
        ).rejects.toThrow(/55P03|could not obtain lock/)
      } finally {
        proceed.release()
      }
      await rollback
      await db.$transaction(async (tx) => {
        await lockRetentionRoots(tx, { experimentIds: [f.id] })
        await tx.recommendationExperiment.delete({ where: { id: f.id } })
      })
    }, 15000)

    it("bounds the whole admitted phase and replaces the timed-out pool1 connection", async () => {
      const single = new PrismaClient({
        adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 1 }),
      })
      let injected = false
      const [originalBackend] = await single.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid() AS pid`,
      )
      const slow = single.$extends({
        query: {
          async $queryRaw({ args, query }) {
            const sql = args
            if (!injected && sql.sql.includes('SELECT run_id AS "runId"')) {
              injected = true
              // Two individually sub-budget statements exceed the transaction budget.
              await query(Prisma.sql`SELECT 1 AS waited FROM pg_sleep(3)`)
              return query(Prisma.sql`SELECT 1 AS waited FROM pg_sleep(3)`)
            }
            return query(args)
          },
        },
      })
      const started = performance.now()
      try {
        await expect(
          purgeExpiredRecommendationRequests(slow as PrismaClient),
        ).rejects.toThrow()
        expect(injected).toBe(true)
        expect(performance.now() - started).toBeLessThan(6000)
        const [replacementBackend] = await single.$queryRaw<
          Array<{ pid: number; healthy: number }>
        >(Prisma.sql`SELECT pg_backend_pid() AS pid, 1 AS healthy`)
        expect(replacementBackend?.healthy).toBe(1)
        expect(replacementBackend?.pid).not.toBe(originalBackend?.pid)
        expect(
          await single.recommendationRetentionRun.findFirstOrThrow({
            orderBy: { startedAt: "desc" },
          }),
        ).toMatchObject({ status: "FAILED" })
        expect(await purgeExpiredRecommendationRequests(single)).toMatchObject({
          status: "succeeded",
        })
      } finally {
        await single.$disconnect()
      }
    }, 15000)
  },
)
