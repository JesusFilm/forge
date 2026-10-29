import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { RecommendationCowatchRefreshService } from "./refresh.service"
import { purgeExpiredCowatchRefreshMetadata } from "./refresh-retention"
import type { CowatchRefreshBudget } from "./refresh-policy"

const day = 86_400_000
const actor = { id: "retirement-operator", role: "ADMIN" } as const
const budget: CowatchRefreshBudget = {
  publicationLimits: {
    rawSourceCount: 50_000,
    sourceCount: 50_000,
    attemptedPairCount: 250_000,
    contributionCount: 250_000,
    edgeCount: 250_000,
    publicationRowCount: 550_001,
    graphRowJsonBytes: {
      sources: { maximum: 2000, total: 100_000_000 },
      contributions: { maximum: 2000, total: 500_000_000 },
      edges: { maximum: 2000, total: 500_000_000 },
    },
  },
  publicationReserveBytes: 1_048_576,
  maxRetainedGraphBytes: 268_435_456,
  maxRetainedGenerations: 64,
  maxDatabaseBytes: 1_099_511_627_776,
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "retired co-watch refresh against PostgreSQL",
  () => {
    const schema = `cowatch_retirement_${Date.now()}`
    let admin: Client
    let connected = false
    let db: PrismaClient
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      connected = true
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schema)
      db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    }, 120_000)
    afterAll(async () => {
      await db?.$disconnect()
      if (connected) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("cannot authorize or restart a retired refresh, even with owner credentials", async () => {
      const service = new RecommendationCowatchRefreshService({ prisma: db })
      await expect(
        service.authorize({
          actor,
          authenticatedAt: new Date(),
          operationId: randomUUID(),
          expectedPointerGeneration: 1,
          budget,
        }),
      ).rejects.toThrow("behavioral_recommendations_retired")
      await expect(service.run()).resolves.toMatchObject({ status: "retired" })
      expect(await db.recommendationCowatchRefreshGrant.count()).toBe(0)
      expect(await db.recommendationCowatchRefreshAttempt.count()).toBe(0)
      expect(await db.recommendationCowatchGeneration.count()).toBe(0)
    })

    it("still purges expired terminal audit metadata while preserving running attempts and graph metadata", async () => {
      const now = new Date(),
        expired = new Date(now.getTime() - 2556 * day)
      const grantData = {
        anchorReleaseId: randomUUID(),
        anchorPointerGeneration: 1,
        influenceFloorGeneration: 0,
        manifestDigest: "a".repeat(64),
        configurationDigest: "b".repeat(64),
        policyVersion: "cowatch-refresh-seven-day-mature-v1",
        budget,
        approvedById: actor.id,
        approvedAt: expired,
        validUntil: new Date(expired.getTime() + 29 * day),
        revokedAt: expired,
        revocationReason: "historical_fixture",
      }
      const terminalGrant = await db.recommendationCowatchRefreshGrant.create({
        data: { ...grantData, id: randomUUID() },
      })
      const runningGrant = await db.recommendationCowatchRefreshGrant.create({
        data: { ...grantData, id: randomUUID() },
      })
      const attemptData = {
        expectedPointerGeneration: 1,
        windowStart: new Date(expired.getTime() - 7 * day - 7 * 3_600_000),
        windowEnd: new Date(expired.getTime() - 7 * 3_600_000),
        evaluationAsOf: expired,
        startedAt: expired,
        leaseUntil: expired,
      }
      await db.recommendationCowatchRefreshAttempt.create({
        data: {
          ...attemptData,
          id: randomUUID(),
          grantId: terminalGrant.id,
          status: "refused",
          completedAt: expired,
          reason: "historical_fixture",
        },
      })
      const pending = await db.recommendationCowatchRefreshAttempt.create({
        data: {
          ...attemptData,
          id: randomUUID(),
          grantId: runningGrant.id,
          status: "running",
        },
      })
      const graph = await db.recommendationCowatchGeneration.create({
        data: {
          id: "c".repeat(64),
          projectionVersion: "historical",
          featureVersion: "historical",
          sourceCount: 0,
          contributionCount: 0,
          edgeCount: 0,
          distinctViewerCount: 0,
          windowEnd: now,
          terminalDecision: "empty",
          decisionReason: "historical_fixture",
          expiresAt: new Date(now.getTime() + day),
        },
      })
      await expect(
        db.$transaction((tx) => purgeExpiredCowatchRefreshMetadata(tx, now)),
      ).resolves.toEqual({ attempts: 1, grants: 1 })
      expect(
        await db.recommendationCowatchRefreshAttempt.findUnique({
          where: { id: pending.id },
        }),
      ).not.toBeNull()
      expect(
        await db.recommendationCowatchRefreshGrant.findUnique({
          where: { id: runningGrant.id },
        }),
      ).not.toBeNull()
      expect(
        await db.recommendationCowatchGeneration.findUnique({
          where: { id: graph.id },
        }),
      ).not.toBeNull()
    })
  },
)
