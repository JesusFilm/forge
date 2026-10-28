import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Prisma, PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import {
  purgeExpiredWatchCompactItemPage,
  purgeExpiredWatchCompactReceiptPage,
  purgeExpiredWatchCompactWindowPage,
} from "./watch-compact-retention"

const baseUrl = env.DATABASE_URL
const run = env.WATCH_COMPACT_DB_TEST === "1"
const now = new Date("2026-10-28T00:00:00.000Z")
const expired = new Date(now.getTime() - 60_000)
const live = new Date(now.getTime() + 60_000)

describe.skipIf(!run)(
  "bounded compact Watch retention on isolated PostgreSQL",
  () => {
    const schema = `watch_retention_${randomUUID().replaceAll("-", "")}`
    let admin: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      admin = new Client({ connectionString: baseUrl })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      const migration = await readFile(
        new URL(
          "../../../prisma/migrations/0164_watch_event_history_admission/migration.sql",
          import.meta.url,
        ),
        "utf8",
      )
      await admin.query(migration)
      const url = new URL(baseUrl)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("deletes no more than one expired child page and never cascades a populated window", async () => {
      await expect(
        prisma.$transaction((tx) =>
          purgeExpiredWatchCompactItemPage(tx, now, 1_000),
        ),
      ).rejects.toThrow("page size")
      const expiredWindow = randomUUID()
      const liveWindow = randomUUID()
      const window = (windowId: string, expiresAt: Date) => ({
        windowId,
        manifestDigest: "a".repeat(64),
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        issuedAt: new Date(now.getTime() - 86_400_000),
        expiresAt,
        itemCount: 100,
      })
      await prisma.watchSurfaceIssuedWindow.createMany({
        data: [window(expiredWindow, expired), window(liveWindow, live)],
      })
      await prisma.watchSurfaceIssuedItem.createMany({
        data: [expiredWindow, liveWindow].flatMap((windowId) =>
          Array.from({ length: 100 }, (_, position) => ({
            windowId,
            position,
            itemPath: `/watch/item-${position}.html`,
            servedEventId: randomUUID(),
          })),
        ),
      })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredWatchCompactItemPage(tx, now, 25),
        ),
      ).toBe(25)
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredWatchCompactWindowPage(tx, now, 25),
        ),
      ).toBe(0)
      expect(
        await prisma.watchSurfaceIssuedItem.count({
          where: { windowId: expiredWindow },
        }),
      ).toBe(75)
      expect(
        await prisma.watchSurfaceIssuedItem.count({
          where: { windowId: liveWindow },
        }),
      ).toBe(100)
      expect(
        await prisma.watchSurfaceIssuedWindow.count({
          where: { windowId: expiredWindow },
        }),
      ).toBe(1)
      for (let page = 0; page < 3; page++)
        expect(
          await prisma.$transaction((tx) =>
            purgeExpiredWatchCompactItemPage(tx, now, 25),
          ),
        ).toBe(25)
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredWatchCompactWindowPage(tx, now, 25),
        ),
      ).toBe(1)
      expect(
        await prisma.watchSurfaceIssuedWindow.count({
          where: { windowId: expiredWindow },
        }),
      ).toBe(0)
      expect(
        await prisma.watchSurfaceIssuedWindow.count({
          where: { windowId: liveWindow },
        }),
      ).toBe(1)
    })

    it("pages receipts by their recorded expiry while preserving live rows", async () => {
      const windowId = randomUUID()
      const receipts = Array.from({ length: 7 }, (_, index) => ({
        eventId: randomUUID(),
        windowId,
        exactDigest: "a".repeat(64),
        groupDigest: "b".repeat(64),
        occurredAt: expired,
        receivedAt: expired,
        rankId: randomUUID(),
        expiresAt: index === 6 ? live : expired,
      }))
      await prisma.watchSurfaceEventReceipt.createMany({ data: receipts })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredWatchCompactReceiptPage(tx, now, 4),
        ),
      ).toBe(4)
      expect(await prisma.watchSurfaceEventReceipt.count()).toBe(3)
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredWatchCompactReceiptPage(tx, now, 4),
        ),
      ).toBe(2)
      expect(await prisma.watchSurfaceEventReceipt.findMany()).toMatchObject([
        { eventId: receipts[6].eventId, expiresAt: live },
      ])
    })
  },
)

