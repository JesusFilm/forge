import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { nominations } from "./composition/test-helpers"
import { purgeExpiredRecommendationRequests } from "./retention.service"

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "recommendation retention profile tail on PostgreSQL",
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

    it("continues bounded projection-run expiry after request roots drain", async () => {
      const now = new Date()
      const expiredAt = new Date(now.getTime() - 60_000)
      const createdAt = new Date(now.getTime() - 120_000)
      const manifestId = randomUUID()
      const requestId = randomUUID()
      const runIds = Array.from({ length: 250 }, () => randomUUID())
      await db.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: manifestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 1,
        },
      })
      try {
        await db.$transaction(async (tx) => {
          await tx.recommendationRequest.create({
            data: {
              id: requestId,
              contractVersion: "semantic-recommendation-v1",
              surfaceVersion: "watch-below-player-v1",
              manifestId,
              strategyVersion: manifestId,
              classifierVersion: "fixture",
              sessionDigest: digest(requestId),
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
              expiresAt: expiredAt,
            },
          })
        })
        await db.recommendationProfileProjectionRun.createMany({
          data: runIds.map((id) => ({
            id,
            scope: "SESSION",
            sessionDigest: digest(id),
            state: "COMPLETED",
            completedAt: createdAt,
            expiresAt: expiredAt,
            createdAt,
          })),
        })

        const first = await purgeExpiredRecommendationRequests(db, now, 100)
        expect(first.status).toBe("succeeded")
        expect(first.rootsDeleted).toBe(1)
        expect(first.rowCounts.items).toBe(1)
        expect(first.rowCounts.expiredProfileProjectionRuns).toBe(100)
        expect(first.batchLimitReached).toBe(true)
        expect(
          await db.recommendationProfileProjectionRun.count({
            where: { id: { in: runIds } },
          }),
        ).toBe(150)

        const second = await purgeExpiredRecommendationRequests(db, now, 100)
        expect(second.status).toBe("succeeded")
        expect(second.rootsDeleted).toBe(0)
        expect(second.rowCounts.expiredProfileProjectionRuns).toBe(100)
        expect(second.batchLimitReached).toBe(true)

        const third = await purgeExpiredRecommendationRequests(db, now, 100)
        expect(third.status).toBe("succeeded")
        expect(third.rootsDeleted).toBe(0)
        expect(third.rowCounts.expiredProfileProjectionRuns).toBe(50)
        expect(third.batchLimitReached).toBe(false)
        expect(
          await db.recommendationProfileProjectionRun.count({
            where: { id: { in: runIds } },
          }),
        ).toBe(0)
      } finally {
        await db.recommendationProfileProjectionRun.deleteMany({
          where: { id: { in: runIds } },
        })
        await db.recommendationRequest.deleteMany({ where: { id: requestId } })
        // Strategy manifests are immutable; this one belongs to the disposable
        // loopback database, while the mutable fixture rows are removed above.
      }
    })

    it("drains expiring generation children without a large cascade or early run deletion", async () => {
      const now = new Date()
      const createdAt = new Date(now.getTime() - 120_000)
      const expiredAt = new Date(now.getTime() - 60_000)
      const futureRunExpiry = new Date(now.getTime() + 3_600_000)
      const tag = randomUUID().slice(0, 8)
      const manifestId = randomUUID()
      const vectorDigest = digest(`vector-${tag}`)
      const generationIds = Array.from(
        { length: 4 },
        (_, index) => `tail-${tag}-generation-${index}`,
      )
      const runIds = generationIds.map(() => randomUUID())
      const requestIds = Array.from({ length: 120 }, () => randomUUID())
      await db.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: manifestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 1,
        },
      })
      const vector = `[1,${Array(1535).fill("0").join(",")}]`
      await db.$executeRaw`
        INSERT INTO recommendation_profile_vector_snapshot (digest, embedding, created_at)
        VALUES (${vectorDigest}, ${vector}::vector, ${now})
      `
      try {
        await db.recommendationProfileProjectionGeneration.createMany({
          data: generationIds.map((id) => ({
            id,
            manifestId,
            scope: "SESSION" as const,
            sessionDigest: digest(id),
            generation: 1,
            projectionVersion: "fixture",
            clusteringVersion: "fixture",
            eligibilityPolicyVersion: "fixture",
            outcomeClassifierVersion: "fixture",
            inputWindowStart: createdAt,
            inputWindowEnd: expiredAt,
            inputDigest: digest(`input-${id}`),
            retentionDays: 1,
            createdAt,
            expiresAt: expiredAt,
          })),
        })
        await db.recommendationProfileProjectionContribution.createMany({
          data: generationIds.flatMap((generationId, generationIndex) =>
            Array.from({ length: 64 }, (_, contributionIndex) => {
              const id = `tail-${tag}-g${generationIndex}-c${String(contributionIndex).padStart(3, "0")}`
              return {
                id,
                generationId,
                kind: "EXPLICIT_PREFERENCE" as const,
                sourceIdDigest: digest(id),
                targetMediaId: "fixture-media",
                weight: 0.5,
                occurredAt: createdAt,
                createdAt,
                expiresAt: expiredAt,
              }
            }),
          ),
        })
        await db.recommendationProfileInterest.createMany({
          data: generationIds.map((generationId) => ({
            generationId,
            kind: "SESSION" as const,
            interestOrdinal: 0,
            medoidMediaId: "fixture-media",
            medoidSourceDigest: digest(generationId),
            vectorDigest,
            weight: 0.5,
            supportCount: 1,
            stability: 1,
            createdAt,
            expiresAt: expiredAt,
          })),
        })
        await db.recommendationProfileProjectionRun.createMany({
          data: generationIds.map((generationId, index) => ({
            id: runIds[index]!,
            scope: "SESSION" as const,
            sessionDigest: digest(generationId),
            state: "COMPLETED" as const,
            projectionId: generationId,
            completedAt: createdAt,
            createdAt,
            expiresAt: futureRunExpiry,
          })),
        })
        await db.recommendationRequest.createMany({
          data: requestIds.map((id) => ({
            id,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId,
            strategyVersion: manifestId,
            classifierVersion: "fixture",
            sessionDigest: digest(id),
            locale: "en",
            seedMediaId: "fixture-seed",
            expectedItemCount: 0,
            state: "ISSUED" as const,
            result: "EMPTY" as const,
            deliveryJti: randomUUID(),
            signingKid: "fixture",
            issuedAt: now,
            createdAt: now,
            expiresAt: futureRunExpiry,
          })),
        })
        await db.recommendationPersonalizationDecision.createMany({
          data: requestIds.map((requestId) => ({
            requestId,
            effectiveManifestId: manifestId,
            lane: "profile_challenger",
            projectionGenerationId: generationIds[0],
            projectionScope: "session",
            projectionVersion: "fixture",
            projectionGenerationNumber: 1,
            interestCount: 1,
            expiresAt: futureRunExpiry,
          })),
        })

        const first = await purgeExpiredRecommendationRequests(db, now, 100)
        expect(first.status).toBe("succeeded")
        expect(first.rootsDeleted).toBe(0)
        expect(first.rowCounts.expiredProfileProjectionContributions).toBe(100)
        expect(first.rowCounts.expiredProfileInterests).toBe(4)
        expect(first.rowCounts.expiredProjectionRunLinksUnlinked).toBe(4)
        expect(first.rowCounts.expiredProjectionDecisionLinksUnlinked).toBe(100)
        expect(first.rowCounts.expiredProfileProjectionGenerations).toBe(0)
        expect(first.batchLimitReached).toBe(true)
        expect(
          await db.recommendationProfileProjectionContribution.count({
            where: { generationId: { in: generationIds } },
          }),
        ).toBe(156)
        expect(
          await db.recommendationProfileProjectionRun.count({
            where: { id: { in: runIds }, projectionId: null },
          }),
        ).toBe(4)
        expect(
          await db.recommendationPersonalizationDecision.count({
            where: {
              requestId: { in: requestIds },
              projectionGenerationId: null,
            },
          }),
        ).toBe(100)

        const second = await purgeExpiredRecommendationRequests(db, now, 100)
        expect(second.status).toBe("succeeded")
        expect(second.rowCounts.expiredProfileProjectionContributions).toBe(100)
        expect(second.rowCounts.expiredProjectionDecisionLinksUnlinked).toBe(20)
        expect(second.rowCounts.expiredProfileProjectionGenerations).toBe(3)
        expect(second.batchLimitReached).toBe(true)
        const third = await purgeExpiredRecommendationRequests(db, now, 100)
        expect(third.status).toBe("succeeded")
        expect(third.rowCounts.expiredProfileProjectionContributions).toBe(56)
        expect(third.batchLimitReached).toBe(false)
        expect(
          await db.recommendationProfileProjectionGeneration.count({
            where: { id: { in: generationIds } },
          }),
        ).toBe(0)
        expect(
          await db.recommendationProfileProjectionRun.count({
            where: { id: { in: runIds } },
          }),
        ).toBe(4)
        expect(
          await db.recommendationRequest.count({
            where: { id: { in: requestIds } },
          }),
        ).toBe(120)
        expect(
          await db.recommendationPersonalizationDecision.count({
            where: {
              requestId: { in: requestIds },
              projectionGenerationId: null,
              lane: "profile_challenger",
              projectionScope: "session",
              projectionVersion: "fixture",
              projectionGenerationNumber: 1,
            },
          }),
        ).toBe(120)
      } finally {
        await db.recommendationRequest.deleteMany({
          where: { id: { in: requestIds } },
        })
        await db.recommendationProfileProjectionRun.deleteMany({
          where: { id: { in: runIds } },
        })
        await db.recommendationProfileProjectionGeneration.deleteMany({
          where: { id: { in: generationIds } },
        })
        await db.recommendationProfileVectorSnapshot.deleteMany({
          where: { digest: vectorDigest },
        })
      }
    })
  },
)
