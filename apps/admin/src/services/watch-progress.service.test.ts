import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  video: {
    findMany: vi.fn(),
  },
  watchProgress: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  // The batch write is one raw INSERT … ON CONFLICT … WHERE; RETURNING is
  // what reports which entries the staleness guard admitted.
  $queryRaw: vi.fn(),
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

/** The SQL text and bound values of the batch write. */
function lastWrite() {
  const call = prismaMock.$queryRaw.mock.calls.at(-1) as
    | [TemplateStringsArray, ...unknown[]]
    | undefined
  if (!call) throw new Error("expected a $queryRaw call")
  const [strings, ...values] = call
  const [
    userId,
    ids,
    videoIds,
    languageSlugs,
    positions,
    durations,
    completions,
    watchedAts,
  ] = values as string[]
  return {
    sql: strings.join(" ? "),
    userId,
    ids,
    videoIds,
    languageSlugs,
    positions,
    durations,
    completions,
    watchedAts,
  }
}

/**
 * The guard admitted everything. Echoes the bound arrays back as rows so a
 * test can assert the returned view without hand-writing the row shape.
 */
function stubWriteAccepted() {
  prismaMock.$queryRaw.mockImplementation(
    async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const parse = (literal: string) =>
        literal === "{}"
          ? []
          : literal
              .slice(1, -1)
              .split(",")
              .map((v) => (v === "NULL" ? null : v.replace(/^"|"$/g, "")))
      const [
        ,
        ,
        videoIds,
        languageSlugs,
        positions,
        durations,
        completions,
        watchedAts,
      ] = values as string[]
      return parse(videoIds).map((videoId, index) => ({
        video_id: videoId,
        language_slug: parse(languageSlugs)[index],
        position_seconds: Number(parse(positions)[index]),
        duration_seconds: Number(parse(durations)[index]),
        completed: parse(completions)[index] === "true",
        last_watched_at: new Date(parse(watchedAts)[index] as string),
      }))
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$queryRaw.mockResolvedValue([])
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
    stubWriteAccepted()

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
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(lastWrite().videoIds).toBe('{"video-1"}')
  })

  it("reports only what the guard admitted, so a stale entry reads as dropped", async () => {
    prismaMock.video.findMany.mockResolvedValueOnce([{ id: "video-1" }])
    // The stored row is newer, so the ON CONFLICT WHERE excludes this row and
    // RETURNING yields nothing for it.
    prismaMock.$queryRaw.mockResolvedValueOnce([])

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
    stubWriteAccepted()

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

    const { sql, userId } = lastWrite()
    expect(sql).toMatch(/ON CONFLICT\s*\("user_id",\s*"video_id"\)\s*DO UPDATE/)
    expect(sql).toMatch(
      /WHERE "watch_progress"\."last_watched_at" <= EXCLUDED\."last_watched_at"/,
    )
    expect(userId).toBe("user-1")
    // No pre-read of the current row: that read is what created the race.
    expect(prismaMock.watchProgress.findMany).not.toHaveBeenCalled()
  })

  it("writes one statement for the whole batch, not one per entry", async () => {
    // Per-entry round trips put a mobile batch at N sequential queries; the
    // rate limiter allows 30 mutations/min, each carrying many entries.
    prismaMock.video.findMany.mockResolvedValueOnce([
      { id: "video-1" },
      { id: "video-2" },
      { id: "video-3" },
    ])
    stubWriteAccepted()

    const result = await upsertWatchProgress({
      userId: "user-1",
      entries: ["video-1", "video-2", "video-3"].map((videoId) => ({
        videoId,
        positionSeconds: 10,
        durationSeconds: 100,
        updatedAt: "2026-07-02T00:00:00.000Z",
      })),
    })

    expect(result).toHaveLength(3)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(lastWrite().videoIds).toBe('{"video-1","video-2","video-3"}')
  })

  it("binds every parallel array at the batch length", async () => {
    // PG18 NULL-pads unequal-length unnest args instead of erroring, so a
    // short array would silently write NULLs rather than fail.
    prismaMock.video.findMany.mockResolvedValueOnce([
      { id: "video-1" },
      { id: "video-2" },
    ])
    stubWriteAccepted()

    await upsertWatchProgress({
      userId: "user-1",
      entries: [
        {
          videoId: "video-1",
          languageSlug: "english",
          positionSeconds: 10,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          videoId: "video-2",
          languageSlug: null,
          positionSeconds: 20,
          durationSeconds: 100,
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    })

    const write = lastWrite()
    const width = (literal: string) => literal.slice(1, -1).split(",").length
    for (const literal of [
      write.ids,
      write.videoIds,
      write.languageSlugs,
      write.positions,
      write.durations,
      write.completions,
      write.watchedAts,
    ]) {
      expect(width(literal)).toBe(2)
    }
    // A null language must bind as SQL NULL, not the string "null".
    expect(write.languageSlugs).toBe('{"english",NULL}')
  })

  it("clamps a future client timestamp to server time", async () => {
    // An unclamped skewed clock wins the guard against every later write and
    // freezes the row permanently. Asserted on the value SENT, so the mock
    // cannot echo a passing answer back.
    prismaMock.video.findMany.mockResolvedValueOnce([{ id: "video-1" }])
    stubWriteAccepted()
    const before = Date.now()

    await upsertWatchProgress({
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

    const sent = Date.parse(lastWrite().watchedAts.slice(2, -2))
    expect(sent).toBeGreaterThanOrEqual(before)
    expect(sent).toBeLessThanOrEqual(Date.now())
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
    stubWriteAccepted()

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
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("keeps the newest entry when an id-keyed and slug-keyed entry hit the same video", async () => {
    prismaMock.video.findMany
      .mockResolvedValueOnce([{ id: "video-1", slug: "birth-of-jesus" }])
      .mockResolvedValueOnce([{ id: "video-1" }])
    stubWriteAccepted()

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
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("drops entries carrying neither a video id nor a slug", async () => {
    prismaMock.video.findMany.mockResolvedValue([])
    stubWriteAccepted()

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
    // Nothing resolvable means no statement at all, not an empty one.
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
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
