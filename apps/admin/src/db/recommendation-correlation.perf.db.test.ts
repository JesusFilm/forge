import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createPrismaClient } from "./client"

describe.skipIf(process.env.WATCH_PERSISTENCE_BENCHMARK !== "1")(
  "transaction correlation overhead",
  () => {
    it("compares original and correlated setup on real PostgreSQL in ABBA order", async () => {
      const prisma = createPrismaClient("main")
      const results = []
      try {
        for (const correlated of [false, true, true, false]) {
          const elapsed: number[] = []
          let invalidBackendCount = 0
          // Warm both the connection pool and each query form before measuring.
          for (let round = -10; round < 50; round++) {
            await Promise.all(
              Array.from({ length: 10 }, async () => {
                const started = performance.now()
                await prisma.$transaction(async (tx) => {
                  if (correlated) {
                    const tag = `watch:${randomUUID()}:1`
                    const rows = await tx.$queryRaw<
                      Array<{ backendPid: number }>
                    >`
                  SELECT set_config('statement_timeout', '1500', true),
                    pg_backend_pid() AS "backendPid",
                    CASE WHEN ${tag}::text IS NOT NULL
                      THEN set_config('application_name', ${tag}::text, true)
                      ELSE current_setting('application_name') END
                `
                    if (!(rows[0]?.backendPid > 0)) invalidBackendCount++
                  } else {
                    await tx.$queryRaw`SELECT set_config('statement_timeout', '1500', true)`
                  }
                })
                if (round >= 0) elapsed.push(performance.now() - started)
              }),
            )
          }
          expect(invalidBackendCount).toBe(0)
          elapsed.sort((a, b) => a - b)
          results.push({
            correlated,
            transactions: elapsed.length,
            p50Ms: elapsed[Math.ceil(elapsed.length * 0.5) - 1],
            p95Ms: elapsed[Math.ceil(elapsed.length * 0.95) - 1],
            p99Ms: elapsed[Math.ceil(elapsed.length * 0.99) - 1],
            maxMs: elapsed.at(-1),
          })
        }
        writeFileSync(
          process.env.WATCH_WAIT_BENCHMARK_OUTPUT!,
          JSON.stringify(
            {
              capturedAt: new Date().toISOString(),
              description:
                "Two thousand measured ten-concurrent transactions comparing original and correlated setup SQL in ABBA order, with 100 additional warmup transactions before each phase. Includes begin/commit/transport and UUID generation, excludes runtime JSON/stdout and the external sampler. Shared-host measurements, not a production latency SLO.",
              results,
            },
            null,
            2,
          ),
        )
      } finally {
        await prisma.$disconnect()
      }
    }, 120000)
  },
)
