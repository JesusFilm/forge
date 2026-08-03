import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  CoreGraphQLError: class CoreGraphQLError extends Error {
    constructor(readonly errors: Array<{ message: string }>) {
      super(errors.map((error) => error.message).join("; "))
      this.name = "CoreGraphQLError"
    }
  },
  coreQuery: vi.fn(),
}))

import { coreQuery } from "../core-client"
import { PAGE_SIZE, syncVideoSubtitles } from "./sync-video-subtitles"

const mockedCoreQuery = vi.mocked(coreQuery)

type SubtitleRow = {
  id: string
  videoId: string
  languageId: string
  primary: boolean
  edition: string
  vttSrc: string | null
  srtSrc: string | null
  value: string
  updatedAt: string
  videoEdition: { id: string }
}

function coreSubtitle(overrides: Partial<SubtitleRow> = {}): SubtitleRow {
  const defaults: SubtitleRow = {
    id: "subtitle-core-1",
    videoId: "video-core-1",
    languageId: "language-core-es",
    primary: true,
    edition: "ot",
    vttSrc: "es.vtt",
    srtSrc: "es.srt",
    value: "Texto de subtitulo",
    updatedAt: "2026-08-03T00:00:00.000Z",
    videoEdition: { id: "edition-core-1" },
  }
  return { ...defaults, ...overrides }
}

function coreRowsPage(rows: SubtitleRow[]) {
  return { data: { videoSubtitles: rows } }
}

function inventoryPage(ids: string[], count = ids.length) {
  return {
    data: {
      videoSubtitlesCount: count,
      videoSubtitles: ids.map((id) => ({ id })),
    },
  }
}

function harness({
  activeCoreIds = [],
  existingRows = [],
  deleteCount = 0,
  videoEditions = [{ id: "edition-admin-1", coreId: "edition-core-1" }],
}: {
  activeCoreIds?: string[][]
  existingRows?: Array<{ coreId: string | null; source: string }>
  deleteCount?: number
  videoEditions?: Array<{ id: string; coreId: string }>
} = {}) {
  const tx = {
    videoSubtitle: {
      findMany: vi.fn().mockResolvedValue(existingRows),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  }
  const activeFindMany = vi.fn()
  for (const ids of activeCoreIds) {
    activeFindMany.mockResolvedValueOnce(ids.map((coreId) => ({ coreId })))
  }
  activeFindMany.mockResolvedValue(
    (activeCoreIds.at(-1) ?? []).map((coreId) => ({ coreId })),
  )

  const prisma = {
    video: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "video-admin-1", coreId: "video-core-1" }]),
    },
    language: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: "language-admin-es", coreId: "language-core-es" },
        ]),
    },
    videoEdition: {
      findMany: vi.fn().mockResolvedValue(videoEditions),
    },
    videoSubtitle: {
      findMany: activeFindMany,
    },
    $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
      fn(tx),
    ),
    $executeRaw: vi.fn().mockResolvedValue(deleteCount),
  }
  return { prisma, tx }
}

function progress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

