import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { recordWatchSurfaceExposureBatch } from "../watch-surface-exposure.service"
import { loadAnonymousWatchExposureBreakdown } from "./watch-exposure.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
function observedPrisma(url: string) {
  return new PrismaClient({
    datasources: { db: { url } },
    log: [{ emit: "event", level: "query" }],
  })
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch exposure SQL window reconciliation",
  () => {
    const schema = `watch_exposure_${Date.now()}_${Math.random().toString(36).slice(2)}`
    let prisma: ReturnType<typeof observedPrisma>
    let admin: Client | null = null
    const queries: string[] = []
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      await admin.query(`
      CREATE TABLE watch_surface_exposure (
        id text PRIMARY KEY,
        event_id uuid UNIQUE NOT NULL,
        window_id uuid NOT NULL,
        surface varchar(40) NOT NULL,
        block varchar(40) NOT NULL,
        presentation varchar(40) NOT NULL,
        placement varchar(64) NOT NULL,
        policy_version varchar(40) NOT NULL,
        position integer NOT NULL,
        item_path varchar(512) NOT NULL,
        kind varchar(16) NOT NULL,
        visibility_capability varchar(32),
        duplicate_count integer NOT NULL DEFAULT 0,
        occurred_at timestamp(3) NOT NULL,
        received_at timestamp(3) NOT NULL DEFAULT now(),
        expires_at timestamp(3) NOT NULL
      )
    `)
      await admin.query(`
      CREATE INDEX watch_surface_exposure_window_item_idx
      ON watch_surface_exposure
      (window_id, surface, block, presentation, placement, position, item_path, kind)
    `)
      const fixtureUrl = new URL(env.DATABASE_URL)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schema)
      prisma = observedPrisma(fixtureUrl.toString())
      prisma.$on("query", (event) => queries.push(event.query))
    })
    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("does not turn a prior-window impression or repeat into this window's denominator", async () => {
      const start = new Date(Date.now() - 86_400_000)
      const at = (offsetMs: number) => new Date(start.getTime() + offsetMs)
      const insert = async (
        id: number,
        windowId: string,
        kind: "eligible" | "selected",
        occurredAt: Date,
        duplicateCount = 0,
      ) => {
        await prisma.$executeRaw`
        INSERT INTO watch_surface_exposure
          (id, event_id, window_id, surface, block, presentation, placement,
           policy_version, position, item_path, kind, visibility_capability,
           duplicate_count, occurred_at, received_at, expires_at)
        VALUES
          (${String(id)}, ${`00000000-0000-4000-8000-${String(id).padStart(12, "0")}`}::uuid,
           ${windowId}::uuid, 'watch-search', 'results', 'result-list', 'search-results',
           'watch-exposure-v1', 0, '/watch/example.html', ${kind},
           ${kind === "eligible" ? "unknown" : null}, ${duplicateCount},
           ${occurredAt}, ${occurredAt}, ${at(29 * 86_400_000)})
      `
      }
      const earlyWindow = "00000000-0000-4000-8000-000000000100"
      const normalWindow = "00000000-0000-4000-8000-000000000200"
      const repeatWindow = "00000000-0000-4000-8000-000000000300"
      await insert(1, earlyWindow, "eligible", at(-60_000))
      await insert(2, earlyWindow, "selected", at(60_000))
      await insert(3, normalWindow, "eligible", at(120_000))
      await insert(4, normalWindow, "selected", at(180_000))
      await insert(5, repeatWindow, "eligible", at(240_000), 1)
      await insert(6, repeatWindow, "eligible", at(300_000))
      await insert(7, repeatWindow, "selected", at(360_000))

      const rows = await loadAnonymousWatchExposureBreakdown(prisma, "24h")
      expect(rows.rows).toHaveLength(1)
      expect(rows.truncated).toBe(false)
      expect(rows.rows[0]).toMatchObject({
        eligible: 2,
        selected: 3,
        eligibleSelected: 2,
        selectionWithoutImpression: 1,
        repeats: 1,
        ctr: 1,
        duplicateRate: 1 / 7,
      })
    })

    it("persists 64-card batches in bounded queries and preserves concurrent replay", async () => {
      const caller = {
        id: "forge-web",
        role: "CONSUMER_BEARER" as const,
        rateLimitBucketKey: "forge-web",
      }
      const now = new Date()
      const elapsedMs: number[] = []
      const queryCounts: number[] = []
      for (let run = 0; run < 5; run += 1) {
        const windowId = randomUUID()
        const events = Array.from({ length: 64 }, (_, position) => ({
          eventId: randomUUID(),
          windowId,
          surface: "watch-search",
          block: "results",
          presentation: "result-list",
          placement: "search-results",
          policyVersion: "watch-exposure-v1",
          position,
          itemPath: `/watch/batch-${run}-${position}.html`,
          kind: "rendered",
          visibilityCapability: null,
          occurredAt: now.toISOString(),
        }))
        queries.length = 0
        const start = performance.now()
        const receipts = await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          events,
          now,
        )
        elapsedMs.push(Math.round(performance.now() - start))
        await new Promise((resolve) => setTimeout(resolve, 0))
        queryCounts.push(
          queries.filter((query) => query.includes("watch_surface_exposure"))
            .length,
        )
        expect(receipts.map(({ status }) => status)).toEqual(
          Array(64).fill("accepted"),
        )
      }
      expect(queryCounts).toEqual(Array(5).fill(2))
      console.info(
        `watch exposure 64-card ingest: elapsedMs=${elapsedMs.join(",")} queries=${queryCounts.join(",")}`,
      )

      const raceEvent = {
        eventId: randomUUID(),
        windowId: randomUUID(),
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        policyVersion: "watch-exposure-v1",
        position: 0,
        itemPath: "/watch/concurrent.html",
        kind: "rendered",
        visibilityCapability: null,
        occurredAt: now.toISOString(),
      }
      const concurrent = await Promise.all([
        recordWatchSurfaceExposureBatch(prisma, caller, [raceEvent], now),
        recordWatchSurfaceExposureBatch(prisma, caller, [raceEvent], now),
      ])
      expect(
        concurrent
          .flat()
          .map(({ status }) => status)
          .sort(),
      ).toEqual(["accepted", "replay"])
      expect(
        (
          await prisma.watchSurfaceExposure.findUniqueOrThrow({
            where: { eventId: raceEvent.eventId },
          })
        ).duplicateCount,
      ).toBe(1)
      expect(
        await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [{ ...raceEvent, itemPath: "/watch/conflict.html" }],
          now,
        ),
      ).toEqual([{ eventId: raceEvent.eventId, status: "conflict" }])
      expect(
        await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [
            {
              ...raceEvent,
              eventId: randomUUID(),
              occurredAt: new Date(now.getTime() + 1000).toISOString(),
            },
          ],
          now,
        ),
      ).toMatchObject([{ status: "repeat" }])

      const withinBatch = {
        ...raceEvent,
        eventId: randomUUID(),
        windowId: randomUUID(),
        itemPath: "/watch/within-batch.html",
      }
      expect(
        await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [
            withinBatch,
            withinBatch,
            { ...withinBatch, itemPath: "/watch/other.html" },
          ],
          now,
        ),
      ).toEqual([
        { eventId: withinBatch.eventId, status: "accepted" },
        { eventId: withinBatch.eventId, status: "replay" },
        { eventId: withinBatch.eventId, status: "conflict" },
      ])
    })
  },
)
