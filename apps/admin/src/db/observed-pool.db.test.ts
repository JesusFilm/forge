import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { afterAll, describe, expect, it } from "vitest"
import { ObservedPool } from "./observed-pool"
import { prismaPgAdapterConfigForProfile } from "./prisma-pool-config"
import { observeRecommendationRuntime } from "@/lib/recommendation-runtime-observation"
import { createPrismaClient } from "./client"

describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "native pool observation with PostgreSQL",
  () => {
    const config = prismaPgAdapterConfigForProfile(
      process.env.DATABASE_URL,
      "main",
    )
    const poolLogs: string[] = []
    const pool = new ObservedPool(config.poolConfig, "main", (line) =>
      poolLogs.push(line),
    )
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    afterAll(async () => {
      await prisma.$disconnect()
      await pool.end()
    })

    it("measures a real queued Prisma request and preserves all ten leases", async () => {
      const leases = await Promise.all(
        Array.from({ length: 10 }, () => pool.connect()),
      )
      const logs: string[] = []
      let waiting: Promise<unknown> | undefined
      try {
        waiting = observeRecommendationRuntime(
          "selection",
          () => prisma.$queryRaw`SELECT 1 AS value`,
          (line) => logs.push(line),
        )
        const deadline = Date.now() + 1000
        while (pool.waitingCount === 0 && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 5))
        expect(pool.waitingCount).toBe(1)
        await new Promise((resolve) => setTimeout(resolve, 60))
        leases.pop()!.release()
        await expect(waiting).resolves.toEqual([{ value: 1 }])
        const event = JSON.parse(logs[0])
        // Pinned Prisma 6's native engine does not carry the caller's ALS.
        // Missing correlation must stay unknown, never a fabricated zero wait.
        expect(event.poolAcquisitionSamples).toBe(0)
        expect(event.poolPendingMax).toBeNull()
        const acquisition = poolLogs
          .map((line) => JSON.parse(line))
          .find((row) => row.idleAtStart === 0 && row.totalAtStart === 10)
        expect(acquisition).toMatchObject({
          outcome: "acquired",
          requestCorrelated: false,
          backendPid: expect.any(Number),
        })
        expect(acquisition.elapsedMs).toBeGreaterThanOrEqual(50)
        expect(pool.totalCount).toBe(10)
      } finally {
        leases.forEach((lease) => lease.release())
        await waiting
      }
    })

    it("retains callback connection and query contracts", async () => {
      const logs: string[] = []
      await observeRecommendationRuntime(
        "selection",
        () =>
          new Promise<void>((resolve, reject) => {
            pool.connect((error, client, release) => {
              if (error || !client) {
                reject(error)
                return
              }
              client.query("SELECT 2 AS value", (queryError, result) => {
                release()
                if (queryError) {
                  reject(queryError)
                  return
                }
                expect(result.rows).toEqual([{ value: 2 }])
                resolve()
              })
            })
          }),
        (line) => logs.push(line),
      )
      expect(JSON.parse(logs[0]).timings["pool.acquire"]).toMatchObject({
        calls: 1,
        errors: 0,
        inFlight: 0,
      })
    })

    it("recreates an owned pool after Prisma disconnect and keeps query observations", async () => {
      const client = createPrismaClient("main")
      const logs: string[] = []
      try {
        const before = await client.$queryRaw`SELECT pg_backend_pid() AS pid`
        await client.$disconnect()
        const after = await observeRecommendationRuntime(
          "selection",
          () => client.$queryRaw`SELECT pg_backend_pid() AS pid`,
          (line) => logs.push(line),
        )
        expect(after).not.toEqual(before)
        expect(JSON.parse(logs[0]).timings["db.raw.$queryRaw"]).toMatchObject({
          calls: 1,
          inFlight: 0,
          errors: 0,
        })
      } finally {
        await client.$disconnect()
      }
    })
  },
)
