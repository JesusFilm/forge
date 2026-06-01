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
        { id: "language-en", coreId: "lang-en", bcp47: "en" },
        { id: "language-ru", coreId: "lang-ru", bcp47: "ru" },
      ]),
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
    expect(() => validateArgs(args)).toThrow(/Refusing broad backfill/)
  })

  it("allows explicit full-catalog execution", () => {
    const args = parseArgs(["--full-catalog", "--execute", "--batch-size=5"])

    expect(args).toMatchObject({
      fullCatalog: true,
      execute: true,
      batchSize: 5,
    })
    expect(() => validateArgs(args)).not.toThrow()
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
      batchSize: 10,
    })

    expect(summary).toMatchObject({
      dryRun: true,
      selected: 1,
      videosProcessed: 0,
    })
    expect(coreQueryMock).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(syncVideoLocalizedMetadataMock).not.toHaveBeenCalled()
  })

  it("executes in batches with the shared sync transaction options and lock checks", async () => {
    const prisma = buildPrisma()
    const assertLockActive = vi.fn().mockResolvedValue(undefined)
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
        batchSize: 1,
      },
      { assertLockActive },
    )

    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      CORE_SYNC_TRANSACTION_OPTIONS,
    )
    expect(assertLockActive).toHaveBeenCalledTimes(4)
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
})
