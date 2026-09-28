import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
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
