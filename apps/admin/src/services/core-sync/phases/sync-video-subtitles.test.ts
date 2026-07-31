import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  assertSyncLockHeld: vi.fn(),
  coreQuery: vi.fn(),
  fetchManifest: vi.fn(),
}))

vi.mock("../lock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lock")>()),
  assertSyncLockHeld: mocks.assertSyncLockHeld,
}))

vi.mock("../core-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core-client")>()),
  coreQuery: mocks.coreQuery,
}))

vi.mock("../video-subtitle-checksum", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../video-subtitle-checksum")>()),
  fetchVideoSubtitleChecksumManifest: mocks.fetchManifest,
}))

import { CoreGraphQLError } from "../core-client"
import type { SubtitleParityDiagnostic } from "../types"
import {
  buildVideoSubtitleChecksumManifest,
  type VideoSubtitleChecksumSourceRecord,
} from "../video-subtitle-checksum"
import { syncVideoSubtitles } from "./sync-video-subtitles"

const ROOT = `sha256:${"a".repeat(64)}`

function source(
  overrides: Partial<VideoSubtitleChecksumSourceRecord> = {},
): VideoSubtitleChecksumSourceRecord {
  return {
    id: "subtitle-1",
    videoId: "video-1",
    languageId: "21028",
    edition: "ot",
    primary: true,
    vttSrc: "https://cdn.example/video-1_ot_21028.vtt",
    vttVersion: 7,
    srtSrc: null,
    srtVersion: 2,
    ...overrides,
  }
}

function adminRow(
  value: VideoSubtitleChecksumSourceRecord,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `admin-${value.id}`,
    coreId: value.id,
    videoId: `admin-${value.videoId}`,
    primary: value.primary,
    vttSrc: value.vttSrc,
    vttVersion: value.vttVersion,
    srtSrc: value.srtSrc,
    srtVersion: value.srtVersion,
    video: { coreId: value.videoId, deletedAt: null },
    language: { coreId: value.languageId, deletedAt: null },
    videoEdition: { name: value.edition, deletedAt: null },
    ...overrides,
  }
}

function priorDiagnostic(): SubtitleParityDiagnostic {
  return {
    version: 1,
    latestAttempt: {
      checkId: "prior-attempt",
      startedAt: "2026-07-29T00:00:00.000Z",
      completedAt: "2026-07-29T00:01:00.000Z",
      status: "completed",
    },
    lastCompleted: {
      checkId: "prior-completed",
      startedAt: "2026-07-29T00:00:00.000Z",
      completedAt: "2026-07-29T00:01:00.000Z",
      status: "in-sync",
      manifestVersion: 1,
      core: { snapshot: "prior", rootChecksum: ROOT, totalCount: 1 },
      admin: {
        rootChecksum: ROOT,
        totalCount: 1,
        unprojectableCount: 0,
      },
      initialMismatchTotal: 0,
      repairedTotal: 0,
      residualTotal: 0,
      initialMismatchVideoIds: [],
      repairedVideoIds: [],
      residualVideoIds: [],
      residualReasons: [],
      residualReasonTruncatedCount: 0,
    },
    lastInParity: {
      checkId: "prior-completed",
      completedAt: "2026-07-29T00:01:00.000Z",
      snapshot: "prior",
      rootChecksum: ROOT,
      totalCount: 1,
    },
  }
}

type HarnessOptions = {
  projectionRows?: unknown[][]
  videos?: Array<{ id: string; coreId: string }>
  languages?: Array<{ id: string; coreId: string }>
  activeEditions?: Array<{ id: string; coreId: string; name: string }>
  sameVideoEditions?: Array<{ id: string; coreId: string; name: string }>
  existingRows?: Array<{
    coreId: string
    source: string
    videoId: string | null
  }>
  affected?: number
  softDeleted?: number
  previous?: SubtitleParityDiagnostic | null
}

