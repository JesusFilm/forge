import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../core-client", () => ({
  coreQuery: vi.fn(),
  CoreGraphQLError: class CoreGraphQLError extends Error {
    constructor(
      readonly errors: Array<{
        message: string
        path?: ReadonlyArray<string | number>
        extensions?: Record<string, unknown>
      }>,
    ) {
      super(
        `Core API returned GraphQL errors: ${errors
          .map((e) => e.message)
          .join("; ")}`,
      )
      this.name = "CoreGraphQLError"
    }
  },
}))

import { coreQuery } from "../core-client"
import { PAGE_SIZE, syncDubs } from "./sync-dubs"

const mockedCoreQuery = vi.mocked(coreQuery)

type TxFake = {
  videoDub: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
  }
  videoEdition: { upsert: ReturnType<typeof vi.fn> }
  muxVideo: { upsert: ReturnType<typeof vi.fn> }
  videoDubDownload: {
    upsert: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  $executeRaw: ReturnType<typeof vi.fn>
  $queryRaw: ReturnType<typeof vi.fn>
}

function makeTxFake(): TxFake {
  return {
    videoDub: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({ id: "dub-1" }),
    },
    videoEdition: {
      upsert: vi.fn().mockResolvedValue({ id: "edition-admin-1" }),
    },
    muxVideo: {
      upsert: vi.fn().mockResolvedValue({ id: "mux-admin-1" }),
    },
    videoDubDownload: {
      upsert: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi
      .fn()
      .mockResolvedValue([{ coreId: "mux-1", id: "mux-admin-1" }]),
  }
}

function makePrismaFake({
  videos = [{ id: "video-1", coreId: "video-core-1" }],
  languages = [{ id: "language-1", coreId: "lang-en" }],
  videoEditions = [{ id: "edition-admin-1", coreId: "edition-1" }],
  tx,
  executeRawResult = 0,
}: {
  videos?: Array<{ id: string; coreId: string }>
  languages?: Array<{ id: string; coreId: string }>
  videoEditions?: Array<{ id: string; coreId: string }>
  tx: TxFake
  executeRawResult?: number
}) {
  return {
    video: {
      findMany: vi.fn().mockResolvedValue(videos),
    },
    language: {
      findMany: vi.fn().mockResolvedValue(languages),
    },
    videoEdition: {
      findMany: vi.fn().mockResolvedValue(videoEditions),
    },
    $transaction: vi.fn(async (fn: (trx: TxFake) => Promise<void>) => fn(tx)),
    videoDub: {
      updateMany: vi.fn().mockResolvedValue({ count: executeRawResult }),
    },
    $executeRaw: vi.fn().mockResolvedValue(executeRawResult),
  }
}

