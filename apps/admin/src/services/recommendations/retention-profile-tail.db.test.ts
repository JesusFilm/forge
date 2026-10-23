import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { nominations } from "./composition/test-helpers"
import {
  purgeExpiredRecommendationRequests,
  readRecommendationRetentionHealth,
  WATCH_EXPOSURE_RETENTION_PAGE_SIZE,
} from "./retention.service"

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

    it("manual mode finalizes baseline reports only for elapsed stored expiry", async () => {
      const now = new Date()
      const untouchedId = randomUUID()
      const expiringId = randomUUID()
      const visitId = randomUUID()
      const startsAt = new Date(now.getTime() - 40 * 86_400_000)
      const endsAt = new Date(now.getTime() - 35 * 86_400_000)
      const expiresAt = new Date(now.getTime() + 60 * 86_400_000)
      await db.recommendationPrecomputedBaselineRun.createMany({
        data: [
          { id: untouchedId, enabled: true },
          { id: expiringId, enabled: false },
        ].map((run) => ({
          ...run,
          verificationAuthority: "isolated_fixture",
          startsAt,
          endsAt,
          controlRoutingDigest: digest(run.id),
          actorId: "owned-retention-test",
          expiresAt,
        })),
      })
      await db.recommendationPrecomputedBaselineVisit.create({
        data: {
          id: visitId,
          runId: expiringId,
          browserUnitDigest: digest(visitId),
          sourceVideoId: "owned-fixture-video",
          locale: "en",
          audioLanguageSlug: "english",
          deliveryResult: "unavailable",
          createdAt: new Date(now.getTime() - 36 * 86_400_000),
          expiresAt: new Date(now.getTime() - 60_000),
        },
      })
      try {
        const result = await purgeExpiredRecommendationRequests(
          db,
          now,
          1,
          "stored-expiry-only",
        )
        expect(result.status).toBe("succeeded")
        expect(result.rowCounts.expiredPrecomputedBaselineVisits).toBe(1)
        expect(
          await db.recommendationPrecomputedBaselineRun.findUniqueOrThrow({
            where: { id: untouchedId },
            select: { enabled: true, finalReport: true },
          }),
        ).toEqual({ enabled: true, finalReport: null })
        expect(
          await db.recommendationPrecomputedBaselineRun.findUniqueOrThrow({
            where: { id: expiringId },
            select: { finalReport: true },
          }),
        ).toEqual({ finalReport: expect.objectContaining({ isFinal: true }) })
        expect(
          await db.recommendationPrecomputedBaselineVisit.count({
            where: { id: visitId },
          }),
        ).toBe(0)
      } finally {
        await db.recommendationPrecomputedBaselineVisit.deleteMany({
          where: { id: visitId },
        })
        await db.recommendationPrecomputedBaselineRun.deleteMany({
          where: { id: { in: [untouchedId, expiringId] } },
        })
      }
    })

    it("manual mode removes only eligible expired generation proofs", async () => {
      const now = new Date()
      const [
        eligibleId,
        snapshotHeldId,
        artifactHeldId,
        importHeldId,
        futureId,
      ] = Array.from({ length: 5 }, () => randomUUID())
      const allIds = [
        eligibleId,
        snapshotHeldId,
        artifactHeldId,
        importHeldId,
        futureId,
      ]
      const snapshotSha256 = digest(randomUUID())
      await db.recommendationPrecomputedGenerationRetentionProof.createMany({
        data: allIds.map((generationId) => ({
          generationId,
          generationProtocolVersion: 1,
          inputCutoff: now,
          inputDigest: digest(generationId),
          inputMode: "fixture",
          state: "retired",
          recordedAt: new Date(now.getTime() - 120_000),
          expiresAt: new Date(
            now.getTime() + (generationId === futureId ? 60_000 : -60_000),
          ),
          snapshotSha256:
            generationId === snapshotHeldId ? snapshotSha256 : null,
        })),
      })
      await db.recommendationPrecomputedGaCaptureArtifact.create({
        data: {
          generationId: artifactHeldId,
          artifactSha256: snapshotSha256,
          storageKey: "owned-test-artifact",
          artifactBytes: 1n,
        },
      })
      await db.recommendationPrecomputedGaCaptureImport.create({
        data: {
          destinationGenerationId: importHeldId,
          destinationIdentity: {},
          preparedDigest: digest(importHeldId),
          originGenerationId: randomUUID(),
          originIdentity: {},
          originProofDigest: digest(randomUUID()),
          copyRequestDigest: digest(randomUUID()),
          copyAttemptId: randomUUID(),
          artifactSha256: snapshotSha256,
          artifactBytes: 13n,
          storageKey: "owned-bound-test-artifact",
          state: "bound",
          stagingDeadlineAt: new Date(now.getTime() + 60_000),
          confirmedAt: now,
          boundAt: now,
        },
      })
      try {
        const result = await purgeExpiredRecommendationRequests(
          db,
          now,
          1,
          "stored-expiry-only",
        )
        expect(result.status).toBe("succeeded")
        expect(result.rowCounts.precomputedGenerationProofsExpired).toBe(1)
        expect(
          await db.recommendationPrecomputedGenerationRetentionProof.findMany({
            where: { generationId: { in: allIds } },
            select: { generationId: true },
          }),
        ).toEqual(
          expect.arrayContaining(
            [snapshotHeldId, artifactHeldId, importHeldId, futureId].map(
              (generationId) => ({ generationId }),
            ),
          ),
        )
        expect(
          await db.recommendationPrecomputedGenerationRetentionProof.count({
            where: { generationId: eligibleId },
          }),
        ).toBe(0)
      } finally {
        await db.recommendationPrecomputedGaCaptureImport.deleteMany({
          where: { destinationGenerationId: importHeldId },
        })
        await db.recommendationPrecomputedGaCaptureArtifact.deleteMany({
          where: { generationId: artifactHeldId },
        })
        await db.recommendationPrecomputedGenerationRetentionProof.deleteMany({
          where: { generationId: { in: allIds } },
        })
      }
    })

    it("manual mode deletes stored-expired exposures but preserves age-only orphan vectors", async () => {
      const now = new Date()
      const expiredId = randomUUID()
      const futureId = randomUUID()
      const digestValue = digest(randomUUID())
      const pendingProfileId = randomUUID()
      await db.watchSurfaceExposure.createMany({
        data: [expiredId, futureId].map((id, index) => ({
          id,
          eventId: randomUUID(),
          windowId: randomUUID(),
          surface: "watch",
          block: "fixture",
          presentation: "rail",
          placement: "related",
          policyVersion: "watch-exposure-v2",
          position: index,
          itemPath: `/watch/${id}.html`,
          kind: "served",
          occurredAt: new Date(now.getTime() - 30 * 86_400_000),
          expiresAt: new Date(now.getTime() + (index ? 60_000 : -60_000)),
        })),
      })
      await db.$executeRaw`
        INSERT INTO recommendation_profile_vector_snapshot (digest, embedding, created_at)
        VALUES (${digestValue}, ('[' || array_to_string(array_fill(0, ARRAY[1536]), ',') || ']')::vector,
                ${new Date(now.getTime() - 48 * 3_600_000)})
      `
      await db.recommendationProfile.create({
        data: {
          id: pendingProfileId,
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          state: "TOMBSTONED",
          tombstonedAt: new Date(now.getTime() - 48 * 3_600_000),
          tombstoneReason: "delete",
          erasureState: "PENDING",
          erasureRequestedAt: new Date(now.getTime() - 48 * 3_600_000),
          expiresAt: new Date(now.getTime() + 60_000),
        },
      })
      try {
        const result = await purgeExpiredRecommendationRequests(
          db,
          now,
          1,
          "stored-expiry-only",
        )
        expect(result.status).toBe("succeeded")
        expect(result.rowCounts.expiredWatchSurfaceExposures).toBe(1)
        expect(
          await db.watchSurfaceExposure.count({
            where: { id: { in: [expiredId, futureId] } },
          }),
        ).toBe(1)
        expect(
          await db.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*) AS count FROM recommendation_profile_vector_snapshot
            WHERE digest = ${digestValue}
          `,
        ).toEqual([{ count: 1n }])
        expect(
          await db.recommendationProfile.findUnique({
            where: { id: pendingProfileId },
            select: { erasureState: true },
          }),
        ).toEqual({ erasureState: "PENDING" })
      } finally {
        await db.watchSurfaceExposure.deleteMany({
          where: { id: { in: [expiredId, futureId] } },
        })
        await db.$executeRaw`
          DELETE FROM recommendation_profile_vector_snapshot WHERE digest = ${digestValue}
        `
        await db.recommendationProfile.deleteMany({
          where: { id: pendingProfileId },
        })
      }
    })

    it("rolls back a genuine exposure timeout and keeps the durable attempt failed", async () => {
      const now = new Date()
      const id = randomUUID()
      await db.watchSurfaceExposure.create({
        data: {
          id,
          eventId: randomUUID(),
          windowId: randomUUID(),
          surface: "watch",
          block: "fixture",
          presentation: "rail",
          placement: "related",
          policyVersion: "watch-exposure-v2",
          position: 0,
          itemPath: `/watch/${id}.html`,
          kind: "served",
          occurredAt: now,
          expiresAt: new Date(now.getTime() - 60_000),
        },
      })
      const before = await db.recommendationRetentionRun.findFirst({
        where: { status: "SUCCEEDED" },
        orderBy: { completedAt: "desc" },
      })
      await db.$executeRawUnsafe(`
        CREATE FUNCTION owned_retention_slow_exposure() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(6); RETURN OLD; END $$
      `)
      await db.$executeRawUnsafe(`
        CREATE TRIGGER owned_retention_slow_exposure
        BEFORE DELETE ON watch_surface_exposure
        FOR EACH ROW EXECUTE FUNCTION owned_retention_slow_exposure()
      `)
      try {
        await expect(
          purgeExpiredRecommendationRequests(db, now),
        ).rejects.toThrow(/transaction|deadline|timeout/i)
        expect(await db.watchSurfaceExposure.count({ where: { id } })).toBe(1)
        expect(
          await db.recommendationRetentionRun.findFirstOrThrow({
            orderBy: { startedAt: "desc" },
          }),
        ).toMatchObject({ status: "FAILED", rootsDeleted: 0 })
        const after = await db.recommendationRetentionRun.findFirst({
          where: { status: "SUCCEEDED" },
          orderBy: { completedAt: "desc" },
        })
        expect(after?.completedAt ?? null).toEqual(before?.completedAt ?? null)
      } finally {
        await db.$executeRawUnsafe(
          "DROP TRIGGER IF EXISTS owned_retention_slow_exposure ON watch_surface_exposure",
        )
        await db.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS owned_retention_slow_exposure()",
        )
        await db.watchSurfaceExposure.deleteMany({ where: { id } })
      }
    })

    it("drains flat exposure pages independently while preserving unexpired facts and truthful ledgers", async () => {
      const now = new Date()
      const expiredAt = new Date(now.getTime() - 25 * 60 * 60_000)
      const futureExpiry = new Date(now.getTime() + 29 * 86_400_000)
      const windowId = randomUUID()
      const ids = Array.from(
        { length: WATCH_EXPOSURE_RETENTION_PAGE_SIZE + 3 },
        () => randomUUID(),
      )
      await db.watchSurfaceExposure.createMany({
        data: ids.map((id, index) => ({
          id,
          eventId: randomUUID(),
          windowId,
          surface: "watch",
          block: "fixture",
          presentation: "rail",
          placement: "related",
          policyVersion: "watch-exposure-v2",
          position: index % 7,
          itemPath: `/watch/${id}.html`,
          kind: index % 2 === 0 ? "served" : "rendered",
          occurredAt: new Date(now.getTime() - 29 * 86_400_000),
          expiresAt:
            index <= WATCH_EXPOSURE_RETENTION_PAGE_SIZE
              ? expiredAt
              : futureExpiry,
        })),
      })
      try {
        expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
          healthy: false,
          reason: "retention_overdue",
          oldestOverdueAt: expiredAt,
        })
        const first = await purgeExpiredRecommendationRequests(db, now, 1)
        expect(first).toMatchObject({
          status: "succeeded",
          rootsDeleted: 0,
          rowCounts: {
            expiredWatchSurfaceExposures: WATCH_EXPOSURE_RETENTION_PAGE_SIZE,
          },
          batchLimitReached: true,
          overdueAfterRun: true,
        })
        expect(
          await db.recommendationRetentionRun.findUniqueOrThrow({
            where: { id: first.runId },
          }),
        ).toMatchObject({
          status: "SUCCEEDED",
          rootsDeleted: 0,
          rowCounts: first.rowCounts,
        })
        const second = await purgeExpiredRecommendationRequests(db, now, 1)
        expect(second).toMatchObject({
          status: "succeeded",
          rowCounts: { expiredWatchSurfaceExposures: 1 },
          batchLimitReached: false,
          overdueAfterRun: false,
        })
        expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
          healthy: true,
          oldestOverdueAt: null,
        })
        expect(
          await db.watchSurfaceExposure.findMany({
            where: { id: { in: ids } },
            select: { expiresAt: true },
          }),
        ).toEqual([{ expiresAt: futureExpiry }, { expiresAt: futureExpiry }])
      } finally {
        await db.watchSurfaceExposure.deleteMany({ where: { windowId } })
      }
    })

    it("continues bounded projection-run expiry after request roots drain", async () => {
      const now = new Date()
      const expiredAt = new Date(now.getTime() - 60_000)
      const createdAt = new Date(now.getTime() - 120_000)
      const manifestId = randomUUID()
      const requestId = randomUUID()
      const exposureWindowId = randomUUID()
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
        await db.watchSurfaceExposure.createMany({
          data: Array.from(
            { length: WATCH_EXPOSURE_RETENTION_PAGE_SIZE },
            () => {
              const id = randomUUID()
              return {
                id,
                eventId: randomUUID(),
                windowId: exposureWindowId,
                surface: "watch",
                block: "fixture",
                presentation: "rail",
                placement: "related",
                policyVersion: "watch-exposure-v2",
                position: 0,
                itemPath: `/watch/${id}.html`,
                kind: "served",
                occurredAt: createdAt,
                expiresAt: expiredAt,
              }
            },
          ),
        })

        const first = await purgeExpiredRecommendationRequests(db, now, 100)
        expect(first.status).toBe("succeeded")
        expect(first.rootsDeleted).toBe(1)
        expect(first.rowCounts.items).toBe(1)
        expect(first.rowCounts.expiredWatchSurfaceExposures).toBe(
          WATCH_EXPOSURE_RETENTION_PAGE_SIZE,
        )
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
        await db.watchSurfaceExposure.deleteMany({
          where: { windowId: exposureWindowId },
        })
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
