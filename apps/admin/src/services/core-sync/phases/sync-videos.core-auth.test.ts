import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { syncVideos } from "./sync-videos"

// Contract test against Core's field-level authorization, driven through the
// REAL coreQuery (only global fetch is faked). Core's api-media gates these
// Video fields behind `t.withAuth({ isPublisher: true })`, and Forge's sync
// runs without a publisher credential, so selecting any of them makes Core
// answer the whole page with a GraphQL error instead of data. PR #1829 added
// `restrictViewPlatforms` to VIDEOS_QUERY, which failed every nightly
// `videos` phase from 2026-08-10 until it was removed.
const CORE_PUBLISHER_GATED_VIDEO_FIELDS = [
  "restrictViewPlatforms",
  "restrictDownloadPlatforms",
] as const

type FakeCoreRequest = {
  query: string
  variables?: Record<string, unknown>
}

function selectsField(query: string, field: string): boolean {
  return new RegExp(`\\b${field}\\b`).test(query)
}

const breakingPoint = {
  id: "7_KnowGodBP",
  slug: "breaking-point",
  label: "series",
  publishedAt: "2026-09-14T00:00:00.000Z",
  primaryLanguageId: null,
  source: null,
  origin: null,
  title: [],
  description: [],
  snippet: [],
  imageAlt: [],
  studyQuestions: [],
  bibleCitations: [],
  keywords: [],
  children: [],
  locked: false,
  noIndex: false,
  updatedAt: "2026-09-14T00:00:00.000Z",
}

function fakeCore(count = 1) {
  const requests: FakeCoreRequest[] = []
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as FakeCoreRequest
    requests.push(body)
    const headers = init.headers as Record<string, string>

    const gated = CORE_PUBLISHER_GATED_VIDEO_FIELDS.find((field) =>
      selectsField(body.query, field),
    )
    if (gated && !headers.authorization) {
      return {
        ok: true,
        json: async () => ({
          data: null,
          errors: [
            {
              message: `Not authorized to resolve Video.${gated}`,
              path: ["videos", 0, gated],
            },
          ],
        }),
      }
    }

    const offset = Number(body.variables?.offset ?? 0)
    const authorizedGatedValues = Object.fromEntries(
      CORE_PUBLISHER_GATED_VIDEO_FIELDS.filter((field) =>
        selectsField(body.query, field),
      ).map((field) => [field, []]),
    )
    return {
      ok: true,
      json: async () => ({
        data: {
          videos:
            offset === 0
              ? body.query.includes("WatchVideoIds")
                ? [{ id: breakingPoint.id }]
                : [{ ...breakingPoint, ...authorizedGatedValues }]
              : [],
          videosCount: count,
        },
      }),
    }
  })
  return { fetchMock, requests }
}

function fakePrisma() {
  const tx = {
    video: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({ id: "admin-video-bp" }),
    },
    videoLocale: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    videoStudyQuestion: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    bibleCitation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    videoKeyword: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    videoRelation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }
  const prisma = {
    video: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    language: { findMany: vi.fn().mockResolvedValue([]) },
    videoOrigin: { findMany: vi.fn().mockResolvedValue([]) },
    keyword: { findMany: vi.fn().mockResolvedValue([]) },
    bibleBook: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<void>) =>
      fn(tx),
    ),
  }
  return { prisma, tx }
}

describe("syncVideos against Core field authorization", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("syncs a newly published Core video on an incremental run without a publisher credential", async () => {
    const { fetchMock, requests } = fakeCore()
    vi.stubGlobal("fetch", fetchMock)
    const { prisma, tx } = fakePrisma()

    const stats = await syncVideos({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-08-03T11:02:48.000Z",
    })

    expect(stats.errors).toBe(0)
    expect(stats.updated).toBe(1)
    expect(tx.video.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { coreId: "7_KnowGodBP" } }),
    )
    for (const request of requests) {
      for (const field of CORE_PUBLISHER_GATED_VIDEO_FIELDS) {
        expect(selectsField(request.query, field)).toBe(false)
      }
    }
  })

  it("does not remove local CORE videos after a truncated eligibility scan", async () => {
    const { fetchMock } = fakeCore(2)
    vi.stubGlobal("fetch", fetchMock)
    const { prisma } = fakePrisma()
    const stats = await syncVideos({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-08-03T11:02:48.000Z",
    })
    expect(stats.errors).toBe(1)
    expect(prisma.video.updateMany).not.toHaveBeenCalled()
  })

  it("soft-deletes disappeared CORE videos after a complete public ID scan", async () => {
    const { fetchMock } = fakeCore()
    vi.stubGlobal("fetch", fetchMock)
    const { prisma } = fakePrisma()
    prisma.video.updateMany.mockResolvedValue({ count: 1 })
    const stats = await syncVideos({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-08-03T11:02:48.000Z",
    })
    expect(stats.errors).toBe(0)
    expect(stats.softDeleted).toBe(1)
    expect(prisma.video.updateMany).toHaveBeenCalledWith({
      where: {
        source: "CORE",
        coreId: { notIn: ["7_KnowGodBP"] },
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    })
  })
})
