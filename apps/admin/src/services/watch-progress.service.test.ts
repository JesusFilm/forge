import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  video: {
    findMany: vi.fn(),
  },
  watchProgress: {
    findMany: vi.fn(),
    // The staleness guard lives in updateMany's WHERE; create covers the
    // no-row-yet case and rejects with P2002 when a concurrent writer won.
    updateMany: vi.fn(),
    create: vi.fn(),
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

/** A row that does not exist yet: the conditional update matches nothing. */
function stubNoExistingRow() {
  prismaMock.watchProgress.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.watchProgress.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => args.data,
  )
}

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
    stubNoExistingRow()

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
    expect(prismaMock.watchProgress.create).toHaveBeenCalledTimes(1)
  })

  it("does not overwrite newer progress with stale submitted progress", async () => {
    prismaMock.video.findMany.mockResolvedValueOnce([{ id: "video-1" }])
    // Stored row is newer, so the conditional WHERE matches nothing and the
    // create then loses to the existing row.
    prismaMock.watchProgress.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.watchProgress.create.mockRejectedValue(
      Object.assign(new Error("unique constraint"), { code: "P2002" }),
    )

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
  })

  it("puts the staleness guard IN the write, not a preceding read", async () => {
    // The discriminating case for the two-device rewind: a read-then-write
    // pair lets another device commit in the gap. Asserting the predicate is
    // on the write means restoring an unconditional upsert fails here.
    prismaMock.video.findMany.mockResolvedValueOnce([{ id: "video-1" }])
    stubNoExistingRow()

    await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          videoId: "video-1",
          positionSeconds: 10,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    expect(prismaMock.watchProgress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          videoId: "video-1",
          lastWatchedAt: { lte: new Date("2026-07-02T00:00:00.000Z") },
        }),
      }),
    )
    // No pre-read of the current row: that read is what created the race.
    expect(prismaMock.watchProgress.findMany).not.toHaveBeenCalled()
  })

  it("clamps a future client timestamp to server time", async () => {
    // An unclamped skewed clock wins the guard against every later write and
    // freezes the row permanently.
    prismaMock.video.findMany.mockResolvedValueOnce([{ id: "video-1" }])
    stubNoExistingRow()
    const before = Date.now()

    const result = await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          videoId: "video-1",
          positionSeconds: 10,
          durationSeconds: 100,
          updatedAt: "2099-01-01T00:00:00.000Z",
        },
      ],
    })

    const stored = Date.parse(result[0]?.updatedAt ?? "")
    expect(stored).toBeGreaterThanOrEqual(before)
    expect(stored).toBeLessThanOrEqual(Date.now())
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
    stubNoExistingRow()

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
    expect(prismaMock.watchProgress.create).toHaveBeenCalledTimes(1)
  })

  it("keeps the newest entry when an id-keyed and slug-keyed entry hit the same video", async () => {
    prismaMock.video.findMany
      .mockResolvedValueOnce([{ id: "video-1", slug: "birth-of-jesus" }])
      .mockResolvedValueOnce([{ id: "video-1" }])
    stubNoExistingRow()

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
    expect(prismaMock.watchProgress.create).toHaveBeenCalledTimes(1)
  })

  it("drops entries carrying neither a video id nor a slug", async () => {
    prismaMock.video.findMany.mockResolvedValue([])
    stubNoExistingRow()

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
    expect(prismaMock.watchProgress.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.watchProgress.create).not.toHaveBeenCalled()
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
