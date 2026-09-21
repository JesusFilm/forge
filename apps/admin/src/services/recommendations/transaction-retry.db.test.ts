import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { withRecommendationSerializableRetry } from "./transaction-retry"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "recommendation retry with the production PostgreSQL adapter",
  () => {
    const schema = `recommendation_retry_${Date.now()}`
    let admin: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(
        `CREATE TABLE "${schema}".retry_fixture (id integer PRIMARY KEY, value integer NOT NULL)`,
      )
      await admin.query(`INSERT INTO "${schema}".retry_fixture VALUES (1, 0)`)
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: env.DATABASE_URL,
            options: `-c search_path=${schema},public`,
          },
          { schema },
        ),
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!admin) return
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    })

    async function updateAfterConcurrentCommit() {
      return prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT value FROM retry_fixture WHERE id = 1`
          await admin.query(
            `UPDATE "${schema}".retry_fixture SET value = value + 1 WHERE id = 1`,
          )
          await tx.$executeRaw`UPDATE retry_fixture SET value = value + 1 WHERE id = 1`
        },
        { isolationLevel: "Serializable" },
      )
    }

    it("reproduces the raw-query wrapper without exporting SQL or identifiers", async () => {
      await expect(updateAfterConcurrentCommit()).rejects.toMatchObject({
        code: "P2010",
        meta: { code: "40001" },
      })
    })

    it("restarts the whole transaction with a fresh snapshot", async () => {
      await admin.query(`UPDATE "${schema}".retry_fixture SET value = 0`)
      let attempts = 0
      await withRecommendationSerializableRetry(async () => {
        attempts += 1
        if (attempts === 1) return updateAfterConcurrentCommit()
        return prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`UPDATE retry_fixture SET value = value + 1 WHERE id = 1`
          },
          { isolationLevel: "Serializable" },
        )
      })
      expect(attempts).toBe(2)
      const result = await admin.query(
        `SELECT value FROM "${schema}".retry_fixture WHERE id = 1`,
      )
      expect(result.rows).toEqual([{ value: 2 }])
    })
  },
)
