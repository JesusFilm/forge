import { beforeEach, describe, expect, it, vi } from "vitest"

const { coreQueryMock, syncVideoLocalizedMetadataMock } = vi.hoisted(() => ({
  coreQueryMock: vi.fn(),
  syncVideoLocalizedMetadataMock: vi.fn(),
}))

vi.mock("@/services/core-sync/core-client", () => ({
  coreQuery: coreQueryMock,
}))

vi.mock("@/services/core-sync/video-localized-metadata", () => ({
  syncVideoLocalizedMetadata: syncVideoLocalizedMetadataMock,
}))

import { CORE_SYNC_TRANSACTION_OPTIONS } from "@/services/core-sync/transaction-options"
import {
  parseArgs,
  runBackfill,
  validateArgs,
} from "./backfill-video-localized-metadata"

function baseResult(overrides = {}) {
  return {
    videosProcessed: 1,
    videoLocalesUpserted: 1,
    videoLocalesStaled: 0,
    studyQuestionsUpserted: 1,
    studyQuestionsStaled: 0,
    skippedLanguages: 0,
    errors: 0,
    diagnostics: [],
    ...overrides,
  }
}

function buildPrisma() {
  const tx = {}
  return {
    tx,
    video: {
      findMany: vi.fn(),
    },
    language: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "language-en",
          coreId: "lang-en",
          bcp47: "en",
          slug: "english",
        },
        {
          id: "language-ru",
          coreId: "lang-ru",
          bcp47: "ru",
          slug: "russian",
        },
      ]),
    },
    videoLocale: {
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    videoStudyQuestion: {
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  }
}

