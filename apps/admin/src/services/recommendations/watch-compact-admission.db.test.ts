import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const exportControl = vi.hoisted(() => ({
  enabled: false,
  dispatch: vi.fn(),
  prepareFailure: vi.fn(),
}))

vi.mock("./event-history/runtime", () => ({
  dispatchPreparedRecommendationEventsAfterCommit: (
    _family: string,
    prepare: () => unknown[],
    expectedCount: number,
  ) => {
    let envelopes: unknown[]
    try {
      envelopes = prepare()
    } catch {
      exportControl.prepareFailure(expectedCount)
      return
    }
    try {
      exportControl.dispatch(envelopes)
    } catch {
      // The real dispatcher observes optional transport failures internally.
    }
  },
}))

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>()
  return {
    env: new Proxy(actual.env, {
      get(target, key) {
        if (key === "WATCH_COMPACT_ADMISSION_MODE") return "compact"
        if (key === "WATCH_EVENT_EXPORT_ENABLED")
          return exportControl.enabled ? "true" : "false"
        return Reflect.get(target, key)
      },
    }),
  }
})

import { env } from "@/config/env"

import {
  issueWatchSurfaceDelivery,
  recordWatchSurfaceExposureBatch,
} from "./watch-surface-exposure.service"
import { purgeExpiredWatchCompactAdmission } from "./watch-compact-retention"
import { readUnexpiredWatchHistoryPage } from "./watch-history-backfill"

const baseUrl = env.DATABASE_URL
const run = env.WATCH_COMPACT_DB_TEST === "1"
const now = new Date("2026-10-28T00:00:00.000Z")
const caller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}
const manifest = {
  surface: "watch-search",
  block: "results",
  presentation: "result-list",
  placement: "search-results",
  policyVersion: "watch-exposure-v2",
  sourceVersion: "a".repeat(64),
  expiresAt: "2026-10-29T00:00:00.000Z",
  items: [{ position: 0, itemPath: "/watch/example.html" }],
}

