import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createPrismaClient } from "./client"
import { prismaPgAdapterConfigForProfile } from "./prisma-pool-config"
import { observeRecommendationRuntime } from "@/lib/recommendation-runtime-observation"

describe.skipIf(process.env.WATCH_PERSISTENCE_BENCHMARK !== "1")(
  "runtime observation overhead",
  () => {
    it("compares the original adapter with observed requests in ABBA order", async () => {
      const config = prismaPgAdapterConfigForProfile(
        process.env.DATABASE_URL,
        "main",
      )
      const baseline = new PrismaClient({
        adapter: new PrismaPg(config.poolConfig, config.options),
      })
      const observed = createPrismaClient("main")
      const results = []
      let bytes = 0
      try {
        for (const client of [baseline, observed]) {
          await Promise.all(
            Array.from(
              { length: 10 },
              () => client.$queryRaw`SELECT 1 AS value`,
            ),
          )
        }
        for (const variant of [
          "baseline",
          "observed",
          "observed",
          "baseline",
        ]) {
          const durations: number[] = []
          const started = performance.now()
          for (let round = 0; round < 100; round++) {
            await Promise.all(
              Array.from({ length: 10 }, async () => {
                const before = performance.now()
                const rows =
                  variant === "baseline"
                    ? await baseline.$queryRaw`SELECT 1 AS value`
                    : await observeRecommendationRuntime(
                        "selection",
                        () => observed.$queryRaw`SELECT 1 AS value`,
                        (line) => {
                          bytes += Buffer.byteLength(line)
                        },
                      )
                durations.push(performance.now() - before)
                expect(rows).toEqual([{ value: 1 }])
              }),
            )
          }
          durations.sort((a, b) => a - b)
          results.push({
            variant,
            calls: durations.length,
            wallMs: performance.now() - started,
            p50: durations[Math.ceil(durations.length * 0.5) - 1],
            p95: durations[Math.ceil(durations.length * 0.95) - 1],
            p99: durations[Math.ceil(durations.length * 0.99) - 1],
            max: durations.at(-1),
          })
        }
        writeFileSync(
          process.env.WATCH_OBSERVATION_BENCHMARK_OUTPUT!,
          JSON.stringify(
            {
              capturedAt: new Date().toISOString(),
              fixture:
                "four thousand real PostgreSQL SELECT 1 calls, ten concurrent, original adapter versus observed factory with complete request logging; JSON measured, stdout/UDP excluded",
              bytes,
              results,
            },
            null,
            2,
          ),
        )
      } finally {
        await Promise.all([baseline.$disconnect(), observed.$disconnect()])
      }
    }, 60_000)
  },
)
