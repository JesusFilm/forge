import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  WatchSearchEventService,
  WatchSearchEventValidationError,
} from "./watch-search-events.service"

function buildPrisma() {
  return {
    watchSearchEvent: {
      create: vi.fn(async (args) => ({ id: "event-1", ...args.data })),
    },
  }
}

describe("WatchSearchEventService", () => {
  const now = new Date("2026-07-15T10:10:00.000Z")

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("stores bounded search click metadata without user or query text", async () => {
    const prisma = buildPrisma()
    const service = new WatchSearchEventService(prisma as never, {
      now: () => now,
    })

    await service.create({
      requestId: "search_12345678",
      eventType: "result_clicked",
      client: "web",
      resultId: "video-123",
      resultType: "video",
      position: 2.8,
      visibleResultIds: ["video-123", "bad id with spaces", "video-456"],
      routeLanguageSlug: "english",
      searchLanguageSlug: "russian",
      occurredAt: "2026-07-15T10:00:00.000Z",
    })

    expect(prisma.watchSearchEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: "search_12345678",
        eventType: "result_clicked",
        client: "web",
        resultId: "video-123",
        resultType: "video",
        position: 2,
        occurredAt: new Date("2026-07-15T10:00:00.000Z"),
        expiresAt: new Date("2026-08-14T10:00:00.000Z"),
        metadata: {
          version: "watch-search-events/v1",
          visibleResultIds: ["video-123", "video-456"],
          routeLanguageSlug: "english",
          searchLanguageSlug: "russian",
        },
      }),
    })
    expect(
      JSON.stringify(prisma.watchSearchEvent.create.mock.calls[0]?.[0]?.data),
    ).not.toContain("query")
  })

  it("rejects invalid request ids and click events without a result id", async () => {
    const service = new WatchSearchEventService(buildPrisma() as never)

    await expect(
      service.create({
        requestId: "bad request id",
        eventType: "result_clicked",
        client: "web",
        resultId: "video-123",
      }),
    ).rejects.toBeInstanceOf(WatchSearchEventValidationError)

    await expect(
      service.create({
        requestId: "search_12345678",
        eventType: "result_clicked",
        client: "web",
      }),
    ).rejects.toThrow("result_clicked events require resultId")
  })

  it("rejects stale and far-future client timestamps", async () => {
    const service = new WatchSearchEventService(buildPrisma() as never, {
      now: () => now,
    })

    await expect(
      service.create({
        requestId: "search_12345678",
        eventType: "results_viewed",
        client: "web",
        occurredAt: "2026-07-14T09:59:59.000Z",
      }),
    ).rejects.toThrow("Search event timestamp outside accepted window")

    await expect(
      service.create({
        requestId: "search_12345678",
        eventType: "results_viewed",
        client: "web",
        occurredAt: "2026-07-15T10:15:01.000Z",
      }),
    ).rejects.toThrow("Search event timestamp outside accepted window")
  })
})