describe.skipIf(!run)("compact Watch admission on isolated PostgreSQL", () => {
  const schema = `watch_compact_${randomUUID().replaceAll("-", "")}`
  let admin: Client
  let prisma: PrismaClient

  beforeAll(async () => {
    admin = new Client({ connectionString: baseUrl })
    await admin.connect()
    await admin.query(`CREATE SCHEMA "${schema}"`)
    await admin.query(`SET search_path TO "${schema}", public`)
    await admin.query(`CREATE TABLE watch_surface_exposure (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, event_id uuid UNIQUE NOT NULL, window_id uuid NOT NULL,
      surface varchar(40) NOT NULL, block varchar(40) NOT NULL,
      presentation varchar(40) NOT NULL, placement varchar(64) NOT NULL,
      policy_version varchar(40) NOT NULL, position integer NOT NULL,
      item_path varchar(512) NOT NULL, kind varchar(16) NOT NULL,
      visibility_capability varchar(32), duplicate_count integer NOT NULL DEFAULT 0,
      occurred_at timestamp(3) NOT NULL, received_at timestamp(3) NOT NULL DEFAULT now(),
      expires_at timestamp(3) NOT NULL)`)
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
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  it("issues exact V2 binding, admits a simultaneous batch, and preserves revision counts without full PG rows", async () => {
    const attemptId = randomUUID()
    const issued = await issueWatchSurfaceDelivery(
      prisma,
      caller,
      { manifest, attemptId },
      now,
    )
    expect(issued.status).toBe("accepted")
    expect(
      (
        await issueWatchSurfaceDelivery(
          prisma,
          caller,
          { manifest, attemptId },
          now,
        )
      ).status,
    ).toBe("replay")
    expect(
      (
        await issueWatchSurfaceDelivery(
          prisma,
          caller,
          {
            manifest: { ...manifest, sourceVersion: "b".repeat(64) },
            attemptId,
          },
          now,
        )
      ).status,
    ).toBe("conflict")
    const event = {
      eventId: randomUUID(),
      windowId: issued.windowId!,
      surface: manifest.surface,
      block: manifest.block,
      presentation: manifest.presentation,
      placement: manifest.placement,
      policyVersion: manifest.policyVersion,
      position: 0,
      itemPath: manifest.items[0].itemPath,
      kind: "selected",
      visibilityCapability: null,
      occurredAt: now.toISOString(),
    }
    const later = {
      ...event,
      eventId: randomUUID(),
      occurredAt: new Date(now.getTime() + 1).toISOString(),
    }
    expect(
      await recordWatchSurfaceExposureBatch(
        prisma,
        caller,
        [later, event, event, { ...event, occurredAt: later.occurredAt }],
        new Date(now.getTime() + 1),
      ),
    ).toEqual([
      { eventId: later.eventId, status: "repeat" },
      { eventId: event.eventId, status: "accepted" },
      { eventId: event.eventId, status: "replay" },
      { eventId: event.eventId, status: "conflict" },
    ])
    const receipt = await prisma.watchSurfaceEventReceipt.findUniqueOrThrow({
      where: { eventId: event.eventId },
    })
    expect(receipt).toMatchObject({
      duplicateCount: 1,
      revision: 2,
      expiresAt: new Date("2026-11-11T00:00:00.000Z"),
    })
    expect(await prisma.watchSurfaceExposure.count()).toBe(0)
    expect(await prisma.watchSurfaceIssuedWindow.count()).toBe(1)
    expect(await prisma.watchSurfaceIssuedItem.count()).toBe(1)
  })

  it("rolls back the whole batch when a compact receipt insert fails", async () => {
    const id = randomUUID()
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION "${schema}".reject_watch_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt blocked'; END $$`,
    )
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER reject_watch_receipt BEFORE INSERT ON "${schema}".watch_surface_event_receipt FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_watch_receipt()`,
    )
    const event = {
      eventId: id,
      windowId: randomUUID(),
      surface: "watch-search",
      block: "results",
      presentation: "result-list",
      placement: "search-results",
      policyVersion: "watch-exposure-v1",
      position: 0,
      itemPath: "/watch/example.html",
      kind: "selected",
      visibilityCapability: null,
      occurredAt: now.toISOString(),
    }
    try {
      await expect(
        recordWatchSurfaceExposureBatch(prisma, caller, [event], now),
      ).rejects.toThrow()
      expect(
        await prisma.watchSurfaceEventReceipt.count({ where: { eventId: id } }),
      ).toBe(0)
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER reject_watch_receipt ON "${schema}".watch_surface_event_receipt`,
      )
    }
  })

  it("keeps pre-cutover V2 binding and recorded 29-day expiry authoritative", async () => {
    const attemptId = randomUUID()
    const issued = await issueWatchSurfaceDelivery(
      prisma,
      caller,
      { manifest, attemptId },
      now,
    )
    const item = await prisma.watchSurfaceIssuedItem.findFirstOrThrow({
      where: { windowId: issued.windowId! },
    })
    await prisma.watchSurfaceIssuedWindow.delete({
      where: { windowId: issued.windowId! },
    })
    const oldExpiry = new Date(now.getTime() + 29 * 86_400_000)
    await prisma.watchSurfaceExposure.create({
      data: {
        eventId: item.servedEventId,
        windowId: issued.windowId!,
        surface: manifest.surface,
        block: manifest.block,
        presentation: manifest.presentation,
        placement: manifest.placement,
        policyVersion: manifest.policyVersion,
        position: item.position,
        itemPath: item.itemPath,
        kind: "served",
        visibilityCapability: null,
        occurredAt: now,
        receivedAt: now,
        expiresAt: oldExpiry,
      },
    })
    expect(
      (
        await issueWatchSurfaceDelivery(
          prisma,
          caller,
          { manifest, attemptId },
          now,
        )
      ).status,
    ).toBe("replay")
    const eventId = randomUUID()
    const event = {
      eventId,
      windowId: issued.windowId!,
      surface: manifest.surface,
      block: manifest.block,
      presentation: manifest.presentation,
      placement: manifest.placement,
      policyVersion: manifest.policyVersion,
      position: item.position,
      itemPath: item.itemPath,
      kind: "selected",
      visibilityCapability: null,
      occurredAt: now.toISOString(),
    }
    expect(
      await recordWatchSurfaceExposureBatch(prisma, caller, [event], now),
    ).toEqual([{ eventId, status: "accepted" }])
    const storedLegacy = await prisma.watchSurfaceExposure.findUniqueOrThrow({
      where: { eventId },
    })
    expect(storedLegacy.expiresAt).toEqual(oldExpiry)
    expect(
      await prisma.watchSurfaceEventReceipt.count({ where: { eventId } }),
    ).toBe(0)
    expect(
      await recordWatchSurfaceExposureBatch(prisma, caller, [event], now),
    ).toEqual([{ eventId, status: "replay" }])
    const backfillAt = new Date(now.getTime() + 86_400_000)
    const firstPage = await readUnexpiredWatchHistoryPage(
      prisma,
      backfillAt,
      undefined,
      1,
    )
    const secondPage = await readUnexpiredWatchHistoryPage(
      prisma,
      backfillAt,
      firstPage.nextCursor!,
      1,
    )
    expect(firstPage.events).toHaveLength(1)
    expect(secondPage.events).toHaveLength(1)
    expect(
      [firstPage.events[0], secondPage.events[0]].map((row) => row.expiresAt),
    ).toEqual([oldExpiry.toISOString(), oldExpiry.toISOString()])
    expect(
      [firstPage.events[0], secondPage.events[0]].find(
        (row) => row.logicalId === eventId,
      )?.revision,
    ).toBe(2)
    expect(
      [firstPage.events[0], secondPage.events[0]].find(
        (row) => row.logicalId === eventId,
      ),
    ).toMatchObject({
      acceptedAt: backfillAt.toISOString(),
      payload: { receivedAt: storedLegacy.receivedAt.toISOString() },
    })
    const compact = await issueWatchSurfaceDelivery(
      prisma,
      caller,
      { manifest, attemptId: randomUUID() },
      now,
    )
    const oldFact = { ...event, eventId: randomUUID(), kind: "rendered" }
    const newFact = {
      ...event,
      eventId: randomUUID(),
      windowId: compact.windowId!,
    }
    const compactReplay = { ...newFact, eventId: randomUUID() }
    expect(
      await recordWatchSurfaceExposureBatch(
        prisma,
        caller,
        [compactReplay],
        now,
      ),
    ).toEqual([{ eventId: compactReplay.eventId, status: "accepted" }])
    exportControl.enabled = true
    exportControl.dispatch.mockClear()
    expect(
      await recordWatchSurfaceExposureBatch(
        prisma,
        caller,
        [oldFact, newFact, compactReplay],
        now,
      ),
    ).toEqual([
      { eventId: oldFact.eventId, status: "accepted" },
      { eventId: newFact.eventId, status: "repeat" },
      { eventId: compactReplay.eventId, status: "replay" },
    ])
    expect(exportControl.dispatch).toHaveBeenCalledWith([
      expect.objectContaining({ logicalId: oldFact.eventId }),
      expect.objectContaining({ logicalId: newFact.eventId }),
      expect.objectContaining({
        logicalId: compactReplay.eventId,
        revision: 2,
      }),
    ])
    exportControl.enabled = false
    expect(
      await prisma.watchSurfaceExposure.count({
        where: { eventId: { in: [oldFact.eventId, newFact.eventId] } },
      }),
    ).toBe(2)
    expect(
      await prisma.watchSurfaceEventReceipt.count({
        where: { eventId: { in: [oldFact.eventId, newFact.eventId] } },
      }),
    ).toBe(0)
    expect(
      await prisma.watchSurfaceExposure.count({
        where: { eventId: compactReplay.eventId },
      }),
    ).toBe(0)
    const v1WindowId = randomUUID()
    const firstV1 = {
      ...event,
      eventId: randomUUID(),
      windowId: v1WindowId,
      policyVersion: "watch-exposure-v1",
    }
    expect(
      await recordWatchSurfaceExposureBatch(prisma, caller, [firstV1], now),
    ).toEqual([{ eventId: firstV1.eventId, status: "accepted" }])
    const laterV1 = {
      ...firstV1,
      eventId: randomUUID(),
      occurredAt: new Date(now.getTime() + 1).toISOString(),
    }
    expect(
      await recordWatchSurfaceExposureBatch(
        prisma,
        caller,
        [{ ...oldFact, eventId: randomUUID() }, laterV1],
        new Date(now.getTime() + 1),
      ),
    ).toMatchObject([
      { eventId: expect.any(String) },
      { eventId: laterV1.eventId, status: "repeat" },
    ])
    const rejected = [
      { ...oldFact, eventId: randomUUID() },
      { ...newFact, eventId: randomUUID() },
    ]
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION "${schema}".reject_mixed_watch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'selected' THEN RAISE EXCEPTION 'mixed write blocked'; END IF; RETURN NEW; END $$`,
    )
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER reject_mixed_watch BEFORE INSERT ON "${schema}".watch_surface_exposure FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_mixed_watch()`,
    )
    try {
      await expect(
        recordWatchSurfaceExposureBatch(prisma, caller, rejected, now),
      ).rejects.toThrow()
      expect(
        await prisma.watchSurfaceExposure.count({
          where: { eventId: { in: rejected.map(({ eventId }) => eventId) } },
        }),
      ).toBe(0)
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER reject_mixed_watch ON "${schema}".watch_surface_exposure`,
      )
    }
  })

  it("preserves an unpurged expired legacy V1 event ID", async () => {
    const eventId = randomUUID()
    const event = {
      eventId,
      windowId: randomUUID(),
      surface: "watch-search",
      block: "results",
      presentation: "result-list",
      placement: "search-results",
      policyVersion: "watch-exposure-v1",
      position: 0,
      itemPath: "/watch/example.html",
      kind: "selected",
      visibilityCapability: null,
      occurredAt: now.toISOString(),
    }
    await prisma.watchSurfaceExposure.create({
      data: {
        ...event,
        occurredAt: now,
        receivedAt: now,
        expiresAt: new Date(now.getTime() - 1),
      },
    })
    exportControl.enabled = true
    exportControl.prepareFailure.mockClear()
    try {
      expect(
        await recordWatchSurfaceExposureBatch(prisma, caller, [event], now),
      ).toEqual([{ eventId, status: "replay" }])
      expect(exportControl.prepareFailure).toHaveBeenCalledWith(1)
    } finally {
      exportControl.enabled = false
    }
    expect(
      await prisma.watchSurfaceEventReceipt.count({ where: { eventId } }),
    ).toBe(0)
  })

  it("admits the full 64-event V1 limit with stable first/repeat order", async () => {
    const windowId = randomUUID()
    const events = Array.from({ length: 64 }, (_, index) => ({
      eventId: randomUUID(),
      windowId,
      surface: "watch-search",
      block: "results",
      presentation: "result-list",
      placement: "search-results",
      policyVersion: "watch-exposure-v1",
      position: 0,
      itemPath: "/watch/example.html",
      kind: "selected",
      visibilityCapability: null,
      occurredAt: new Date(now.getTime() + index).toISOString(),
    }))
    const result = await recordWatchSurfaceExposureBatch(
      prisma,
      caller,
      events.slice().reverse(),
      new Date(now.getTime() + 64),
    )
    expect(result.filter(({ status }) => status === "accepted")).toEqual([
      { eventId: events[0].eventId, status: "accepted" },
    ])
    expect(result.filter(({ status }) => status === "repeat")).toHaveLength(63)
    expect(
      await prisma.watchSurfaceEventReceipt.count({ where: { windowId } }),
    ).toBe(64)
  })

  it("serializes a simultaneous event ID collision across two windows", async () => {
    const eventId = randomUUID()
    const event = (windowId: string) => ({
      eventId,
      windowId,
      surface: "watch-search",
      block: "results",
      presentation: "result-list",
      placement: "search-results",
      policyVersion: "watch-exposure-v1",
      position: 0,
      itemPath: "/watch/example.html",
      kind: "selected",
      visibilityCapability: null,
      occurredAt: now.toISOString(),
    })
    const [first, second] = await Promise.all([
      recordWatchSurfaceExposureBatch(
        prisma,
        caller,
        [event(randomUUID())],
        now,
      ),
      recordWatchSurfaceExposureBatch(
        prisma,
        caller,
        [event(randomUUID())],
        now,
      ),
    ])
    expect([first[0].status, second[0].status].sort()).toEqual([
      "accepted",
      "conflict",
    ])
    expect(
      await prisma.watchSurfaceEventReceipt.count({ where: { eventId } }),
    ).toBe(1)
  })

  it("dispatches after admission commit and keeps an export exception out of the viewer response", async () => {
    exportControl.enabled = true
    const eventId = randomUUID()
    const event = {
      eventId,
      windowId: randomUUID(),
      surface: "watch-search",
      block: "results",
      presentation: "result-list",
      placement: "search-results",
      policyVersion: "watch-exposure-v1",
      position: 0,
      itemPath: "/watch/example.html",
      kind: "selected",
      visibilityCapability: null,
      occurredAt: now.toISOString(),
    }
    let observed: Promise<number> | undefined
    exportControl.dispatch.mockImplementationOnce(() => {
      observed = prisma.watchSurfaceEventReceipt.count({ where: { eventId } })
    })
    try {
      expect(
        await recordWatchSurfaceExposureBatch(prisma, caller, [event], now),
      ).toEqual([{ eventId, status: "accepted" }])
      expect(await observed).toBe(1)
      expect(exportControl.dispatch).toHaveBeenCalledWith([
        expect.objectContaining({
          family: "watch-exposure",
          logicalId: eventId,
          revision: 1,
        }),
      ])
      exportControl.dispatch.mockImplementationOnce(() => {
        throw new Error("transport unavailable")
      })
      expect(
        await recordWatchSurfaceExposureBatch(
          prisma,
          caller,
          [{ ...event, eventId: randomUUID() }],
          now,
        ),
      ).toMatchObject([{ eventId: expect.any(String) }])
    } finally {
      exportControl.enabled = false
      exportControl.dispatch.mockReset()
    }
  })

  it("purges only expired compact receipts and their issued windows in one page", async () => {
    const result = await prisma.$transaction((tx) =>
      purgeExpiredWatchCompactAdmission(
        tx,
        new Date("2026-11-12T00:00:00.000Z"),
        1,
      ),
    )
    expect(result).toEqual({ receipts: 1, windows: 1 })
  })
})