describe("syncVideoSubtitles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("full-syncs subtitles from Core's flat videoSubtitles endpoint and soft-deletes by verified id inventory", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([coreSubtitle()]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
    const { prisma, tx } = harness({
      activeCoreIds: [["subtitle-core-1"]],
      deleteCount: 2,
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(stats).toMatchObject({ errors: 0, updated: 1, softDeleted: 2 })
    expect(mockedCoreQuery.mock.calls[0]?.[0]).toContain("videoSubtitles")
    expect(mockedCoreQuery.mock.calls[0]?.[0]).not.toContain("videos(")
    expect(mockedCoreQuery.mock.calls[0]?.[1]).toMatchObject({
      offset: 0,
      limit: expect.any(Number),
      where: undefined,
    })
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    const [, ...values] = tx.$executeRaw.mock.calls[0] as [
      ReadonlyArray<string>,
      ...unknown[],
    ]
    expect(values[3]).toContain("edition-admin-1")
    expect(values[4]).toContain("language-admin-es")
    expect(values[5]).toContain("Texto de subtitulo")
    expect(values[7]).toContain("es.vtt")
    expect(values[8]).toContain("es.srt")
    expect(values[9]).toContain("2026-08-03T00:00:00.000Z")
    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    expect(prisma.videoSubtitle.findMany).toHaveBeenCalledWith({
      where: { source: "CORE", deletedAt: null, coreId: { not: null } },
      select: { coreId: true },
    })
    const deleteSql = (
      prisma.$executeRaw.mock.calls[0]?.[0] as ReadonlyArray<string>
    ).join(" ")
    expect(deleteSql).toContain(`"source" = 'core'::"SourceTier"`)
    expect(deleteSql).toContain(`"core_id" IS NOT NULL`)
    expect(deleteSql).toContain("ANY(")
  })

  it("paginates full row sync and both verified inventory reads", async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, index) =>
      coreSubtitle({
        id: `subtitle-core-${index}`,
        value: `Subtitle ${index}`,
      }),
    )
    const inventoryIds = fullPage
      .map((subtitle) => subtitle.id)
      .concat("subtitle-core-last")
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage(fullPage) as never)
      .mockResolvedValueOnce(
        coreRowsPage([
          coreSubtitle({
            id: "subtitle-core-last",
            value: "Final page subtitle",
          }),
        ]) as never,
      )
      .mockResolvedValueOnce(
        inventoryPage(
          fullPage.map((row) => row.id),
          PAGE_SIZE + 1,
        ) as never,
      )
      .mockResolvedValueOnce(
        inventoryPage(["subtitle-core-last"], PAGE_SIZE + 1) as never,
      )
      .mockResolvedValueOnce(
        inventoryPage(
          fullPage.map((row) => row.id),
          PAGE_SIZE + 1,
        ) as never,
      )
      .mockResolvedValueOnce(
        inventoryPage(["subtitle-core-last"], PAGE_SIZE + 1) as never,
      )
    const { prisma } = harness({
      activeCoreIds: [inventoryIds],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(PAGE_SIZE + 1)
    expect(mockedCoreQuery.mock.calls.map((call) => call[1])).toEqual([
      { offset: 0, limit: PAGE_SIZE, where: undefined },
      { offset: PAGE_SIZE, limit: PAGE_SIZE, where: undefined },
      { offset: 0, limit: PAGE_SIZE },
      { offset: PAGE_SIZE, limit: PAGE_SIZE },
      { offset: 0, limit: PAGE_SIZE },
      { offset: PAGE_SIZE, limit: PAGE_SIZE },
    ])
  })

  it("keeps the incremental updatedAt fast path but escalates to full row repair when Admin is missing Core ids", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(coreRowsPage([coreSubtitle()]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
    const { prisma, tx } = harness({
      activeCoreIds: [[], ["subtitle-core-1"]],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      since: "2026-05-07T00:00:00.000Z",
    })

    expect(stats).toMatchObject({ errors: 0, updated: 1 })
    expect(mockedCoreQuery.mock.calls[0]?.[1]).toMatchObject({
      where: { updatedAt: { gte: "2026-05-07T00:00:00.000Z" } },
    })
    expect(mockedCoreQuery.mock.calls[3]?.[1]).toMatchObject({
      where: undefined,
    })
    expect(mockedCoreQuery).toHaveBeenCalledTimes(6)
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
  })

  it("refreshes Core inventory after full repair before authorizing deletes", async () => {
    const repairedRows = [
      coreSubtitle(),
      coreSubtitle({
        id: "subtitle-core-2",
        value: "New subtitle from concurrent Core change",
      }),
    ]
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(coreRowsPage(repairedRows) as never)
      .mockResolvedValueOnce(
        inventoryPage(["subtitle-core-1", "subtitle-core-2"]) as never,
      )
      .mockResolvedValueOnce(
        inventoryPage(["subtitle-core-1", "subtitle-core-2"]) as never,
      )
    const { prisma } = harness({
      activeCoreIds: [[], ["subtitle-core-1", "subtitle-core-2"]],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      since: "2026-05-07T00:00:00.000Z",
    })

    expect(stats.errors).toBe(0)
    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    const [, inventoryArray] = prisma.$executeRaw.mock.calls[0] as [
      ReadonlyArray<string>,
      string,
    ]
    expect(inventoryArray).toContain("subtitle-core-1")
    expect(inventoryArray).toContain("subtitle-core-2")
  })

  it("fails closed and skips deletes when the Core id inventory has duplicate ids", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([]) as never)
      .mockResolvedValueOnce(
        inventoryPage(["subtitle-core-1", "subtitle-core-1"], 2) as never,
      )
    const { prisma } = harness()

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(stats.errors).toBe(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("fails closed and skips deletes when the Core id inventory count mismatches fetched ids", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"], 2) as never)
    const { prisma } = harness()

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(stats.errors).toBe(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("fails closed and skips deletes when the double-read inventory is unstable", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-2"]) as never)
    const { prisma } = harness()

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(stats.errors).toBe(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("keeps successful incremental upserts but skips deletes when inventory fetch fails", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([coreSubtitle()]) as never)
      .mockRejectedValueOnce(new Error("inventory unavailable"))
    const { prisma, tx } = harness()

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      since: "2026-05-07T00:00:00.000Z",
    })

    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(stats).toMatchObject({ updated: 1, errors: 1 })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("does not overwrite manager-owned subtitle rows that happen to carry a Core id", async () => {
    mockedCoreQuery
      .mockResolvedValueOnce(coreRowsPage([coreSubtitle()]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
      .mockResolvedValueOnce(inventoryPage(["subtitle-core-1"]) as never)
    const { prisma, tx } = harness({
      activeCoreIds: [[]],
      existingRows: [{ coreId: "subtitle-core-1", source: "MANAGER" }],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(stats.errors).toBe(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it("fails closed and skips deletes when a Core subtitle cannot resolve its Admin parent", async () => {
    mockedCoreQuery.mockResolvedValueOnce(
      coreRowsPage([
        coreSubtitle({ videoEdition: { id: "missing-edition-core" } }),
      ]) as never,
    )
    const { prisma, tx } = harness()

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(stats.errors).toBe(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockedCoreQuery).toHaveBeenCalledOnce()
  })

  it("fails closed and skips deletes when a Core page request fails", async () => {
    mockedCoreQuery.mockRejectedValueOnce(new Error("Core is unavailable"))
    const { prisma } = harness()

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
    })

    expect(stats.errors).toBe(1)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })
})
