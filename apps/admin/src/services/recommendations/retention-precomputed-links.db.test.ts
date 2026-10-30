import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "./current-schema.test-fixture"
import {
  purgeExpiredRecommendationRequests,
  readRecommendationRetentionHealth,
} from "./retention.service"

const day = 86_400_000

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "precomputed retention links on PostgreSQL",
  () => {
    const schema = `precomputed_retention_${randomUUID().replaceAll("-", "")}`
    let sql: Client
    let db: PrismaClient
    const generationIds: string[] = []
    const experimentIds: string[] = []
    const requestIds: string[] = []

    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_test database required")
      sql = new Client({ connectionString: url.toString() })
      await sql.connect()
      await sql.query(`CREATE SCHEMA "${schema}"`)
      await sql.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await sql.query(migration)
      url.searchParams.set("schema", schema)
      db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    }, 120_000)

    afterAll(async () => {
      await db?.$disconnect()
      if (sql) {
        await sql.query("RESET search_path")
        await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await sql.end()
      }
    })

    afterEach(async () => {
      if (!db) return
      await db.recommendationRequest.deleteMany({
        where: { id: { in: requestIds.splice(0) } },
      })
      await db.recommendationPrecomputedVisit.deleteMany({
        where: { experimentId: { in: experimentIds } },
      })
      await db.recommendationPrecomputedExperiment.deleteMany({
        where: { id: { in: experimentIds.splice(0) } },
      })
      await db.recommendationPrecomputedGeneration.deleteMany({
        where: { id: { in: generationIds.splice(0) } },
      })
    })

    async function generation(now: Date) {
      const build = await db.recommendationPrecomputedGeneration.create({
        data: {
          id: `retention-generation-${randomUUID()}`,
          modelId: "fixture-astra",
          promptVersion: "fixture-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: now,
          expectedSourceCount: 0,
          status: "complete",
          completedAt: now,
        },
      })
      generationIds.push(build.id)
      return build
    }

    async function experiment(
      generationId: string,
      now: Date,
      expiresAt: Date,
      window: "historical" | "active" = "historical",
    ) {
      const config = await db.recommendationPrecomputedExperiment.create({
        data: {
          id: `retention-experiment-${randomUUID()}`,
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
          startsAt: new Date(
            now.getTime() - (window === "active" ? 31 : 400) * day,
          ),
          endsAt: new Date(
            now.getTime() + (window === "active" ? 1 : -399) * day,
          ),
          expiresAt,
        },
      })
      experimentIds.push(config.id)
      return config
    }

    it("archives a clicked linked visit before its expired request when an older empty visit fills the page", async () => {
      const now = new Date()
      const build = await generation(now)
      const config = await experiment(
        build.id,
        now,
        new Date(now.getTime() + day),
        "active",
      )
      const emptyId = randomUUID()
      const clickedId = randomUUID()
      const requestId = `retention-request-${randomUUID()}`
      requestIds.push(requestId)
      const selectionAt = new Date(now.getTime() - 28 * day)
      const requestExpiry = new Date(now.getTime() - day)
      await db.recommendationPrecomputedVisit.createMany({
        data: [
          {
            id: emptyId,
            experimentId: config.id,
            sourceVideoId: "fixture-video",
            locale: "en",
            audioLanguageSlug: "english",
            eligibility: "excluded",
            qualification: "unknown_signal",
            exclusionReason: "traffic_unqualified",
            createdAt: new Date(now.getTime() - 30 * day),
            expiresAt: new Date(now.getTime() - 3 * day),
          },
          {
            id: clickedId,
            experimentId: config.id,
            sourceVideoId: "fixture-video",
            locale: "en",
            audioLanguageSlug: "english",
            eligibility: "eligible",
            qualification: "unverified_browser",
            browserUnitDigest: "f".repeat(64),
            arm: "CONTROL",
            createdAt: new Date(now.getTime() - 29 * day),
            expiresAt: new Date(now.getTime() - 2 * day),
          },
        ],
      })
      await db.$transaction(async (tx) => {
        await tx.recommendationRequest.create({
          data: {
            id: requestId,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId: "semantic-transcript-pgvector-v1",
            strategyVersion: "semantic-transcript-pgvector-v1",
            classifierVersion: "legacy-position-v0",
            sessionDigest: "1".repeat(64),
            locale: "en",
            seedMediaId: "fixture-video",
            expectedItemCount: 1,
            state: "ISSUED",
            result: "SERVED",
            deliveryJti: randomUUID(),
            signingKid: "fixture",
            createdAt: selectionAt,
            issuedAt: selectionAt,
            expiresAt: requestExpiry,
          },
        })
        const item = await tx.recommendationServedItem.create({
          data: {
            requestId,
            position: 0,
            targetMediaId: "fixture-target",
            canonicalHref: "/watch/fixture-target.html",
            candidateGenerator: "semantic",
            candidateProvenance: {},
            expiresAt: requestExpiry,
          },
        })
        await tx.recommendationPrecomputedVisitRequest.create({
          data: {
            requestId,
            visitId: clickedId,
            createdAt: selectionAt,
            expiresAt: new Date(now.getTime() - 2 * day),
          },
        })
        await tx.recommendationSelection.create({
          data: {
            requestId,
            itemId: item.id,
            capabilityJti: randomUUID(),
            eventId: randomUUID(),
            payloadDigest: "2".repeat(64),
            claimNonceDigest: "3".repeat(64),
            handoffExpiresAt: requestExpiry,
            occurredAt: selectionAt,
            receivedAt: selectionAt,
            expiresAt: requestExpiry,
          },
        })
      })
      const result = await purgeExpiredRecommendationRequests(db, now, 1)
      expect(result.status).toBe("succeeded")
      expect(
        await db.recommendationRequest.findUnique({ where: { id: requestId } }),
      ).toBeNull()
      expect(
        await db.recommendationPrecomputedVisit.findUnique({
          where: { id: clickedId },
        }),
      ).toBeNull()
      expect(
        await db.recommendationPrecomputedVisit.findUnique({
          where: { id: emptyId },
        }),
      ).not.toBeNull()
      expect(
        await db.recommendationPrecomputedCtrCluster.findUnique({
          where: {
            experimentId_browserUnitDigest: {
              experimentId: config.id,
              browserUnitDigest: "f".repeat(64),
            },
          },
        }),
      ).toMatchObject({ eligibleVisits: 1n, clickedVisits: 1n })
    }, 30_000)

    it("reports the remaining expired precomputed visit after capped cleanup and clears health when drained", async () => {
      const now = new Date()
      const olderExpiry = new Date(now.getTime() - 3 * day)
      const remainingExpiry = new Date(now.getTime() - 2 * day)
      const build = await generation(now)
      const config = await experiment(
        build.id,
        now,
        new Date(now.getTime() + day),
      )
      await db.recommendationPrecomputedVisit.createMany({
        data: [olderExpiry, remainingExpiry].map((expiresAt, index) => ({
          id: randomUUID(),
          experimentId: config.id,
          sourceVideoId: "fixture-video",
          locale: "en",
          audioLanguageSlug: "english",
          eligibility: "excluded",
          qualification: "unknown_signal",
          exclusionReason: "traffic_unqualified",
          createdAt: new Date(now.getTime() - (30 - index) * day),
          expiresAt,
        })),
      })
      const first = await purgeExpiredRecommendationRequests(db, now, 1)
      expect(first).toMatchObject({
        status: "succeeded",
        rowCounts: { expiredPrecomputedVisits: 1 },
        batchLimitReached: true,
        overdueAfterRun: true,
        oldestExpiredAtAfter: remainingExpiry.toISOString(),
      })
      expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
        healthy: false,
        reason: "retention_overdue",
        oldestOverdueAt: remainingExpiry,
      })
      const second = await purgeExpiredRecommendationRequests(
        db,
        new Date(now.getTime() + 1),
        1,
      )
      expect(second).toMatchObject({
        status: "succeeded",
        rowCounts: { expiredPrecomputedVisits: 1 },
        overdueAfterRun: false,
        oldestExpiredAtAfter: null,
      })
      expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
        healthy: true,
        reason: "healthy",
        oldestOverdueAt: null,
      })
    }, 30_000)

    it("reports the remaining expired precomputed configuration after capped cleanup and clears health when drained", async () => {
      const now = new Date()
      const olderExpiry = new Date(now.getTime() - 3 * day)
      const remainingExpiry = new Date(now.getTime() - 2 * day)
      const build = await generation(now)
      await experiment(build.id, now, olderExpiry)
      await experiment(build.id, now, remainingExpiry)
      const first = await purgeExpiredRecommendationRequests(db, now, 1)
      expect(first).toMatchObject({
        status: "succeeded",
        rowCounts: { expiredPrecomputedExperiments: 1 },
        batchLimitReached: true,
        overdueAfterRun: true,
        oldestExpiredAtAfter: remainingExpiry.toISOString(),
      })
      expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
        healthy: false,
        reason: "retention_overdue",
        oldestOverdueAt: remainingExpiry,
      })
      const second = await purgeExpiredRecommendationRequests(
        db,
        new Date(now.getTime() + 1),
        1,
      )
      expect(second).toMatchObject({
        status: "succeeded",
        rowCounts: { expiredPrecomputedExperiments: 1 },
        overdueAfterRun: false,
        oldestExpiredAtAfter: null,
      })
      expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
        healthy: true,
        reason: "healthy",
        oldestOverdueAt: null,
      })
    }, 30_000)
  },
)
