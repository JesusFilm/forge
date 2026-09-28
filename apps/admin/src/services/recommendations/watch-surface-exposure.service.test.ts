import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  issueWatchSurfaceDelivery,
  recordWatchSurfaceExposure,
  recordWatchSurfaceExposureBatch,
} from "./watch-surface-exposure.service"

vi.mock("./caller", () => ({
  assertWebRecommendationCaller: vi.fn(),
}))

const now = new Date("2026-09-28T00:00:00.000Z")
const event = {
  eventId: "00000000-0000-4000-8000-000000000001",
  windowId: "00000000-0000-4000-8000-000000000002",
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

describe("anonymous Watch exposure ingestion", () => {
  it("accepts an early selection without fabricating eligible evidence", async () => {
    const create = vi.fn().mockResolvedValue({})
    const prisma = {
      watchSurfaceExposure: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    } as unknown as PrismaClient
    expect(await recordWatchSurfaceExposure(prisma, null, event, now)).toEqual({
      eventId: event.eventId,
      status: "accepted",
    })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "selected",
        visibilityCapability: null,
        expiresAt: new Date("2026-10-27T00:00:00.000Z"),
      }),
    })
  })

  it("records the same event identity as replay and rejects a conflicting payload", async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      watchSurfaceExposure: {
        findUnique: vi.fn().mockResolvedValue({
          ...event,
          occurredAt: now,
        }),
        update,
      },
    } as unknown as PrismaClient
    expect(await recordWatchSurfaceExposure(prisma, null, event, now)).toEqual({
      eventId: event.eventId,
      status: "replay",
    })
    expect(update).toHaveBeenCalledWith({
      where: { eventId: event.eventId },
      data: { duplicateCount: { increment: 1 } },
    })
    expect(
      await recordWatchSurfaceExposure(
        prisma,
        null,
        { ...event, itemPath: "/watch/other.html" },
        now,
      ),
    ).toEqual({ eventId: event.eventId, status: "conflict" })
  })

  it("bounds batches and rejects unregistered placements or arbitrary URLs", async () => {
    const prisma = {
      watchSurfaceExposure: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient
    await expect(
      recordWatchSurfaceExposureBatch(
        prisma,
        null,
        Array.from({ length: 65 }, () => event),
        now,
      ),
    ).rejects.toThrow()
    await expect(
      recordWatchSurfaceExposure(
        prisma,
        null,
        { ...event, itemPath: "https://example.com/secret" },
        now,
      ),
    ).rejects.toThrow()
    await expect(
      recordWatchSurfaceExposure(
        prisma,
        null,
        { ...event, block: "unknown" },
        now,
      ),
    ).rejects.toThrow()
  })
})

const manifest = {
  surface: "watch-search",
  block: "results",
  presentation: "result-list",
  placement: "search-results",
  policyVersion: "watch-exposure-v2",
  sourceVersion: "a".repeat(64),
  expiresAt: "2026-09-29T00:00:00.000Z",
  items: [{ position: 0, itemPath: "/watch/example.html" }],
}
const caller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}

function issuerFixture() {
  let stored: Record<string, unknown>[] = []
  const createMany = vi.fn(
    async ({ data }: { data: Record<string, unknown>[] }) => {
      stored = data
    },
  )
  const tx = {
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    watchSurfaceExposure: {
      findMany: vi.fn(async () => stored),
      createMany,
    },
  }
  const transaction = vi.fn(
    async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  )
  return {
    prisma: { $transaction: transaction } as unknown as PrismaClient,
    transaction,
    createMany,
  }
}

