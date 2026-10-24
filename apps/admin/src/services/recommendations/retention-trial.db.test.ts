import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { compositionDigest } from "./composition/policy"
import {
  purgeExpiredRecommendationRequests,
  readRecommendationRetentionHealth,
} from "./retention.service"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "trial authority retention in PostgreSQL",
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
    it("drains expired aggregate tombstones in bounded batches and includes backlog in health", async () => {
      const prefix = randomUUID(),
        now = new Date(),
        day = 86_400_000
      const rawPopulationExpiresAt = new Date(now.getTime() - 2 * day)
      await db.recommendationCowatchTrialAuthority.createMany({
        data: Array.from({ length: 501 }, (_, index) => ({
          generationId: compositionDigest([prefix, index]),
          bindingDigest: compositionDigest(prefix),
          binding: { fixture: "expired-aggregate-no-viewer-identity" },
          qualifiedAt: new Date(now.getTime() - 5 * day),
          trialValidUntil: new Date(now.getTime() - 4 * day),
          dependencyExpiresAt: new Date(now.getTime() - 3 * day),
          rawPopulationExpiresAt,
        })),
      })
      const first = await purgeExpiredRecommendationRequests(db, now, 1_000)
      expect(first).toMatchObject({
        status: "succeeded",
        batchLimitReached: true,
        overdueAfterRun: true,
        rowCounts: { expiredCowatchTrialAuthorities: 500 },
      })
      expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
        healthy: false,
        reason: "retention_overdue",
      })
      const second = await purgeExpiredRecommendationRequests(
        db,
        new Date(now.getTime() + 1),
        1_000,
      )
      expect(second).toMatchObject({
        status: "succeeded",
        batchLimitReached: false,
        overdueAfterRun: false,
        rowCounts: { expiredCowatchTrialAuthorities: 1 },
      })
      expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
        healthy: true,
      })
    }, 30_000)
  },
)