describe.skipIf(env.WATCH_COMPACT_RETENTION_DB_TEST !== "1")(
  "scheduled compact Watch retention on an owned PostgreSQL database",
  () => {
    let db: PrismaClient

    beforeAll(() => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_watch_retention_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_watch_retention_test required")
      db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    })
    afterAll(async () => db?.$disconnect())

    it("commits exact pages and continues until receipts, items and windows drain", async () => {
      const {
        purgeExpiredRecommendationRequests,
        readRecommendationRetentionHealth,
      } = await import("./retention.service")
      const expiredAt = new Date(now.getTime() - 30 * 3_600_000)
      const expiredWindow = randomUUID()
      const secondExpiredWindow = randomUUID()
      const liveWindow = randomUUID()
      const window = (windowId: string, expiresAt: Date) => ({
        windowId,
        manifestDigest: "a".repeat(64),
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        issuedAt: new Date(now.getTime() - 14 * 86_400_000),
        expiresAt,
        itemCount: 100,
      })
      const receiptIds = Array.from({ length: 205 }, () => randomUUID())
      await db.watchSurfaceIssuedWindow.createMany({
        data: [
          window(expiredWindow, expiredAt),
          window(secondExpiredWindow, expiredAt),
          window(liveWindow, live),
        ],
      })
      await db.watchSurfaceIssuedItem.createMany({
        data: [expiredWindow, secondExpiredWindow, liveWindow].flatMap(
          (windowId) =>
            Array.from({ length: 100 }, (_, position) => ({
              windowId,
              position,
              itemPath: `/watch/item-${position}.html`,
              servedEventId: randomUUID(),
            })),
        ),
      })
      await db.watchSurfaceEventReceipt.createMany({
        data: receiptIds.map((eventId) => ({
          eventId,
          windowId: expiredWindow,
          exactDigest: "a".repeat(64),
          groupDigest: "b".repeat(64),
          occurredAt: expiredAt,
          receivedAt: expiredAt,
          rankId: randomUUID(),
          expiresAt: expiredAt,
        })),
      })
      try {
        const first = await purgeExpiredRecommendationRequests(db, now, 1)
        expect(first).toMatchObject({
          status: "succeeded",
          rowCounts: {
            expiredWatchEventReceipts: 100,
            expiredWatchIssuedItems: 100,
            expiredWatchIssuedWindows: 1,
          },
          oldestExpiredAtAfter: expiredAt.toISOString(),
          overdueAfterRun: true,
          batchLimitReached: true,
        })
        const ledger = await db.recommendationRetentionRun.findUniqueOrThrow({
          where: { id: first.runId },
        })
        expect(ledger.rowCounts).toMatchObject(first.rowCounts)
        expect(
          await db.watchSurfaceIssuedWindow.count({
            where: { windowId: { in: [expiredWindow, secondExpiredWindow] } },
          }),
        ).toBe(1)
        expect(
          await db.watchSurfaceIssuedItem.count({
            where: { windowId: liveWindow },
          }),
        ).toBe(100)
        expect(await readRecommendationRetentionHealth(db, now)).toMatchObject({
          healthy: false,
          reason: "retention_overdue",
          oldestOverdueAt: expiredAt,
        })
        const second = await purgeExpiredRecommendationRequests(db, now, 1)
        expect(second.rowCounts.expiredWatchEventReceipts).toBe(100)
        expect(second.rowCounts.expiredWatchIssuedItems).toBe(100)
        expect(second.rowCounts.expiredWatchIssuedWindows).toBe(1)
        expect(second.batchLimitReached).toBe(true)
        const third = await purgeExpiredRecommendationRequests(db, now, 1)
        expect(third).toMatchObject({
          status: "succeeded",
          rowCounts: { expiredWatchEventReceipts: 5 },
          oldestExpiredAtAfter: null,
          batchLimitReached: false,
        })
        expect(await db.watchSurfaceEventReceipt.count()).toBe(0)
      } finally {
        await db.watchSurfaceEventReceipt.deleteMany({
          where: { eventId: { in: receiptIds } },
        })
        await db.watchSurfaceIssuedWindow.deleteMany({
          where: {
            windowId: { in: [expiredWindow, secondExpiredWindow, liveWindow] },
          },
        })
      }
    })

    it("rolls back a failed child page but preserves the earlier committed receipt count", async () => {
      const { purgeExpiredRecommendationRequests } =
        await import("./retention.service")
      const eventId = randomUUID()
      const windowId = randomUUID()
      const expiresAt = new Date(now.getTime() - 60_000)
      await db.watchSurfaceIssuedWindow.create({
        data: {
          windowId,
          manifestDigest: "a".repeat(64),
          surface: "watch-search",
          block: "results",
          presentation: "result-list",
          placement: "search-results",
          issuedAt: new Date(now.getTime() - 86_400_000),
          expiresAt,
          itemCount: 1,
          items: {
            create: {
              position: 0,
              itemPath: "/watch/rollback.html",
              servedEventId: randomUUID(),
            },
          },
        },
      })
      await db.watchSurfaceEventReceipt.create({
        data: {
          eventId,
          windowId,
          exactDigest: "a".repeat(64),
          groupDigest: "b".repeat(64),
          occurredAt: expiresAt,
          receivedAt: expiresAt,
          rankId: randomUUID(),
          expiresAt,
        },
      })
      await db.$executeRawUnsafe(`
        CREATE FUNCTION owned_watch_retention_block_item() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned item delete blocked'; END $$
      `)
      await db.$executeRawUnsafe(`
        CREATE TRIGGER owned_watch_retention_block_item
        BEFORE DELETE ON watch_surface_issued_item
        FOR EACH ROW EXECUTE FUNCTION owned_watch_retention_block_item()
      `)
      const logged = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        await expect(
          purgeExpiredRecommendationRequests(db, now, 1),
        ).rejects.toThrow()
        expect(
          await db.watchSurfaceEventReceipt.count({ where: { eventId } }),
        ).toBe(0)
        expect(
          await db.watchSurfaceIssuedItem.count({ where: { windowId } }),
        ).toBe(1)
        expect(
          await db.watchSurfaceIssuedWindow.count({ where: { windowId } }),
        ).toBe(1)
        expect(
          await db.recommendationRetentionRun.findFirstOrThrow({
            where: { status: "FAILED" },
            orderBy: { startedAt: "desc" },
          }),
        ).toMatchObject({
          rowCounts: { expiredWatchEventReceipts: 1 },
          oldestExpiredAtAfter: null,
        })
      } finally {
        logged.mockRestore()
        await db.$executeRawUnsafe(
          "DROP TRIGGER IF EXISTS owned_watch_retention_block_item ON watch_surface_issued_item",
        )
        await db.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS owned_watch_retention_block_item()",
        )
        await db.watchSurfaceEventReceipt.deleteMany({ where: { eventId } })
        await db.watchSurfaceIssuedWindow.deleteMany({ where: { windowId } })
      }
    })

    it("yields before the next compact phase with committed counts and unknown backlog", async () => {
      const { purgeExpiredRecommendationRequests } =
        await import("./retention.service")
      const eventId = randomUUID()
      const windowId = randomUUID()
      const expiresAt = new Date(now.getTime() - 60_000)
      await db.watchSurfaceIssuedWindow.create({
        data: {
          windowId,
          manifestDigest: "a".repeat(64),
          surface: "watch-search",
          block: "results",
          presentation: "result-list",
          placement: "search-results",
          issuedAt: new Date(now.getTime() - 86_400_000),
          expiresAt,
          itemCount: 1,
          items: {
            create: {
              position: 0,
              itemPath: "/watch/yield.html",
              servedEventId: randomUUID(),
            },
          },
        },
      })
      await db.watchSurfaceEventReceipt.create({
        data: {
          eventId,
          windowId,
          exactDigest: "a".repeat(64),
          groupDigest: "b".repeat(64),
          occurredAt: expiresAt,
          receivedAt: expiresAt,
          rankId: randomUUID(),
          expiresAt,
        },
      })
      const priorSuccesses = await db.recommendationRetentionRun.count({
        where: { status: "SUCCEEDED" },
      })
      let delayed = false
      const delayedTransaction = async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
        options?: { maxWait?: number; timeout?: number },
      ): Promise<T> => {
        const result = await db.$transaction(callback, options)
        if (
          !delayed &&
          (await db.watchSurfaceEventReceipt.count({ where: { eventId } })) ===
            0
        ) {
          delayed = true
          await new Promise((resolve) => setTimeout(resolve, 5_100))
        }
        return result
      }
      const delayedDb = new Proxy(db, {
        get(target, property) {
          return property === "$transaction"
            ? delayedTransaction
            : Reflect.get(target, property)
        },
      }) as PrismaClient
      try {
        const result = await purgeExpiredRecommendationRequests(
          delayedDb,
          now,
          1,
        )
        expect(delayed).toBe(true)
        expect(result).toMatchObject({
          status: "yielded",
          rowCounts: { expiredWatchEventReceipts: 1 },
          oldestExpiredAtAfter: null,
          overdueAfterRun: null,
          continuationRequired: true,
        })
        expect(
          await db.watchSurfaceIssuedItem.count({ where: { windowId } }),
        ).toBe(1)
        expect(
          await db.recommendationRetentionRun.findUniqueOrThrow({
            where: { id: result.runId },
          }),
        ).toMatchObject({
          status: "SKIPPED",
          reasonCode: "budget_yield",
          rowCounts: { expiredWatchEventReceipts: 1 },
          oldestExpiredAtAfter: null,
        })
        expect(
          await db.recommendationRetentionRun.count({
            where: { status: "SUCCEEDED" },
          }),
        ).toBe(priorSuccesses)
      } finally {
        await db.watchSurfaceEventReceipt.deleteMany({ where: { eventId } })
        await db.watchSurfaceIssuedWindow.deleteMany({ where: { windowId } })
      }
    }, 15000)
  },
)