describe("origin-issued Watch manifests", () => {
  it("refuses fleet callers even without an explicit traffic classification", async () => {
    const { prisma, transaction } = issuerFixture()
    await expect(
      issueWatchSurfaceDelivery(
        prisma,
        { ...caller, fleet: true, recommendationViewerVerified: true },
        { manifest, attemptId: event.windowId },
        now,
      ),
    ).rejects.toThrow("Web consumer authentication required")
    expect(transaction).not.toHaveBeenCalled()
  })

  it("persists once, binds retries to immutable source metadata and keeps conflicts separate", async () => {
    const { prisma, createMany } = issuerFixture()
    const input = {
      manifest,
      attemptId: event.windowId,
      trafficCategory: "ordinary_browser",
    }
    const issued = await issueWatchSurfaceDelivery(prisma, caller, input, now)
    expect(issued).toMatchObject({
      disposition: "measured",
      status: "accepted",
      items: manifest.items,
    })
    expect(issued.windowId).toMatch(/^[a-f0-9-]{36}$/)
    expect(await issueWatchSurfaceDelivery(prisma, caller, input, now)).toEqual(
      { ...issued, status: "replay" },
    )
    expect(
      await issueWatchSurfaceDelivery(
        prisma,
        caller,
        {
          ...input,
          manifest: { ...manifest, sourceVersion: "b".repeat(64) },
        },
        now,
      ),
    ).toEqual({ ...issued, status: "conflict" })
    expect(
      await issueWatchSurfaceDelivery(
        prisma,
        caller,
        {
          ...input,
          manifest: { ...manifest, expiresAt: "2026-09-29T01:00:00.000Z" },
        },
        now,
      ),
    ).toEqual({ ...issued, status: "conflict" })
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({
      kind: "served",
      policyVersion: "watch-exposure-v2",
      visibilityCapability: null,
      expiresAt: new Date("2026-10-27T00:00:00.000Z"),
    })
  })

  it.each([
    ["declared_crawler", "contextual"],
    ["speculative_prefetch", "deferred"],
    ["speculative_prerender", "deferred"],
  ])(
    "excludes %s before any issuance transaction",
    async (trafficCategory, disposition) => {
      const { prisma, transaction } = issuerFixture()
      expect(
        await issueWatchSurfaceDelivery(
          prisma,
          caller,
          {
            manifest,
            attemptId: event.windowId,
            trafficCategory,
          },
          now,
        ),
      ).toEqual({ windowId: null, disposition, status: "accepted", items: [] })
      expect(transaction).not.toHaveBeenCalled()
    },
  )

  it("bounds source lifetimes and preserves empty manifests without writes", async () => {
    const { prisma, transaction } = issuerFixture()
    const input = { manifest, attemptId: event.windowId }
    expect(
      await issueWatchSurfaceDelivery(
        prisma,
        caller,
        {
          ...input,
          manifest: { ...manifest, items: [] },
        },
        now,
      ),
    ).toEqual({
      windowId: null,
      disposition: "measured",
      status: "accepted",
      items: [],
    })
    expect(transaction).not.toHaveBeenCalled()
    for (const changed of [
      { expiresAt: now.toISOString() },
      { expiresAt: "2026-10-01T00:00:00.000Z" },
      { sourceVersion: "unbounded-source" },
      { items: [manifest.items[0], manifest.items[0]] },
    ]) {
      await expect(
        issueWatchSurfaceDelivery(
          prisma,
          caller,
          {
            ...input,
            manifest: { ...manifest, ...changed },
          },
          now,
        ),
      ).rejects.toThrow()
    }
  })

  it("requires exact issued card identity for V2 client facts and never admits client served", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        ...event,
        policyVersion: "watch-exposure-v2",
        expiresAt: new Date(now.getTime() + 86_400_000),
      },
    ])
    const create = vi.fn()
    const prisma = {
      watchSurfaceExposure: {
        findMany,
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    } as unknown as PrismaClient
    const fact = { ...event, policyVersion: "watch-exposure-v2" }
    expect(
      await recordWatchSurfaceExposure(prisma, caller, fact, now),
    ).toMatchObject({ status: "accepted" })
    await expect(
      recordWatchSurfaceExposure(
        prisma,
        caller,
        {
          ...fact,
          placement: "other-block",
        },
        now,
      ),
    ).rejects.toThrow("issued served binding")
    await expect(
      recordWatchSurfaceExposure(
        prisma,
        caller,
        {
          ...fact,
          itemPath: "/watch/other.html",
        },
        now,
      ),
    ).rejects.toThrow("issued served binding")
    await expect(
      recordWatchSurfaceExposure(
        prisma,
        caller,
        { ...fact, kind: "served" },
        now,
      ),
    ).rejects.toThrow()
    findMany.mockResolvedValueOnce([])
    await expect(
      recordWatchSurfaceExposure(prisma, caller, fact, now),
    ).rejects.toThrow("issued served binding")
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt: new Date(now.getTime() + 86_400_000),
      }),
    })
  })
})
