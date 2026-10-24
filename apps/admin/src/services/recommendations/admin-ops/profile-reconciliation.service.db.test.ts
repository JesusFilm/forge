import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { recommendationRuntimeMigrationSql } from "../current-schema.test-fixture"
import { loadRecommendationProfileReconciliationOverview } from "./profile-reconciliation.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const recommendationMigrations = recommendationRuntimeMigrationSql

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Admin profile reconciliation overview against PostgreSQL",
  () => {
    const schema = `recommendation_profile_ops_${Date.now()}`
    let admin: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of recommendationMigrations) {
        await admin.query(migration)
      }
      const fixtureUrl = new URL(env.DATABASE_URL)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!admin) return
      await admin.query("RESET search_path")
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    })

    it("executes the shared fail-closed audit and reports an empty cohort as healthy", async () => {
      const now = new Date("2026-09-06T23:30:00.000Z")
      await expect(
        loadRecommendationProfileReconciliationOverview(
          prisma,
          {
            preset: "24h",
            start: new Date(now.getTime() - 86_400_000),
            end: now,
          },
          now,
        ),
      ).resolves.toMatchObject({
        state: "healthy",
        currentPointerInvariant: "clean",
        counts: {
          ineligibleGenerations: 0,
          affectedPointers: 0,
          affectedContributions: 0,
        },
      })
    })
  },
)