describe("backfill-video-localized-metadata args", () => {
  beforeEach(() => {
    coreQueryMock.mockReset()
    syncVideoLocalizedMetadataMock.mockReset()
  })

  it("defaults to dry-run and rejects broad runs without a guard", () => {
    const args = parseArgs([])

    expect(args.execute).toBe(false)
    expect(args.verbose).toBe(false)
    expect(() => validateArgs(args)).toThrow(/Refusing broad backfill/)
  })

  it("allows explicit full-catalog execution", () => {
    const args = parseArgs([
      "--full-catalog",
      "--execute",
      "--verbose",
      "--batch-size=5",
      "--resume-after=2026-06-02T03:30:00.000Z",
      "--transaction-timeout-ms=900000",
    ])

    expect(args).toMatchObject({
      fullCatalog: true,
      execute: true,
      verbose: true,
      batchSize: 5,
      resumeAfter: new Date("2026-06-02T03:30:00.000Z"),
      transactionTimeoutMs: 900000,
    })
    expect(() => validateArgs(args)).not.toThrow()
  })

  it("rejects an invalid resume cutoff", () => {
    expect(() => parseArgs(["--resume-after=not-a-date"])).toThrow(
      /--resume-after must be a valid ISO date/,
    )
  })

  it("allows a targeted dry-run by slug", () => {
    const args = parseArgs(["--slug=parable-of-the-pharisee-and-tax-collector"])

    expect(args.execute).toBe(false)
    expect(args.slug).toBe("parable-of-the-pharisee-and-tax-collector")
    expect(() => validateArgs(args)).not.toThrow()
  })

  it("dry-runs selected videos without fetching Core or writing rows", async () => {
    const prisma = buildPrisma()
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-video-1",
        source: "CORE",
        publishedAt: null,
      },
    ])

    const summary = await runBackfill(prisma as never, {
      slug: "jesus",
      fullCatalog: false,
      execute: false,
      verbose: false,
      batchSize: 10,
    })

    expect(summary).toMatchObject({
      dryRun: true,
      selected: 1,
      videosProcessed: 0,
      videoLocaleDuplicateBcp47Groups: 0,
      studyQuestionDuplicateBcp47Groups: 0,
      videoLocaleExactIdentityWithoutBcp47: 0,
      studyQuestionExactIdentityWithoutBcp47: 0,
    })
    expect(coreQueryMock).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(syncVideoLocalizedMetadataMock).not.toHaveBeenCalled()
    expect(prisma.videoLocale.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["videoId", "locale"],
        where: expect.objectContaining({
          videoId: { in: ["video-1"] },
          source: "CORE",
          deletedAt: null,
          locale: { not: null },
        }),
      }),
    )
  })

  it("executes in batches with the shared sync transaction options and lock checks", async () => {
    const prisma = buildPrisma()
    const assertLockActive = vi.fn().mockResolvedValue(undefined)
    const onProgress = vi.fn()
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-video-1",
        source: "CORE",
        publishedAt: null,
      },
      {
        id: "video-2",
        coreId: "core-video-2",
        source: "CORE",
        publishedAt: null,
      },
    ])
    coreQueryMock
      .mockResolvedValueOnce({
        data: { videos: [{ id: "core-video-1", title: [] }] },
      })
      .mockResolvedValueOnce({
        data: { videos: [{ id: "core-video-2", title: [] }] },
      })
    syncVideoLocalizedMetadataMock
      .mockResolvedValueOnce(baseResult({ videoLocalesUpserted: 2 }))
      .mockResolvedValueOnce(baseResult({ studyQuestionsUpserted: 3 }))

    const summary = await runBackfill(
      prisma as never,
      {
        fullCatalog: true,
        execute: true,
        verbose: false,
        batchSize: 1,
        transactionTimeoutMs: 900000,
      },
      { assertLockActive, onProgress },
    )

    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      ...CORE_SYNC_TRANSACTION_OPTIONS,
      timeout: 900000,
    })
    expect(coreQueryMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        offset: 0,
        limit: 1,
        where: { published: true, ids: ["core-video-1"] },
      }),
    )
    expect(coreQueryMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        offset: 0,
        limit: 1,
        where: { published: true, ids: ["core-video-2"] },
      }),
    )
    expect(assertLockActive).toHaveBeenCalledTimes(4)
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        batch: 1,
        batches: 2,
        batchSize: 1,
        selected: 2,
        selectedProcessed: 1,
        coreVideosFetched: 1,
        videosProcessed: 1,
        videoLocalesUpserted: 2,
      }),
    )
    expect(onProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        batch: 2,
        batches: 2,
        selected: 2,
        selectedProcessed: 2,
        videosProcessed: 2,
        studyQuestionsUpserted: 4,
      }),
    )
    expect(syncVideoLocalizedMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prisma: prisma.tx,
        languageIdByCoreId: new Map([
          ["lang-en", "language-en"],
          ["lang-ru", "language-ru"],
        ]),
        bcp47ByCoreId: new Map([
          ["lang-en", "en"],
          ["lang-ru", "ru"],
        ]),
        slugByCoreId: new Map([
          ["lang-en", "english"],
          ["lang-ru", "russian"],
        ]),
        complete: true,
      }),
    )
    expect(summary).toMatchObject({
      dryRun: false,
      selected: 2,
      videosProcessed: 2,
      videoLocalesUpserted: 3,
      studyQuestionsUpserted: 4,
    })
  })

  it("can resume after a previous run by skipping recently synced Core locale rows", async () => {
    const prisma = buildPrisma()
    const resumeAfter = new Date("2026-06-02T03:30:00.000Z")
    prisma.video.findMany.mockResolvedValueOnce([])

    await runBackfill(prisma as never, {
      fullCatalog: true,
      execute: false,
      verbose: false,
      batchSize: 10,
      resumeAfter,
    })

    expect(prisma.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: "CORE",
          deletedAt: null,
          locales: {
            none: {
              source: "CORE",
              deletedAt: null,
              languageCoreId: { not: null },
              syncedAt: { gte: resumeAfter },
            },
          },
        }),
      }),
    )
  })

  it("reports localized variant coverage diagnostics after execution", async () => {
    const prisma = buildPrisma()
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-video-1",
        source: "CORE",
        publishedAt: null,
      },
    ])
    prisma.videoLocale.groupBy.mockResolvedValueOnce([
      {
        videoId: "video-1",
        locale: "pt",
        _count: { _all: 2 },
      },
      {
        videoId: "video-1",
        locale: "ru",
        _count: { _all: 1 },
      },
    ])
    prisma.videoStudyQuestion.groupBy.mockResolvedValueOnce([
      {
        videoId: "video-1",
        locale: "pt",
        _count: { _all: 2 },
      },
    ])
    prisma.videoLocale.count.mockResolvedValueOnce(1)
    prisma.videoStudyQuestion.count.mockResolvedValueOnce(2)
    coreQueryMock.mockResolvedValueOnce({
      data: { videos: [{ id: "core-video-1", title: [] }] },
    })
    syncVideoLocalizedMetadataMock.mockResolvedValueOnce(baseResult())

    const summary = await runBackfill(prisma as never, {
      slug: "jesus",
      fullCatalog: false,
      execute: true,
      verbose: false,
      batchSize: 10,
    })

    expect(summary).toMatchObject({
      dryRun: false,
      selected: 1,
      videoLocaleDuplicateBcp47Groups: 1,
      studyQuestionDuplicateBcp47Groups: 1,
      videoLocaleExactIdentityWithoutBcp47: 1,
      studyQuestionExactIdentityWithoutBcp47: 2,
    })
  })
})
