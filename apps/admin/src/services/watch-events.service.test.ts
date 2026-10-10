import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

import {
  WatchEventService,
  deleteWatchEventsForUser,
} from "@/services/watch-events.service"
import { ForbiddenError, NotFoundError } from "@/services/errors"
import type { Principal } from "@/auth/principal"

const WEB_USER: Principal = {
  id: "auth-user-123",
  role: "WEB_USER",
  rateLimitBucketKey: "auth-user-123",
}

function makePrisma() {
  return {
    video: {
      findFirst: vi.fn(async () => ({ id: "video-1" })),
    },
    videoDub: {
      findFirst: vi.fn(async () => ({ id: "dub-1" })),
    },
    watchEvent: {
      create: vi.fn(async ({ data }) => ({
        id: "event-1",
        ...data,
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      })),
    },
  } as unknown as PrismaClient
}

describe("WatchEventService", () => {
  it("writes a sanitized event for a WEB_USER against a canonical video", async () => {
    const prisma = makePrisma()
    const service = new WatchEventService(prisma)

    await expect(
      service.create({
        user: WEB_USER,
        input: {
          videoId: "video-1",
          videoDubId: "dub-1",
          languageId: "language-1",
          eventType: "meaningful_playback",
          positionSeconds: 33.9,
          durationSeconds: 100,
          progress: 1.4,
          requestSessionId: " session-123 ",
          occurredAt: "2026-07-02T12:00:00.000Z",
        },
      }),
    ).resolves.toMatchObject({
      id: "event-1",
      authSubject: "auth-user-123",
      videoId: "video-1",
      videoDubId: "dub-1",
      languageId: "language-1",
      eventType: "meaningful_playback",
      positionSeconds: 33,
      durationSeconds: 100,
      progress: 1,
      requestSessionId: "session-123",
    })

    expect(prisma.video.findFirst).toHaveBeenCalledWith({
      where: { id: "video-1", deletedAt: null },
      select: { id: true },
    })
    expect(prisma.videoDub.findFirst).toHaveBeenCalledWith({
      where: { id: "dub-1", videoId: "video-1", deletedAt: null },
      select: { id: true },
    })
  })

  it("rejects anonymous and consumer bearer callers", async () => {
    const service = new WatchEventService(makePrisma())

    await expect(
      service.create({
        user: null,
        input: { videoId: "video-1", eventType: "meaningful_playback" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      service.create({
        user: { id: null, role: "CONSUMER_BEARER" },
        input: { videoId: "video-1", eventType: "meaningful_playback" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("rejects missing videos and mismatched dubs", async () => {
    const prisma = makePrisma()
    vi.mocked(prisma.video.findFirst).mockResolvedValueOnce(null)
    const service = new WatchEventService(prisma)

    await expect(
      service.create({
        user: WEB_USER,
        input: { videoId: "missing", eventType: "meaningful_playback" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    vi.mocked(prisma.video.findFirst).mockResolvedValueOnce({
      id: "video-1",
    } as Awaited<ReturnType<typeof prisma.video.findFirst>>)
    vi.mocked(prisma.videoDub.findFirst).mockResolvedValueOnce(null)
    await expect(
      service.create({
        user: WEB_USER,
        input: {
          videoId: "video-1",
          videoDubId: "other-dub",
          eventType: "meaningful_playback",
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("deleteWatchEventsForUser", () => {
  it("erases every watch event for the subject and reports the count", async () => {
    const deleteMany = vi.fn(async () => ({ count: 7 }))
    const prisma = {
      watchEvent: { deleteMany },
    } as unknown as PrismaClient

    await expect(
      deleteWatchEventsForUser(prisma, "auth-user-123"),
    ).resolves.toEqual({ deletedCount: 7 })

    expect(deleteMany).toHaveBeenCalledWith({
      where: { authSubject: "auth-user-123" },
    })
  })
})