describe("syncDubs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes dub rows with pre-synced edition ids and page-level mux metadata", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoVariants: [
          {
            id: "variant-1",
            videoId: "video-core-1",
            slug: "dub",
            language: { id: "lang-en" },
            duration: 10,
            lengthInMilliseconds: "10000",
            hls: "hls",
            dash: "dash",
            share: "share",
            downloadable: true,
            published: true,
            brightcoveId: "brightcove-1",
            videoEdition: { id: "edition-1", name: "Standard" },
            muxVideo: {
              id: "mux-1",
              assetId: "asset",
              playbackId: "playback",
            },
            downloads: [
              {
                id: "download-1",
                quality: "720p",
                size: "1000",
                height: 720,
                width: 1280,
                bitrate: 1200,
                url: "download.mp4",
              },
            ],
          },
        ],
      },
    } as never)

    const tx = makeTxFake()
    const prisma = makePrismaFake({ tx })

    const stats = await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(tx.videoEdition.upsert).not.toHaveBeenCalled()
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    expect(tx.videoDub.upsert).not.toHaveBeenCalled()
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = tx.$executeRaw.mock.calls[0] as [
      ReadonlyArray<string>,
      ...unknown[],
    ]
    const sql = strings.join("?")
    expect(sql).toMatch(/INSERT\s+INTO\s+"?video_dub"?/i)
    expect(sql).toContain('ON CONFLICT ("core_id")')
    expect(sql).toContain("IS DISTINCT FROM")
    expect(values).toHaveLength(17)
    expect(values[1]).toContain("variant-1")
    expect(values[2]).toContain("video-1")
    expect(values[11]).toContain("brightcove-1")
    expect(values[13]).toContain("edition-admin-1")
    expect(values[14]).toContain("mux-admin-1")
    expect(values[16]).toBe(true)
    expect(tx.videoDubDownload.upsert).not.toHaveBeenCalled()
    expect(tx.videoDubDownload.updateMany).not.toHaveBeenCalled()
  })

  it("skips Core variants whose parent video is outside the admin video scope", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoVariants: [
          {
            id: "variant-missing-video",
            videoId: "video-core-missing",
            slug: "missing",
            language: { id: "lang-en" },
            duration: 10,
            lengthInMilliseconds: "10000",
            hls: null,
            dash: null,
            share: null,
            downloadable: false,
            published: true,
            brightcoveId: null,
            videoEdition: null,
            muxVideo: null,
            downloads: [],
          },
          {
            id: "variant-1",
            videoId: "video-core-1",
            slug: "dub",
            language: { id: "lang-en" },
            duration: 10,
            lengthInMilliseconds: "10000",
            hls: null,
            dash: null,
            share: null,
            downloadable: false,
            published: true,
            brightcoveId: null,
            videoEdition: null,
            muxVideo: null,
            downloads: [],
          },
        ],
      },
    } as never)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const tx = makeTxFake()
    const prisma = makePrismaFake({ tx })

    const stats = await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-04-28T00:00:00.000Z",
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.videoDub.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { coreId: { in: ["variant-missing-video", "variant-1"] } },
      }),
    )
    expect(tx.videoDub.findUnique).not.toHaveBeenCalled()
    expect(tx.videoDub.upsert).not.toHaveBeenCalled()
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    const [, ...values] = tx.$executeRaw.mock.calls[0] as [
      ReadonlyArray<string>,
      ...unknown[],
    ]
    expect(values[1]).toContain("variant-1")
    expect(values[1]).not.toContain("variant-missing-video")
    expect(values[16]).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("core-sync.video-dub.skipped-missing-videos"),
    )
    warn.mockRestore()
  })

  it("logs page.error and continues to next page when Core fails one page mid-sweep", async () => {
    // Page 1 (offset=0): a full PAGE_SIZE worth of missing-video variants.
    // We need >= PAGE_SIZE entries so the loop does NOT short-circuit
    // at the `if (rawVariants.length < PAGE_SIZE) break` guard — only
    // then do we exercise the multi-page path through the page rejection.
    // The variants miss the videoMap so processVariantPage is a no-op
    // past the membership check, keeping the test fast.
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      id: `variant-page0-${i}`,
      videoId: "video-core-missing",
      slug: null,
      language: { id: "lang-en" },
      duration: 0,
      lengthInMilliseconds: null,
      hls: null,
      dash: null,
      share: null,
      downloadable: false,
      published: true,
      brightcoveId: null,
      videoEdition: null,
      muxVideo: null,
      downloads: [],
    }))
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariants: fullPage },
    } as never)
    // Page 2: Core throws. The loop must catch, log page.error, and
    // continue to the next page.
    mockedCoreQuery.mockRejectedValueOnce(
      new Error("Core API returned GraphQL errors: Unexpected error."),
    )
    // Page 3: empty page, loop breaks.
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariants: [] },
    } as never)
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    const tx = makeTxFake()
    const prisma = makePrismaFake({ tx })

    const stats = await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(1)
    expect(mockedCoreQuery).toHaveBeenCalledTimes(3)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("core-sync.video-dub.page.error"),
    )
    // Soft-delete is gated on stats.errors === 0; with one page error
    // it must NOT mass-delete based on a partial seen-set.
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.videoDub.updateMany).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it("soft-deletes stale full-sync rows via syncedAt instead of a huge coreId exclusion", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: {
        videoVariants: [
          {
            id: "variant-1",
            videoId: "video-core-1",
            slug: null,
            language: { id: "lang-en" },
            duration: 0,
            lengthInMilliseconds: null,
            hls: null,
            dash: null,
            share: null,
            downloadable: false,
            published: true,
            brightcoveId: null,
            videoEdition: null,
            muxVideo: null,
            downloads: [],
          },
        ],
      },
    } as never)

    const tx = makeTxFake()
    const prisma = makePrismaFake({ tx, executeRawResult: 7 })

    const stats = await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(stats.errors).toBe(0)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.videoDub.updateMany).toHaveBeenCalledWith({
      where: {
        source: "CORE",
        deletedAt: null,
        OR: [{ syncedAt: null }, { syncedAt: { lt: expect.any(Date) } }],
      },
      data: { deletedAt: expect.any(Date) },
    })
    expect(stats.softDeleted).toBe(7)
  })

  it("forwards the since watermark as input.updatedAt.gte and skips soft-delete", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariants: [] },
    } as never)

    const tx = makeTxFake()
    const prisma = makePrismaFake({ tx })

    await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-04-28T00:00:00.000Z",
    })

    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        offset: 0,
        input: { updatedAt: { gte: "2026-04-28T00:00:00.000Z" } },
      }),
    )
    // since is an incremental sync; soft-delete must be skipped to
    // avoid mass-deleting rows the delta did not visit.
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.videoDub.updateMany).not.toHaveBeenCalled()
  })

  it("omits input on full sync so Core returns the entire variant catalogue", async () => {
    mockedCoreQuery.mockResolvedValueOnce({
      data: { videoVariants: [] },
    } as never)
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    const tx = makeTxFake()
    const prisma = makePrismaFake({ tx })

    await syncDubs({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
    })

    expect(mockedCoreQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        offset: 0,
        input: undefined,
      }),
    )
    // empty_first_page guard: full sync, page 0 returned []. The phase
    // must skip soft-delete (defensive against treating an empty Core
    // response as "every dub deleted") and emit the structured warn.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("core-sync.video-dub.soft-delete.skipped"),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("empty_first_page"),
    )
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.videoDub.updateMany).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