function harness(options: HarnessOptions = {}) {
  const projectionFindMany = vi.fn()
  for (const rows of options.projectionRows ?? [[]]) {
    projectionFindMany.mockResolvedValueOnce(rows)
  }

  const activeEditions = options.activeEditions ?? [
    { id: "admin-edition-ot", coreId: "core-edition-ot", name: "ot" },
  ]
  const sameVideoEditions = options.sameVideoEditions ?? activeEditions
  const videoEditionFindMany = vi.fn((args: { where?: { OR?: unknown } }) =>
    Promise.resolve(args.where?.OR ? sameVideoEditions : activeEditions),
  )
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(options.existingRows ?? []),
    $executeRaw: vi.fn().mockResolvedValue(options.affected ?? 1),
    videoSubtitle: {
      updateMany: vi
        .fn()
        .mockResolvedValue({ count: options.softDeleted ?? 0 }),
    },
  }
  const prisma = {
    syncState: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options.previous === undefined
            ? null
            : { stats: { subtitleParity: options.previous } },
        ),
    },
    videoSubtitle: { findMany: projectionFindMany },
    video: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          options.videos ?? [{ id: "admin-video-1", coreId: "video-1" }],
        ),
    },
    language: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          options.languages ?? [{ id: "admin-language", coreId: "21028" }],
        ),
    },
    videoEdition: { findMany: videoEditionFindMany },
    $transaction: vi.fn(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    ),
  }
  return { prisma, tx, projectionFindMany, videoEditionFindMany }
}

function progress() {
  return { setTotal: vi.fn(), increment: vi.fn() }
}

function snapshotMismatch() {
  return new CoreGraphQLError([
    {
      message: "snapshot changed",
      extensions: { code: "SUBTITLE_SNAPSHOT_MISMATCH" },
    },
  ])
}

