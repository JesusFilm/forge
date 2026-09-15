import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { fetchProdStatus } from "../scripts/lib/dashboard/query.js"
import { prodReadSchema } from "../scripts/lib/dashboard/types.js"

const databaseUrl = process.env.DATABASE_URL
const client = databaseUrl
  ? new PrismaClient({ datasourceUrl: databaseUrl })
  : null
afterAll(async () => client?.$disconnect())

describe.skipIf(!client)(
  "dashboard aggregate query (local integration)",
  () => {
    it("returns a schema-valid, bounded read without provider dependencies", async () => {
      const data = await fetchProdStatus(client!)
      expect(prodReadSchema.safeParse(data).success).toBe(true)
      expect(data.ingested.length).toBeLessThan(1_000)
      expect(data.acquired_keys.length).toBeLessThan(1_000)
    })
  },
)
