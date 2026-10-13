import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { createPrismaClient } from "./client"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "Admin model reads in an isolated PostgreSQL schema",
  () => {
    const schema = `precomputed_pool_${randomUUID().replaceAll("-", "")}`
    const videoId = randomUUID()
    const clients: PrismaClient[] = []
    let setup: Client

    beforeAll(async () => {
      setup = new Client({ connectionString: env.DATABASE_URL })
      await setup.connect()
      await setup.query(`CREATE SCHEMA "${schema}"`)
      await setup.query(
        `CREATE TABLE "${schema}".video (id text PRIMARY KEY, slug text)`,
      )
      await setup.query(
        `INSERT INTO "${schema}".video (id, slug) VALUES ($1, $2)`,
        [videoId, "isolated-catalog-video"],
      )
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      vi.stubEnv("DATABASE_URL", url.toString())
    })

    afterAll(async () => {
      await Promise.all(clients.map((client) => client.$disconnect()))
      vi.unstubAllEnvs()
      if (setup) {
        await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await setup.end()
      }
    })

    it.each(["main", "sync"] as const)(
      "reads the requested catalog schema through the %s application pool",
      async (profile) => {
        const prisma = createPrismaClient(profile)
        clients.push(prisma)
        await expect(
          prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, slug: true },
          }),
        ).resolves.toEqual({ id: videoId, slug: "isolated-catalog-video" })
      },
    )
  },
)
