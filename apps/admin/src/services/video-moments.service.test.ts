import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  videoTranscript: {
    findFirst: vi.fn(),
  },
  videoTranscriptChunk: {
    findMany: vi.fn(),
  },
  videoMomentEditorial: {
    findMany: vi.fn(),
  },
}))

vi.mock("@/db/client", () => ({
  prisma: prismaMock,
}))

import {
  DEFAULT_VIDEO_MOMENTS,
  MAX_VIDEO_MOMENTS,
  listVideoMoments,
} from "./video-moments.service"

function chunk(overrides: Record<string, unknown> = {}) {
  return {
    startSeconds: 30,
    endSeconds: 60,
    contentSummary: "Jesus teaches on the hillside",
    bibleVerses: ["Matthew 5:3-12"],
    ...overrides,
  }
}

function beat(overrides: Record<string, unknown> = {}) {
  return {
    startSeconds: 12,
    endSeconds: 201,
    summary: "An angel tells Mary she will bear the Son of God.",
    bibleVerses: ["Luke 1:26-38"],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.videoTranscript.findFirst.mockResolvedValue(null)
  prismaMock.videoTranscriptChunk.findMany.mockResolvedValue([])
  prismaMock.videoMomentEditorial.findMany.mockResolvedValue([])
})

describe("listVideoMoments", () => {
  it("projects chunks in chunk order with the lean field set", async () => {
    prismaMock.videoTranscript.findFirst.mockResolvedValueOnce({ id: "t-1" })
    prismaMock.videoTranscriptChunk.findMany.mockResolvedValueOnce([
      chunk(),
      chunk({ startSeconds: 90, endSeconds: null, bibleVerses: [] }),
    ])

    const moments = await listVideoMoments({ videoId: "v-1" })

    expect(moments).toEqual([
      {
        startSeconds: 30,
        endSeconds: 60,
        summary: "Jesus teaches on the hillside",
        bibleVerses: ["Matthew 5:3-12"],
      },
      {
        startSeconds: 90,
        endSeconds: null,
        summary: "Jesus teaches on the hillside",
        bibleVerses: [],
      },
    ])
    expect(prismaMock.videoTranscriptChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { transcriptId: "t-1" },
        orderBy: { chunkIndex: "asc" },
      }),
    )
    // The lean projection is the contract: search internals must not ride
    // the public video query.
    const select = prismaMock.videoTranscriptChunk.findMany.mock.calls[0]![0]
      .select as Record<string, boolean>
    expect(Object.keys(select).sort()).toEqual([
      "bibleVerses",
      "contentSummary",
      "endSeconds",
      "startSeconds",
    ])
  })

  it("preserves a null startSeconds instead of coalescing it to 0", async () => {
    // The discriminator a moment-follower needs: null means "the chunker had
    // no timecodes", and 0 means "genuinely the opening seconds". The
    // sceneRecommendations COALESCE-to-0 must NOT leak into this surface.
    prismaMock.videoTranscript.findFirst.mockResolvedValueOnce({ id: "t-1" })
    prismaMock.videoTranscriptChunk.findMany.mockResolvedValueOnce([
      chunk({ startSeconds: null, endSeconds: null }),
    ])

    const [moment] = await listVideoMoments({ videoId: "v-1" })
    expect(moment!.startSeconds).toBeNull()
  })

  it("falls back to English when the requested language has no transcript", async () => {
    prismaMock.videoTranscript.findFirst
      .mockResolvedValueOnce(null) // requested "spanish"
      .mockResolvedValueOnce({ id: "t-en" })
    prismaMock.videoTranscriptChunk.findMany.mockResolvedValueOnce([chunk()])

    await listVideoMoments({ videoId: "v-1", languageSlug: "spanish" })

    const langs = prismaMock.videoTranscript.findFirst.mock.calls.map(
      (call) => (call[0] as { where: { language: string } }).where.language,
    )
    expect(langs).toEqual(["spanish", "en"])
  })

  it("queries English exactly once when it IS the requested language", async () => {
    prismaMock.videoTranscript.findFirst.mockResolvedValueOnce(null)

    await listVideoMoments({ videoId: "v-1", languageSlug: "en" })

    expect(prismaMock.videoTranscript.findFirst).toHaveBeenCalledTimes(1)
  })

  it("returns [] rather than throwing when no transcript exists", async () => {
    await expect(listVideoMoments({ videoId: "v-1" })).resolves.toEqual([])
    expect(prismaMock.videoTranscriptChunk.findMany).not.toHaveBeenCalled()
  })

  it("clamps the limit into [1, MAX] and defaults it", async () => {
    prismaMock.videoTranscript.findFirst.mockResolvedValue({ id: "t-1" })

    const takeOf = async (limit: number | null) => {
      await listVideoMoments({ videoId: "v-1", limit })
      const call = prismaMock.videoTranscriptChunk.findMany.mock.calls.at(-1)!
      return (call[0] as { take: number }).take
    }

    expect(await takeOf(null)).toBe(DEFAULT_VIDEO_MOMENTS)
    expect(await takeOf(10)).toBe(10)
    expect(await takeOf(0)).toBe(1)
    expect(await takeOf(-5)).toBe(1)
    expect(await takeOf(100_000)).toBe(MAX_VIDEO_MOMENTS)
  })

  it("blanks a whitespace-only summary to null", async () => {
    prismaMock.videoTranscript.findFirst.mockResolvedValueOnce({ id: "t-1" })
    prismaMock.videoTranscriptChunk.findMany.mockResolvedValueOnce([
      chunk({ contentSummary: "   " }),
    ])

    const [moment] = await listVideoMoments({ videoId: "v-1" })
    expect(moment!.summary).toBeNull()
  })
})