describe("syncVideoSubtitles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertSyncLockHeld.mockResolvedValue(undefined)
  })

  it("uses equal roots as a zero-detail, zero-write result even with a watermark", async () => {
    const record = source()
    const manifest = buildVideoSubtitleChecksumManifest([record])
    mocks.fetchManifest.mockResolvedValueOnce(manifest)
    const { prisma } = harness({ projectionRows: [[adminRow(record)]] })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      since: "2020-01-01T00:00:00.000Z",
      lockOwnerId: "run-1",
    })

    expect(stats.errors).toBe(0)
    expect(stats.subtitleParity?.lastCompleted?.status).toBe("in-sync")
    expect(mocks.fetchManifest).toHaveBeenCalledTimes(1)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.coreQuery).not.toHaveBeenCalled()
  })

  it("repairs the JESUS OT subtitle through the normal mismatch path", async () => {
    const jesus = source({
      id: "jesus-ot-en",
      videoId: "1_jf-0-0",
      languageId: "21028",
      edition: "ot",
      vttSrc: "https://cdn.example/1_jf-0-0_ot_21028.vtt",
      vttVersion: 11,
      srtVersion: 4,
    })
    const core = buildVideoSubtitleChecksumManifest([jesus])
    const detail = buildVideoSubtitleChecksumManifest([jesus], ["1_jf-0-0"])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(core)
    const { prisma, tx } = harness({
      projectionRows: [[], [adminRow(jesus)]],
      videos: [{ id: "admin-jesus", coreId: "1_jf-0-0" }],
      existingRows: [
        { coreId: jesus.id, source: "core", videoId: "admin-jesus" },
      ],
      affected: 1,
      sameVideoEditions: [
        { id: "admin-edition-ot", coreId: "core-edition-ot", name: "ot" },
      ],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-jesus",
    })

    expect(stats).toMatchObject({ errors: 0, updated: 1 })
    expect(stats.subtitleParity?.lastCompleted).toMatchObject({
      status: "in-sync",
      initialMismatchTotal: 1,
      repairedTotal: 1,
      residualTotal: 0,
      repairedVideoIds: ["1_jf-0-0"],
    })
    expect(mocks.fetchManifest.mock.calls[1]?.[0]).toEqual({
      detailsForVideoIds: ["1_jf-0-0"],
      expectedSnapshot: core.snapshot,
    })
    expect(mocks.assertSyncLockHeld).toHaveBeenCalledWith(tx, "run-jesus")
    const sql = tx.$executeRaw.mock.calls[0]?.[0] as PrismaSql
    expect(sql.values).toEqual(
      expect.arrayContaining([
        "jesus-ot-en",
        "admin-jesus",
        "admin-language",
        11,
        4,
      ]),
    )
    expect(tx.videoSubtitle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          videoId: "admin-jesus",
          source: "CORE",
        }),
      }),
    )
  })

  it("soft-deletes only inside a video after a validated explicit empty detail", async () => {
    const extra = source()
    const core = buildVideoSubtitleChecksumManifest([])
    const detail = buildVideoSubtitleChecksumManifest([], ["video-1"])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(core)
    const { prisma, tx } = harness({
      projectionRows: [[adminRow(extra)], []],
      affected: 0,
      softDeleted: 1,
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-delete",
    })

    expect(stats.softDeleted).toBe(1)
    expect(stats.subtitleParity?.lastCompleted?.status).toBe("in-sync")
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    const deletion = tx.videoSubtitle.updateMany.mock.calls[0]?.[0]
    expect(deletion.where).toEqual({
      videoId: "admin-video-1",
      source: "CORE",
      deletedAt: null,
    })
  })

  it("leaves the whole video residual when Manager owns a requested Core ID", async () => {
    const record = source()
    const core = buildVideoSubtitleChecksumManifest([record])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(
        buildVideoSubtitleChecksumManifest([record], ["video-1"]),
      )
      .mockResolvedValueOnce(core)
    const { prisma, tx } = harness({
      projectionRows: [[], []],
      existingRows: [
        {
          coreId: record.id,
          source: "manager",
          videoId: "admin-video-1",
        },
      ],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-collision",
    })

    expect(stats.errors).toBe(0)
    expect(stats.subtitleParity?.lastCompleted).toMatchObject({
      status: "out-of-sync",
      residualTotal: 1,
      residualVideoIds: ["video-1"],
    })
    expect(stats.subtitleParity?.lastCompleted?.residualReasons[0]?.code).toBe(
      "subtitle-id-owned-elsewhere",
    )
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(tx.videoSubtitle.updateMany).not.toHaveBeenCalled()
  })

  it("reports unresolved dependencies as parity residuals without failing execution", async () => {
    const record = source()
    const core = buildVideoSubtitleChecksumManifest([record])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(
        buildVideoSubtitleChecksumManifest([record], ["video-1"]),
      )
      .mockResolvedValueOnce(core)
    const { prisma } = harness({
      projectionRows: [[], []],
      videos: [],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-missing",
    })

    expect(stats.errors).toBe(0)
    expect(stats.subtitleParity?.lastCompleted).toMatchObject({
      status: "out-of-sync",
      residualTotal: 1,
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("uses a mismatch-scoped Core relation lookup for a new edition", async () => {
    const record = source()
    const core = buildVideoSubtitleChecksumManifest([record])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(
        buildVideoSubtitleChecksumManifest([record], ["video-1"]),
      )
      .mockResolvedValueOnce(core)
    mocks.coreQuery.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "video-1",
            videoEditions: [{ id: "core-edition-ot", name: "ot" }],
          },
        ],
      },
    })
    const { prisma } = harness({
      projectionRows: [[], [adminRow(record)]],
      sameVideoEditions: [],
      affected: 1,
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-fallback",
    })

    expect(stats.errors).toBe(0)
    expect(stats.subtitleParity?.lastCompleted?.status).toBe("in-sync")
    expect(mocks.coreQuery).toHaveBeenCalledWith(
      expect.stringContaining("VideoSubtitleEditionRelations"),
      { videoIds: ["video-1"], limit: 1 },
      { requireInteropToken: true },
    )
  })

  it("restarts discovery once when the Core snapshot changes", async () => {
    const record = source()
    const core = buildVideoSubtitleChecksumManifest([record])
    const detail = buildVideoSubtitleChecksumManifest([record], ["video-1"])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockRejectedValueOnce(snapshotMismatch())
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(core)
    const { prisma } = harness({
      projectionRows: [[], [], [adminRow(record)]],
      affected: 1,
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-retry",
    })

    expect(stats.errors).toBe(0)
    expect(mocks.fetchManifest).toHaveBeenCalledTimes(5)
    expect(stats.subtitleParity?.lastCompleted?.status).toBe("in-sync")
  })

  it("fails closed after a second snapshot mismatch and preserves prior evidence", async () => {
    const record = source()
    const core = buildVideoSubtitleChecksumManifest([record])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockRejectedValueOnce(snapshotMismatch())
      .mockResolvedValueOnce(core)
      .mockRejectedValueOnce(snapshotMismatch())
    const previous = priorDiagnostic()
    const { prisma } = harness({
      projectionRows: [[], []],
      previous,
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-unstable",
    })

    expect(stats.errors).toBe(1)
    expect(stats.subtitleParity?.latestAttempt).toMatchObject({
      status: "failed",
      failure: { code: "SUBTITLE_SNAPSHOT_UNSTABLE" },
    })
    expect(stats.subtitleParity?.lastCompleted?.checkId).toBe("prior-completed")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("fails the attempt and performs no delete when the lock fence is lost", async () => {
    const record = source()
    const core = buildVideoSubtitleChecksumManifest([record])
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(
        buildVideoSubtitleChecksumManifest([record], ["video-1"]),
      )
    mocks.assertSyncLockHeld.mockRejectedValueOnce(new Error("lock lost"))
    const { prisma, tx } = harness({ projectionRows: [[]] })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-lock-lost",
    })

    expect(stats.errors).toBe(1)
    expect(stats.subtitleParity?.latestAttempt.status).toBe("failed")
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(tx.videoSubtitle.updateMany).not.toHaveBeenCalled()
  })

  it("batches detail requests at 100 video IDs and samples diagnostics", async () => {
    const records = Array.from({ length: 101 }, (_, index) =>
      source({
        id: `subtitle-${index}`,
        videoId: `video-${index.toString().padStart(3, "0")}`,
      }),
    )
    const core = buildVideoSubtitleChecksumManifest(records)
    const firstIds = core.buckets.slice(0, 100).map((bucket) => bucket.videoId)
    const secondIds = core.buckets.slice(100).map((bucket) => bucket.videoId)
    mocks.fetchManifest
      .mockResolvedValueOnce(core)
      .mockResolvedValueOnce(
        buildVideoSubtitleChecksumManifest(records, firstIds),
      )
      .mockResolvedValueOnce(
        buildVideoSubtitleChecksumManifest(records, secondIds),
      )
      .mockResolvedValueOnce(core)
    const { prisma } = harness({
      projectionRows: [[], []],
      videos: [],
    })

    const stats = await syncVideoSubtitles({
      prisma: prisma as never,
      progress: progress(),
      lockOwnerId: "run-batch",
    })

    expect(
      mocks.fetchManifest.mock.calls[1]?.[0].detailsForVideoIds,
    ).toHaveLength(100)
    expect(
      mocks.fetchManifest.mock.calls[2]?.[0].detailsForVideoIds,
    ).toHaveLength(1)
    expect(stats.subtitleParity?.lastCompleted).toMatchObject({
      status: "out-of-sync",
      residualTotal: 101,
    })
    expect(stats.subtitleParity?.lastCompleted?.residualVideoIds).toHaveLength(
      20,
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

type PrismaSql = { values: unknown[] }
