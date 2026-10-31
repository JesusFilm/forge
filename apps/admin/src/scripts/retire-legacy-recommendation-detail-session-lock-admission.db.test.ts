import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, describe, expect, it } from "vitest"
import { createPrismaClient } from "../db/client"
import { conversionDatabaseHash } from "../services/recommendations/legacy-candidate-trace-conversion.service"
import { actualDatabaseGate } from "./retire-legacy-recommendation-detail-session"

const sourceFiles = [
  "src/scripts/retire-legacy-recommendation-campaign.ts",
  "src/services/recommendations/legacy-detail-retirement-campaign.ts",
  "src/scripts/retire-legacy-recommendation-detail.ts",
  "src/services/recommendations/legacy-detail-retirement.service.ts",
  "src/services/recommendations/legacy-candidate-trace-conversion.service.ts",
  "src/services/recommendations/legacy-quality-holds.ts",
  "src/scripts/retire-legacy-recommendation-detail-session.ts",
]
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const db = createPrismaClient("main")
const lockKey = 368_991_001

async function source() {
  return {
    revision: "a".repeat(40),
    targetDatabaseHash: await conversionDatabaseHash(db),
    sourceHashes: Object.fromEntries(
      sourceFiles.map((path) => [path, sha(readFileSync(path))]),
    ),
    reviewedAt: new Date().toISOString(),
    reviewReceiptSha256: "b".repeat(64),
  }
}

async function waitUntilBlocked(probe: Client, pid: number) {
  for (let i = 0; i < 40; i++) {
    const { rows } = await probe.query<{ blocked: boolean }>(
      "SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",
      [pid],
    )
    if (rows[0]?.blocked) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Synthetic PostgreSQL waiter did not become visible")
}

describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "owned PostgreSQL legacy session lock admission",
  () => {
    afterAll(async () => db.$disconnect())

    it("admits only after a real transient database lock waiter clears", async () => {
      const url = new URL(process.env.DATABASE_URL!)
      expect(url.hostname).toBe("127.0.0.1")
      expect(url.pathname).toBe("/forge_cleanup_lock_admission_owned_20260930")
      expect(process.env.NEXT_PUBLIC_DATADOG_VERSION).toBe("a".repeat(40))
      const holder = new Client({ connectionString: process.env.DATABASE_URL })
      const waiter = new Client({ connectionString: process.env.DATABASE_URL })
      const probe = new Client({ connectionString: process.env.DATABASE_URL })
      await Promise.all([holder.connect(), waiter.connect(), probe.connect()])
      try {
        await holder.query("SELECT pg_advisory_lock($1)", [lockKey])
        const [{ pid }] = (
          await waiter.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
        ).rows
        const waiting = waiter.query("SELECT pg_advisory_lock($1)", [lockKey])
        await waitUntilBlocked(probe, pid!)
        const release = setTimeout(() => {
          void holder.query("SELECT pg_advisory_unlock($1)", [lockKey])
        }, 120)
        const start = performance.now()
        try {
          await actualDatabaseGate(db, await source())
        } finally {
          clearTimeout(release)
        }
        expect(performance.now() - start).toBeGreaterThanOrEqual(90)
        await waiting
        await waiter.query("SELECT pg_advisory_unlock($1)", [lockKey])
      } finally {
        await holder.query("SELECT pg_advisory_unlock($1)", [lockKey])
        await Promise.all([holder.end(), waiter.end(), probe.end()])
      }
    })

    it("refuses a persistent waiter after bounded read-only samples", async () => {
      const holder = new Client({ connectionString: process.env.DATABASE_URL })
      const waiter = new Client({ connectionString: process.env.DATABASE_URL })
      const probe = new Client({ connectionString: process.env.DATABASE_URL })
      await Promise.all([holder.connect(), waiter.connect(), probe.connect()])
      try {
        await holder.query("SELECT pg_advisory_lock($1)", [lockKey])
        const [{ pid }] = (
          await waiter.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
        ).rows
        const waiting = waiter.query("SELECT pg_advisory_lock($1)", [lockKey])
        await waitUntilBlocked(probe, pid!)
        const start = performance.now()
        await expect(actualDatabaseGate(db, await source())).rejects.toThrow(
          "database-capacity",
        )
        const duration = performance.now() - start
        expect(duration).toBeGreaterThanOrEqual(190)
        expect(duration).toBeLessThan(2_000)
        await holder.query("SELECT pg_advisory_unlock($1)", [lockKey])
        await waiting
        await waiter.query("SELECT pg_advisory_unlock($1)", [lockKey])
        await expect(
          actualDatabaseGate(db, await source()),
        ).resolves.toBeUndefined()
      } finally {
        await holder.query("SELECT pg_advisory_unlock($1)", [lockKey])
        await Promise.all([holder.end(), waiter.end(), probe.end()])
      }
    })
  },
)
