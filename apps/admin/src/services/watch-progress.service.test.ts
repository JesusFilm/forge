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
