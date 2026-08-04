import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  video: {
    findMany: vi.fn(),
  },
  watchProgress: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(async (operations: Array<Promise<unknown>>) =>
    Promise.all(operations),
  ),
}))

vi.mock("@/db/client", () => ({
  prisma: prismaMock,
}))

import {
  deleteWatchProgressForUser,
  deleteWatchProgressForVideo,
  listWatchProgress,
  upsertWatchProgress,
} from "./watch-progress.service"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("watch-progress service", () => {
  it("lists current-user progress ordered by history recency", async () => {
    prismaMock.watchProgress.findMany.mockResolvedValueOnce([
      {
        videoId: "video-1",
        languageSlug: "spanish-castilian",
        positionSeconds: 30,
        durationSeconds: 100,
        completed: false,
        lastWatchedAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ])

    await expect(listWatchProgress({ userId: "user-1" })).resolves.toEqual([
      {
        videoId: "video-1",
        languageSlug: "spanish-castilian",
        positionSeconds: 30,
        durationSeconds: 100,
        completed: false,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ])

    expect(prismaMock.watchProgress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: { lastWatchedAt: "desc" },
      }),
    )
  })

  it("upserts only existing videos and marks 90 percent progress complete", async () => {
    prismaMock.video.findMany.mockResolvedValueOnce([{ id: "video-1" }])
    prismaMock.watchProgress.findMany.mockResolvedValueOnce([])
    prismaMock.watchProgress.upsert.mockImplementation(
      async (args: {
        create: {
          videoId: string
          languageSlug: string | null
          positionSeconds: number
          durationSeconds: number
          completed: boolean
          lastWatchedAt: Date
        }
      }) => ({
        ...args.create,
        lastWatchedAt: args.create.lastWatchedAt,
      }),
    )

    const result = await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          videoId: "video-1",
          languageSlug: "spanish-castilian",
          positionSeconds: 90,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          videoId: "deleted-video",
          languageSlug: "english",
          positionSeconds: 50,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    expect(result).toEqual([
      {
        videoId: "video-1",
        languageSlug: "spanish-castilian",
        positionSeconds: 90,
        durationSeconds: 100,
        completed: true,
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ])
    expect(prismaMock.watchProgress.upsert).toHaveBeenCalledTimes(1)
  })

  it("does not overwrite newer progress with stale submitted progress", async () => {
    prismaMock.video.findMany.mockResolvedValueOnce([{ id: "video-1" }])
    prismaMock.watchProgress.findMany.mockResolvedValueOnce([
      {
        videoId: "video-1",
        lastWatchedAt: new Date("2026-07-03T00:00:00.000Z"),
      },
    ])

    const result = await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          videoId: "video-1",
          languageSlug: "english",
          positionSeconds: 10,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    expect(result).toEqual([])
    expect(prismaMock.watchProgress.upsert).not.toHaveBeenCalled()
  })

  it("deletes progress rows by consumer user id", async () => {
    prismaMock.watchProgress.deleteMany.mockResolvedValueOnce({ count: 2 })

    await expect(deleteWatchProgressForUser("user-1")).resolves.toEqual({
      deletedCount: 2,
    })
    expect(prismaMock.watchProgress.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    })
  })
})

describe("watch-progress service — mobile extensions", () => {
  it("resolves slug-keyed entries to the right video and drops unknown slugs", async () => {
    // Slug resolution lookup (slug -> id), then the id-validity lookup.
    prismaMock.video.findMany
      .mockResolvedValueOnce([{ id: "video-1", slug: "birth-of-jesus" }])
      .mockResolvedValueOnce([{ id: "video-1" }])
    prismaMock.watchProgress.findMany.mockResolvedValueOnce([])
    prismaMock.watchProgress.upsert.mockImplementation(
      async (args: { create: { videoId: string; lastWatchedAt: Date } }) => ({
        languageSlug: null,
        positionSeconds: 30,
        durationSeconds: 100,
        completed: false,
        ...args.create,
      }),
    )

    const result = await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          videoSlug: "birth-of-jesus",
          positionSeconds: 30,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          videoSlug: "renamed-away-slug",
          positionSeconds: 10,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.videoId).toBe("video-1")
    expect(prismaMock.watchProgress.upsert).toHaveBeenCalledTimes(1)
  })

  it("keeps the newest entry when an id-keyed and slug-keyed entry hit the same video", async () => {
    prismaMock.video.findMany
      .mockResolvedValueOnce([{ id: "video-1", slug: "birth-of-jesus" }])
      .mockResolvedValueOnce([{ id: "video-1" }])
    prismaMock.watchProgress.findMany.mockResolvedValueOnce([])
    prismaMock.watchProgress.upsert.mockImplementation(
      async (args: {
        create: {
          videoId: string
          positionSeconds: number
          lastWatchedAt: Date
        }
      }) => ({
        languageSlug: null,
        durationSeconds: 100,
        completed: false,
        ...args.create,
      }),
    )

    const result = await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          videoId: "video-1",
          positionSeconds: 20,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          videoSlug: "birth-of-jesus",
          positionSeconds: 44,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:01:00.000Z",
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.positionSeconds).toBe(44)
    expect(prismaMock.watchProgress.upsert).toHaveBeenCalledTimes(1)
  })

  it("drops entries carrying neither a video id nor a slug", async () => {
    prismaMock.video.findMany.mockResolvedValue([])
    prismaMock.watchProgress.findMany.mockResolvedValueOnce([])

    const result = await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          positionSeconds: 30,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    expect(result).toEqual([])
    expect(prismaMock.watchProgress.upsert).not.toHaveBeenCalled()
  })

  it("clears exactly one video's progress row", async () => {
    prismaMock.watchProgress.deleteMany.mockResolvedValueOnce({ count: 1 })

    await expect(
      deleteWatchProgressForVideo({ userId: "user-1", videoId: "video-1" }),
    ).resolves.toEqual({ deletedCount: 1 })

    expect(prismaMock.watchProgress.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", videoId: "video-1" },
    })
  })
})