describe("listVideoMoments — editorial preference (story beats)", () => {
  it("serves reviewed beats EXCLUSIVELY: the chunk path is never consulted", async () => {
    // Exclusivity, not mere presence: a reviewed film must never show a
    // mixed raw/reviewed panel, so the transcript lookup itself must not run.
    prismaMock.videoMomentEditorial.findMany.mockResolvedValueOnce([
      beat(),
      beat({ startSeconds: 201, endSeconds: 350, bibleVerses: [] }),
    ])

    const moments = await listVideoMoments({ videoId: "v-1" })

    expect(moments).toEqual([
      {
        startSeconds: 12,
        endSeconds: 201,
        summary: "An angel tells Mary she will bear the Son of God.",
        bibleVerses: ["Luke 1:26-38"],
      },
      {
        startSeconds: 201,
        endSeconds: 350,
        summary: "An angel tells Mary she will bear the Son of God.",
        bibleVerses: [],
      },
    ])
    expect(prismaMock.videoTranscript.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.videoTranscriptChunk.findMany).not.toHaveBeenCalled()
  })

  it("orders beats by beatIndex and projects the same lean field set", async () => {
    prismaMock.videoMomentEditorial.findMany.mockResolvedValueOnce([beat()])

    await listVideoMoments({ videoId: "v-1" })

    const call = prismaMock.videoMomentEditorial.findMany.mock.calls[0]![0] as {
      where: unknown
      orderBy: unknown
      select: Record<string, boolean>
    }
    expect(call.where).toEqual({ videoId: "v-1", languageSlug: "en" })
    expect(call.orderBy).toEqual({ beatIndex: "asc" })
    // `question` deliberately absent until phase 2 exposes it on the wire.
    expect(Object.keys(call.select).sort()).toEqual([
      "bibleVerses",
      "endSeconds",
      "startSeconds",
      "summary",
    ])
  })

  it("keeps the chunk path byte-identical when no editorial rows exist", async () => {
    // Regression pin for every un-enriched film in the catalog.
    prismaMock.videoTranscript.findFirst.mockResolvedValueOnce({ id: "t-1" })
    prismaMock.videoTranscriptChunk.findMany.mockResolvedValueOnce([chunk()])

    const moments = await listVideoMoments({ videoId: "v-1" })

    expect(moments).toEqual([
      {
        startSeconds: 30,
        endSeconds: 60,
        summary: "Jesus teaches on the hillside",
        bibleVerses: ["Matthew 5:3-12"],
      },
    ])
  })

  it("walks the full ladder: requested editorial -> requested chunks -> en editorial -> en chunks", async () => {
    // Spanish request; nothing exists in Spanish, English has editorial beats.
    prismaMock.videoMomentEditorial.findMany
      .mockResolvedValueOnce([]) // spanish editorial
      .mockResolvedValueOnce([beat()]) // en editorial
    prismaMock.videoTranscript.findFirst.mockResolvedValueOnce(null) // spanish chunks

    const moments = await listVideoMoments({
      videoId: "v-1",
      languageSlug: "es",
    })

    expect(moments).toHaveLength(1)
    const editorialLangs =
      prismaMock.videoMomentEditorial.findMany.mock.calls.map(
        (call) =>
          (call[0] as { where: { languageSlug: string } }).where.languageSlug,
      )
    expect(editorialLangs).toEqual(["es", "en"])
    // en editorial won, so the en transcript lookup never ran.
    expect(prismaMock.videoTranscript.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.videoTranscriptChunk.findMany).not.toHaveBeenCalled()
  })

  it("prefers requested-language CHUNKS over English editorial (language beats source)", async () => {
    // A film reviewed only in English still serves Spanish chunks to a
    // Spanish request — language fidelity outranks editorial polish.
    prismaMock.videoMomentEditorial.findMany.mockResolvedValueOnce([]) // spanish editorial
    prismaMock.videoTranscript.findFirst.mockResolvedValueOnce({ id: "t-es" })
    prismaMock.videoTranscriptChunk.findMany.mockResolvedValueOnce([chunk()])

    const moments = await listVideoMoments({
      videoId: "v-1",
      languageSlug: "es",
    })

    expect(moments).toHaveLength(1)
    expect(prismaMock.videoMomentEditorial.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.videoTranscriptChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transcriptId: "t-es" } }),
    )
  })

  it("clamps the editorial take with the same [1, MAX] rule", async () => {
    prismaMock.videoMomentEditorial.findMany.mockResolvedValue([beat()])

    await listVideoMoments({ videoId: "v-1", limit: 100_000 })
    const call = prismaMock.videoMomentEditorial.findMany.mock.calls.at(-1)!
    expect((call[0] as { take: number }).take).toBe(MAX_VIDEO_MOMENTS)
  })

  it("blanks a whitespace-only beat summary to null (one wire shape)", async () => {
    prismaMock.videoMomentEditorial.findMany.mockResolvedValueOnce([
      beat({ summary: "   " }),
    ])

    const [moment] = await listVideoMoments({ videoId: "v-1" })
    expect(moment!.summary).toBeNull()
  })
})
