import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    CORE_API_TOKEN: undefined as string | undefined,
  },
}))
vi.mock("@/config/env", () => mockEnv)

import { syncVideos } from "./sync-videos"

// Contract test against Core's field-level authorization, driven through the
// REAL coreQuery (only global fetch is faked). Core gates the `adminVideos`
// root field — and every Video field it selects, including
// `restrictViewPlatforms` — behind `t.withAuth({ isPublisher: true })` in
// api-media. Core Sync's videos phase moved onto `adminVideos` so it can
// observe Watch restrictions the public `videos` field hides from a caller
// identifying as `watch` (JesusFilm/forge#2324): the public field applies
// `filter.NOT = { restrictViewPlatforms: { has: clientName } }` keyed on the
// caller's own `x-graphql-client-name`, so a sync that exists to observe that
// restriction could never see the rows it cared about.
//
// Whether `CORE_API_TOKEN` actually carries publisher authorization in
// production is a live-gateway question this suite cannot answer — see
// `docs/solutions/architecture-patterns/self-defeating-identity-filter-observer-client-20261022.md`
// for the dated probe transcript and the required post-deploy confirmation
// step. What this suite CAN pin is the shape of both outcomes: authorized,
// the phase succeeds and writes the restriction; unauthorized, it fails
// loudly instead of silently falling back to an empty catalogue.
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
  restrictViewPlatforms: ["watch"],
  updatedAt: "2026-09-14T00:00:00.000Z",
}

function fakeCore() {
  const requests: FakeCoreRequest[] = []
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as FakeCoreRequest
    requests.push(body)
    const headers = init.headers as Record<string, string>

    if (!selectsField(body.query, "adminVideos")) {
      throw new Error(
        "expected the videos phase to query Core's publisher-gated adminVideos field",
      )
    }

    if (!headers.authorization) {
      return {
        ok: true,
        json: async () => ({
          data: null,
          errors: [
            {
              message: "Not authorized to resolve Query.adminVideos",
              path: ["adminVideos"],
              extensions: {
                code: "DOWNSTREAM_SERVICE_ERROR",
                serviceName: "api-media",
              },
            },
          ],
        }),
      }
    }

    const offset = Number(body.variables?.offset ?? 0)
    return {
      ok: true,
      json: async () => ({
        data: {
          adminVideos: offset === 0 ? [breakingPoint] : [],
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

describe("syncVideos against Core's publisher field authorization", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    mockEnv.env.CORE_API_TOKEN = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("syncs a video's restriction state when Core authorizes the publisher field", async () => {
    mockEnv.env.CORE_API_TOKEN = "publisher-token"
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
      expect.objectContaining({
        where: { coreId: "7_KnowGodBP" },
        update: expect.objectContaining({ restrictViewPlatforms: ["watch"] }),
      }),
    )
    for (const request of requests) {
      expect(selectsField(request.query, "adminVideos")).toBe(true)
      for (const field of CORE_PUBLISHER_GATED_VIDEO_FIELDS) {
        if (field === "restrictViewPlatforms") continue
        expect(selectsField(request.query, field)).toBe(false)
      }
    }
  })

  it("fails the phase instead of silently emptying the catalogue when unauthorized", async () => {
    // Without a publisher credential, Core rejects the whole page with a
    // GraphQL error rather than an empty list — the right failure mode. A
    // misconfigured CORE_API_TOKEN must surface as a failed sync, never as a
    // clean run that quietly stopped observing restrictions again.
    const { fetchMock } = fakeCore()
    vi.stubGlobal("fetch", fetchMock)
    const { prisma, tx } = fakePrisma()

    await expect(
      syncVideos({
        prisma: prisma as never,
        progress: { setTotal: vi.fn(), increment: vi.fn() },
        since: "2026-08-03T11:02:48.000Z",
      }),
    ).rejects.toThrow(/Not authorized to resolve Query\.adminVideos/)

    expect(tx.video.upsert).not.toHaveBeenCalled()
  })

  it("keeps sending x-graphql-client-name: watch alongside the publisher credential", async () => {
    // Deliberate and load-bearing: Core's downloads resolver keys off this
    // same header, so dropping it would silently change which download
    // variants the sync observes. The publisher field applies no restriction
    // filter, so the header is inert for THIS query — but it must stay.
    mockEnv.env.CORE_API_TOKEN = "publisher-token"
    const { fetchMock } = fakeCore()
    vi.stubGlobal("fetch", fetchMock)
    const { prisma } = fakePrisma()

    await syncVideos({
      prisma: prisma as never,
      progress: { setTotal: vi.fn(), increment: vi.fn() },
      since: "2026-08-03T11:02:48.000Z",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-graphql-client-name": "watch",
          authorization: "Bearer publisher-token",
        }),
      }),
    )
  })
})
