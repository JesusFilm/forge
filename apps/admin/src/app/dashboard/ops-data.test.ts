import { beforeEach, describe, expect, it, vi } from "vitest"

const { userCount, userFindMany, managerMembershipFindMany } = vi.hoisted(
  () => ({
    userCount: vi.fn(),
    userFindMany: vi.fn(),
    managerMembershipFindMany: vi.fn(),
  }),
)
const {
  searchTraceFindMany,
  watchSearchEventFindMany,
  videoFindMany,
  languageFindMany,
} = vi.hoisted(() => ({
  searchTraceFindMany: vi.fn(),
  watchSearchEventFindMany: vi.fn(),
  videoFindMany: vi.fn(),
  languageFindMany: vi.fn(),
}))
const { queryRaw, mockEnv } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  mockEnv: {
    env: {
      ADMIN_BASE_URL: "https://admin.example",
      ADMIN_SESSION_SECRET: "x".repeat(32),
      AUTH_ADMIN_CLIENT_ID: "admin-client",
      AUTH_ISSUER_URL: "https://auth.example",
      CORS_ALLOWED_ORIGINS: "",
      OPENROUTER_API_PAID_KEY: undefined as string | undefined,
      OPENROUTER_API_KEY: undefined as string | undefined,
      FIREWORKS_API_KEY: undefined as string | undefined,
      QUERY_EMBEDDING_PROVIDER: undefined as
        | "openrouter"
        | "fireworks"
        | undefined,
      OPENAI_API_KEY: undefined as string | undefined,
      MASTRA_GATEWAY_BASE_URL: undefined as string | undefined,
      MASTRA_GATEWAY_ADMIN_API_KEY: undefined as string | undefined,
    },
  },
}))

vi.mock("@/db/client", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    user: {
      count: (...args: unknown[]) => userCount(...args),
      findMany: (...args: unknown[]) => userFindMany(...args),
    },
    managerMembership: {
      findMany: (...args: unknown[]) => managerMembershipFindMany(...args),
    },
    searchTrace: {
      findMany: (...args: unknown[]) => searchTraceFindMany(...args),
    },
    watchSearchEvent: {
      findMany: (...args: unknown[]) => watchSearchEventFindMany(...args),
    },
    video: {
      findMany: (...args: unknown[]) => videoFindMany(...args),
    },
    language: {
      findMany: (...args: unknown[]) => languageFindMany(...args),
    },
  },
}))

vi.mock("@/config/env", () => mockEnv)

import {
  buildUserTableRow,
  buildLanguageDiagnosticRow,
  loadEmbeddingsData,
  loadSettingsData,
  loadWatchSearchAnalyticsData,
  loadUsersData,
  runSemanticSearch,
  type LanguageDiagnosticSourceRow,
  type UserAccessSourceRow,
} from "@/app/dashboard/ops-data"
import type { Principal } from "@/auth/principal"

const ADMIN_PRINCIPAL = {
  id: "admin-1",
  role: "ADMIN",
} as const satisfies Principal

function resetMockEnv() {
  mockEnv.env.OPENROUTER_API_PAID_KEY = undefined
  mockEnv.env.OPENROUTER_API_KEY = undefined
  mockEnv.env.FIREWORKS_API_KEY = undefined
  mockEnv.env.QUERY_EMBEDDING_PROVIDER = undefined
  mockEnv.env.OPENAI_API_KEY = undefined
  mockEnv.env.MASTRA_GATEWAY_BASE_URL = undefined
  mockEnv.env.MASTRA_GATEWAY_ADMIN_API_KEY = undefined
}

function mockEmbeddingCounts({
  total = 0,
  embedded = 0,
  published = 0,
}: {
  total?: number
  embedded?: number
  published?: number
} = {}) {
  queryRaw.mockResolvedValueOnce([
    {
      total: BigInt(total),
      embedded: BigInt(embedded),
      published: BigInt(published),
    },
  ])
}

beforeEach(() => {
  queryRaw.mockReset()
  searchTraceFindMany.mockReset()
  watchSearchEventFindMany.mockReset()
  videoFindMany.mockReset()
  videoFindMany.mockResolvedValue([])
  languageFindMany.mockReset()
  languageFindMany.mockResolvedValue([])
  resetMockEnv()
})

function sourceRow(
  overrides: Partial<LanguageDiagnosticSourceRow> = {},
): LanguageDiagnosticSourceRow {
  return {
    id: "lang_english",
    coreId: "529",
    source: "CORE" as LanguageDiagnosticSourceRow["source"],
    name: { en: "English" },
    bcp47: "en",
    iso3: "eng",
    slug: "english",
    audioPreviewValue: "https://cdn.example.com/en.mp3",
    audioPreviewDuration: 12,
    audioPreviewSize: 2048n,
    audioPreviewBitrate: 128,
    audioPreviewCodec: "mp3",
    syncedAt: new Date("2026-05-20T21:10:00.000Z"),
    createdAt: new Date("2026-05-19T21:10:00.000Z"),
    updatedAt: new Date("2026-05-20T21:10:00.000Z"),
    locales: [
      {
        id: "locale_en",
        locale: "en",
        value: "English",
        primary: true,
        order: 1,
      },
      {
        id: "locale_es",
        locale: "es",
        value: "Ingles",
        primary: false,
        order: 2,
      },
    ],
    countryLanguages: [
      {
        id: "country_language_us",
        coreId: "cl_us_en",
        speakers: 270000000,
        displaySpeakers: "270M",
        primary: true,
        suggested: true,
        order: 1,
        country: {
          id: "country_us",
          coreId: "US",
          name: { en: "United States" },
          flagPngSrc: "https://flags.example.com/us.png",
          flagWebpSrc: "https://flags.example.com/us.webp",
          continent: {
            coreId: "NA",
            name: { en: "North America" },
          },
        },
      },
    ],
    _count: {
      countryLanguages: 1,
      videoDubs: 2,
      videoSubtitles: 4,
      studyQuestions: 5,
      videosAsPrimary: 6,
    },
    ...overrides,
  }
}

function userSourceRow(
  overrides: Partial<UserAccessSourceRow> = {},
): UserAccessSourceRow {
  return {
    id: "user-1",
    email: "viewer@example.com",
    role: "VIEWER",
    emailVerified: true,
    updatedAt: new Date("2026-01-02T03:04:00.000Z"),
    managerMembership: null,
    ...overrides,
  }
}

describe("embedding provider readiness", () => {
  it("does not treat OPENAI_API_KEY alone as configured for embeddings", async () => {
    mockEnv.env.OPENAI_API_KEY = "legacy-openai-key"
    mockEmbeddingCounts({ total: 2, embedded: 1, published: 1 })
    queryRaw.mockResolvedValueOnce([])

    const data = await loadEmbeddingsData()

    expect(data.providerReady).toBe(false)
    expect(
      data.insights.find((insight) => insight.label === "Provider"),
    ).toEqual(expect.objectContaining({ value: "Missing" }))
  })

  it("reports OpenRouter as the only ready embedding backend", async () => {
    mockEnv.env.OPENROUTER_API_KEY = "openrouter-key"
    mockEnv.env.OPENAI_API_KEY = "legacy-openai-key"
    mockEmbeddingCounts({ total: 2, embedded: 2, published: 1 })
    queryRaw.mockResolvedValueOnce([])

    const embeddings = await loadEmbeddingsData()
    const settings = await loadSettingsData()

    expect(embeddings.providerReady).toBe(true)
    expect(
      embeddings.insights.find((insight) => insight.label === "Provider"),
    ).toEqual(expect.objectContaining({ value: "OpenRouter" }))
    expect(
      settings.insights.find(
        (insight) => insight.label === "Embedding Backend",
      ),
    ).toEqual(expect.objectContaining({ value: "OpenRouter" }))
  })

  it("treats OPENROUTER_API_PAID_KEY as the preferred ready embedding backend", async () => {
    mockEnv.env.OPENROUTER_API_PAID_KEY = "paid-openrouter-key"
    mockEnv.env.OPENAI_API_KEY = "legacy-openai-key"
    mockEmbeddingCounts({ total: 2, embedded: 2, published: 1 })
    queryRaw.mockResolvedValueOnce([])

    const embeddings = await loadEmbeddingsData()
    const settings = await loadSettingsData()

    expect(embeddings.providerReady).toBe(true)
    expect(
      embeddings.insights.find((insight) => insight.label === "Provider"),
    ).toEqual(expect.objectContaining({ value: "OpenRouter" }))
    expect(
      settings.insights.find(
        (insight) => insight.label === "Embedding Backend",
      ),
    ).toEqual(expect.objectContaining({ value: "OpenRouter" }))
  })

  it("reports Fireworks as ready when selected for query embeddings", async () => {
    mockEnv.env.FIREWORKS_API_KEY = "fireworks-key"
    mockEnv.env.QUERY_EMBEDDING_PROVIDER = "fireworks"
    mockEmbeddingCounts({ total: 2, embedded: 2, published: 1 })
    queryRaw.mockResolvedValueOnce([])

    const embeddings = await loadEmbeddingsData()
    const settings = await loadSettingsData()

    expect(embeddings.providerReady).toBe(true)
    expect(
      embeddings.insights.find((insight) => insight.label === "Provider"),
    ).toEqual(expect.objectContaining({ value: "Fireworks" }))
    expect(
      settings.insights.find(
        (insight) => insight.label === "Embedding Backend",
      ),
    ).toEqual(expect.objectContaining({ value: "Fireworks" }))
  })

  it("requires FIREWORKS_API_KEY when Fireworks is explicitly selected", async () => {
    mockEnv.env.QUERY_EMBEDDING_PROVIDER = "fireworks"
    mockEnv.env.OPENROUTER_API_KEY = "openrouter-key"
    mockEmbeddingCounts({ total: 2, embedded: 1, published: 1 })

    const data = await runSemanticSearch({
      queryText: "hope",
      locale: "en",
      user: ADMIN_PRINCIPAL,
    })

    expect(data.metrics.find((metric) => metric.label === "Provider")).toEqual(
      expect.objectContaining({ value: "Missing" }),
    )
    expect(data.unavailableReason).toBe(
      "Semantic search requires FIREWORKS_API_KEY when QUERY_EMBEDDING_PROVIDER=fireworks.",
    )
  })

  it("keeps semantic search unavailable when only OPENAI_API_KEY is set", async () => {
    mockEnv.env.OPENAI_API_KEY = "legacy-openai-key"
    mockEmbeddingCounts({ total: 2, embedded: 1, published: 1 })

    const data = await runSemanticSearch({
      queryText: "hope",
      locale: "en",
      user: ADMIN_PRINCIPAL,
    })

    expect(data.metrics.find((metric) => metric.label === "Provider")).toEqual(
      expect.objectContaining({ value: "Missing" }),
    )
    expect(data.unavailableReason).toBe(
      "Semantic search requires OPENROUTER_API_PAID_KEY, OPENROUTER_API_KEY, or FIREWORKS_API_KEY.",
    )
  })
})

describe("loadWatchSearchAnalyticsData", () => {
  it("displays target language names for stored language codes", async () => {
    searchTraceFindMany.mockResolvedValueOnce([
      {
        id: "trace_en",
        requestId: "req_en",
        queryText: "Jesus",
        locale: "en",
        searchMode: "watch-search",
        resultCount: 0,
        outcome: "SUCCESS",
        metadata: {
          language: {
            targetLanguageSlug: "en",
            targetLanguageSource: "route_locale",
          },
          results: [],
        },
        createdAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    ])
    watchSearchEventFindMany.mockResolvedValueOnce([])
    languageFindMany.mockResolvedValueOnce([
      {
        bcp47: "en",
        name: { en: "English", native: "English" },
        slug: "english",
      },
    ])

    const data = await loadWatchSearchAnalyticsData({
      requestId: "req_en",
      window: "7d",
      now: new Date("2026-07-15T12:30:00.000Z"),
    })

    expect(languageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ slug: { in: ["en"] } }, { bcp47: { in: ["en"] } }],
        }),
      }),
    )
    expect(data.selectedRequest).toEqual(
      expect.objectContaining({
        targetLanguageSlug: "en",
        targetLanguageLabel: "English",
      }),
    )
  })

  it("joins recent Watch search traces with click events", async () => {
    searchTraceFindMany.mockResolvedValueOnce([
      {
        id: "trace_1",
        requestId: "req_12345678",
        queryText: "JESUS Russian",
        locale: "russian",
        searchMode: "watch-search",
        resultCount: 2,
        outcome: "SUCCESS",
        metadata: {
          latencyMs: 148,
          language: {
            targetLanguageSlug: "russian",
            targetLanguageSource: "query_named_language",
            queryNamedLanguageSlug: "russian",
          },
          laneStatuses: [
            {
              lane: "semantic_embedding",
              status: "fulfilled",
              elapsedMs: 12,
              resultCount: 1,
              detail: "cache_hit",
            },
          ],
          results: [
            {
              id: "video_1",
              type: "video",
              score: 1,
              scoreBreakdown: {
                total: 1,
                sourceRelevance: 0.55,
                evidenceBoost: 0.2,
                relevance: 0.75,
                availability: 0.25,
                match: 0.2,
                sourceScore: 1,
              },
              availabilityKind: "target_audio",
              evidenceKind: "exact_title",
              actionKind: "watch",
            },
            {
              id: "video_2",
              type: "video",
              score: 0.72,
              scoreBreakdown: {
                total: 0.72,
                sourceRelevance: 0.5,
                evidenceBoost: 0.14,
                relevance: 0.64,
                availability: 0.08,
                match: 0.14,
                sourceScore: 0.91,
              },
              availabilityKind: "unavailable",
              evidenceKind: "metadata",
              actionKind: "watch",
            },
          ],
        },
        createdAt: new Date("2026-07-15T12:00:00.000Z"),
      },
      {
        id: "trace_2",
        requestId: "req_12345678",
        queryText: "JESUS Russian",
        locale: "russian",
        searchMode: "watch-search",
        resultCount: 1,
        outcome: "SUCCESS",
        metadata: {
          latencyMs: 95,
          offset: 10,
          language: {
            targetLanguageSlug: "russian",
            targetLanguageSource: "query_named_language",
            queryNamedLanguageSlug: "russian",
          },
          results: [
            {
              id: "video_3",
              type: "video",
              score: 0.64,
              scoreBreakdown: {
                total: 0.64,
                sourceRelevance: 0.31,
                evidenceBoost: 0.08,
                relevance: 0.39,
                availability: 0.25,
                match: 0.08,
                sourceScore: 0.56,
              },
              availabilityKind: "target_audio",
              evidenceKind: "transcript_semantic",
              actionKind: "watch",
            },
          ],
        },
        createdAt: new Date("2026-07-15T12:00:05.000Z"),
      },
    ])
    watchSearchEventFindMany.mockResolvedValueOnce([
      {
        requestId: "req_12345678",
        eventType: "results_viewed",
        resultId: null,
        position: null,
        metadata: {
          visibleResultIds: ["video_1", "video_2", "video_3"],
        },
      },
      {
        requestId: "req_12345678",
        eventType: "result_clicked",
        resultId: "video_2",
        position: 2,
        metadata: null,
      },
    ])
    videoFindMany.mockResolvedValueOnce([
      {
        id: "video_1",
        slug: "jesus",
        locales: [
          {
            locale: "en",
            languageSlug: "english",
            title: "JESUS",
            description: "Feature film",
          },
        ],
        images: [
          {
            url: "https://images.example.com/jesus.jpg",
            kind: "videoStill",
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
          },
        ],
      },
      {
        id: "video_2",
        slug: "jesus-trailer",
        locales: [
          {
            locale: "en",
            languageSlug: "english",
            title: "Jesus Trailer",
            description: "Trailer description",
          },
        ],
        images: [],
      },
      {
        id: "video_3",
        slug: "known-by-god",
        locales: [
          {
            locale: "en",
            languageSlug: "english",
            title: "Known by God",
            description: "Follow-on result",
          },
        ],
        images: [],
      },
    ])

    const data = await loadWatchSearchAnalyticsData({
      requestId: "req_12345678",
      window: "7d",
      now: new Date("2026-07-15T12:30:00.000Z"),
    })

    expect(searchTraceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          searchMode: "watch-search",
          routeSource: "GRAPHQL",
          createdAt: { gte: new Date("2026-07-08T12:30:00.000Z") },
        }),
        take: 100,
      }),
    )
    expect(watchSearchEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requestId: { in: ["req_12345678"] },
        }),
        take: 600,
      }),
    )
    expect(videoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["video_1", "video_2", "video_3"] },
          deletedAt: null,
        },
      }),
    )
    expect(data.window).toBe("7d")
    expect(data.requests).toHaveLength(1)
    expect(
      data.metrics.find((metric) => metric.label === "Click Rate"),
    ).toEqual(expect.objectContaining({ value: "100%" }))
    expect(data.selectedRequest).toEqual(
      expect.objectContaining({
        requestId: "req_12345678",
        queryText: "JESUS Russian",
        targetLanguageSlug: "russian",
        clickedPosition: 2,
        resultCount: 3,
      }),
    )
    expect(data.selectedRequest?.lanes[0]).toEqual(
      expect.objectContaining({
        lane: "semantic_embedding",
        detail: "cache_hit",
      }),
    )
    expect(data.selectedRequest?.results).toEqual([
      expect.objectContaining({
        id: "video_1",
        title: "JESUS",
        slug: "jesus",
        imageUrl: "https://images.example.com/jesus.jpg",
        score: 1,
        scoreBreakdown: {
          total: 1,
          sourceRelevance: 0.55,
          evidenceBoost: 0.2,
          relevance: 0.75,
          availability: 0.25,
          match: 0.2,
          sourceScore: 1,
        },
        clicked: false,
        position: 1,
      }),
      expect.objectContaining({
        id: "video_2",
        title: "Jesus Trailer",
        slug: "jesus-trailer",
        imageUrl: null,
        score: 0.72,
        clicked: true,
        position: 2,
      }),
      expect.objectContaining({
        id: "video_3",
        title: "Known by God",
        slug: "known-by-god",
        score: 0.64,
        clicked: false,
        position: 3,
      }),
    ])
    expect(data.selectedRequest?.lanes).toEqual([
      expect.objectContaining({
        lane: "semantic_embedding",
        elapsedMs: 12,
        detail: "cache_hit",
      }),
    ])
  })

  it("keeps every stored Watch search result for the request detail view", async () => {
    const storedResults = Array.from({ length: 18 }, (_, index) => ({
      id: `video_${index + 1}`,
      type: "video",
      score: 1 - index / 100,
      scoreBreakdown: {
        total: 1 - index / 100,
        sourceRelevance: 0.55 - index / 100,
        evidenceBoost: 0.14,
        relevance: 0.69 - index / 100,
        availability: 0.25,
        match: 0.14,
        sourceScore: 1 - index / 100,
      },
      availabilityKind: "target_audio",
      evidenceKind: "metadata",
      actionKind: "watch",
    }))
    searchTraceFindMany.mockResolvedValueOnce([
      {
        id: "trace_many",
        requestId: "req_many_results",
        queryText: "Bible project",
        locale: "english",
        searchMode: "watch-search",
        resultCount: 18,
        outcome: "SUCCESS",
        metadata: {
          language: {
            targetLanguageSlug: "english",
            targetLanguageSource: "explicit_target",
          },
          results: storedResults,
        },
        createdAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    ])
    watchSearchEventFindMany.mockResolvedValueOnce([])
    videoFindMany.mockResolvedValueOnce(
      storedResults.map((result) => ({
        id: result.id,
        slug: result.id,
        locales: [
          {
            locale: "en",
            languageSlug: "english",
            title: `Video ${result.id}`,
            description: null,
          },
        ],
        images: [],
      })),
    )

    const data = await loadWatchSearchAnalyticsData({
      requestId: "req_many_results",
      window: "7d",
      now: new Date("2026-07-15T12:30:00.000Z"),
    })

    expect(data.selectedRequest?.results).toHaveLength(18)
    expect(data.selectedRequest?.results.at(0)).toEqual(
      expect.objectContaining({ id: "video_1", position: 1 }),
    )
    expect(data.selectedRequest?.results.at(-1)).toEqual(
      expect.objectContaining({ id: "video_18", position: 18 }),
    )
  })

  it("derives missing Watch search availability scores from stored availability kind", async () => {
    searchTraceFindMany.mockResolvedValueOnce([
      {
        id: "trace_availability",
        requestId: "req_availability",
        queryText: "Jesus",
        locale: "english",
        searchMode: "watch-search",
        resultCount: 2,
        outcome: "SUCCESS",
        metadata: {
          language: {
            targetLanguageSlug: "english",
            targetLanguageSource: "explicit_target",
          },
          results: [
            {
              id: "video_audio",
              type: "video",
              score: 1,
              scoreBreakdown: {
                total: 1,
                sourceRelevance: 0.55,
                evidenceBoost: 0.2,
                relevance: 0.75,
                availability: 0,
                match: 0.2,
                sourceScore: 1,
              },
              availabilityKind: "target_audio",
              evidenceKind: "exact_title",
              actionKind: "watch",
            },
            {
              id: "video_subtitle",
              type: "video",
              score: 0.55,
              availabilityKind: "target_subtitle",
              evidenceKind: "metadata",
              actionKind: "watch",
            },
          ],
        },
        createdAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    ])
    watchSearchEventFindMany.mockResolvedValueOnce([])

    const data = await loadWatchSearchAnalyticsData({
      requestId: "req_availability",
      window: "7d",
      now: new Date("2026-07-15T12:30:00.000Z"),
    })

    expect(data.selectedRequest?.results).toEqual([
      expect.objectContaining({
        id: "video_audio",
        availabilityKind: "target_audio",
        scoreBreakdown: expect.objectContaining({ availability: 0.25 }),
      }),
      expect.objectContaining({
        id: "video_subtitle",
        availabilityKind: "target_subtitle",
        scoreBreakdown: expect.objectContaining({ availability: 0.18 }),
      }),
    ])
  })

  it("returns an empty visualization model when no Watch search traces exist", async () => {
    searchTraceFindMany.mockResolvedValueOnce([])

    const data = await loadWatchSearchAnalyticsData({
      now: new Date("2026-07-15T12:30:00.000Z"),
    })

    expect(watchSearchEventFindMany).not.toHaveBeenCalled()
    expect(data.requests).toEqual([])
    expect(data.selectedRequest).toBeNull()
    expect(data.window).toBe("24h")
    expect(data.metrics.find((metric) => metric.label === "Searches")).toEqual(
      expect.objectContaining({ value: "0" }),
    )
  })
})

describe("loadUsersData", () => {
  beforeEach(() => {
    userCount.mockReset()
    userFindMany.mockReset()
    managerMembershipFindMany.mockReset()
  })

  it("selects Manager membership state and maps active, revoked, and missing product access", async () => {
    userCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
    userFindMany.mockResolvedValueOnce([
      userSourceRow({
        id: "active-user",
        email: "active@example.com",
        role: "ADMIN",
      }),
      userSourceRow({
        id: "revoked-user",
        email: "revoked@example.com",
      }),
      userSourceRow({
        id: "plain-user",
        email: "plain@example.com",
      }),
    ])
    managerMembershipFindMany.mockResolvedValueOnce([
      {
        userId: "active-user",
        role: "OPERATOR",
        revokedAt: null,
      },
      {
        userId: "revoked-user",
        role: "OPERATOR",
        revokedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ])

    const data = await loadUsersData()

    expect(userCount).toHaveBeenNthCalledWith(1, { where: { role: "ADMIN" } })
    expect(userCount).toHaveBeenNthCalledWith(2, { where: { role: "EDITOR" } })
    expect(userCount).toHaveBeenNthCalledWith(3, { where: { role: "VIEWER" } })
    expect(userFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    })
    expect(managerMembershipFindMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ["active-user", "revoked-user", "plain-user"] },
      },
      select: {
        userId: true,
        role: true,
        revokedAt: true,
      },
    })
    expect(
      data.rows.map((row) =>
        row.productAccess.map((access) => ({
          key: access.key,
          selectedRole: access.selectedRole,
          statusTone: access.statusTone,
          disabled: access.disabled,
          backed: access.backed,
          helperText: access.helperText,
        })),
      ),
    ).toEqual([
      [
        {
          key: "admin",
          selectedRole: "ADMIN",
          statusTone: "success",
          disabled: true,
          backed: false,
          helperText: "Status role",
        },
        {
          key: "manager",
          selectedRole: "OPERATOR",
          statusTone: "success",
          disabled: false,
          backed: true,
          helperText: "Backed",
        },
        {
          key: "mastra-studio",
          selectedRole: "NO_ACCESS",
          statusTone: "muted",
          disabled: true,
          backed: false,
          helperText: "Configure",
        },
      ],
      [
        {
          key: "admin",
          selectedRole: "VIEWER",
          statusTone: "warning",
          disabled: true,
          backed: false,
          helperText: "Status role",
        },
        {
          key: "manager",
          selectedRole: "NO_ACCESS",
          statusTone: "muted",
          disabled: false,
          backed: true,
          helperText: "Backed",
        },
        {
          key: "mastra-studio",
          selectedRole: "NO_ACCESS",
          statusTone: "muted",
          disabled: true,
          backed: false,
          helperText: "Configure",
        },
      ],
      [
        {
          key: "admin",
          selectedRole: "VIEWER",
          statusTone: "warning",
          disabled: true,
          backed: false,
          helperText: "Status role",
        },
        {
          key: "manager",
          selectedRole: "NO_ACCESS",
          statusTone: "muted",
          disabled: false,
          backed: true,
          helperText: "Backed",
        },
        {
          key: "mastra-studio",
          selectedRole: "NO_ACCESS",
          statusTone: "muted",
          disabled: true,
          backed: false,
          helperText: "Configure",
        },
      ],
    ])
  })

  it("keeps user rows visible with Manager disabled when the Manager membership table is absent", async () => {
    userCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
    userFindMany.mockResolvedValueOnce([
      userSourceRow({
        id: "viewer-user",
        email: "viewer@example.com",
      }),
    ])
    managerMembershipFindMany.mockRejectedValueOnce({ code: "P2021" })

    const data = await loadUsersData()

    expect(data.rows).toHaveLength(1)
    expect(data.rows[0]?.productAccess.map((access) => access.key)).toEqual([
      "admin",
      "manager",
      "mastra-studio",
    ])
    expect(data.rows[0]?.productAccess[1]).toMatchObject({
      key: "manager",
      selectedRole: "NO_ACCESS",
      statusTone: "muted",
      disabled: false,
      backed: true,
    })
  })
})

describe("buildUserTableRow", () => {
  it("requires product access on every Users row", () => {
    expect(
      buildUserTableRow(
        userSourceRow({
          managerMembership: {
            role: "OPERATOR",
            revokedAt: null,
          },
        }),
      ).productAccess,
    ).toMatchObject([
      {
        key: "admin",
        selectedRole: "VIEWER",
        statusTone: "warning",
        disabled: true,
        backed: false,
      },
      {
        key: "manager",
        selectedRole: "OPERATOR",
        statusTone: "success",
        disabled: false,
        backed: true,
      },
      {
        key: "mastra-studio",
        selectedRole: "NO_ACCESS",
        statusTone: "muted",
        disabled: true,
        backed: false,
      },
    ])
  })

  it("maps active Mastra Studio access into a backed product control", () => {
    expect(
      buildUserTableRow(
        userSourceRow({
          mastraStudioAccess: {
            selectedRole: "STUDIO_ACCESS",
            disabled: false,
            helperText: "Backed",
          },
        }),
      ).productAccess[2],
    ).toMatchObject({
      key: "mastra-studio",
      selectedRole: "STUDIO_ACCESS",
      statusTone: "success",
      disabled: false,
      backed: true,
      helperText: "Backed",
    })
  })
})

describe("buildLanguageDiagnosticRow", () => {
  it("maps active Core language metadata into a serializable diagnostics row", () => {
    const row = buildLanguageDiagnosticRow(sourceRow())

    expect(row.title).toBe("English")
    expect(row.codeLabel).toBe("en / eng / english")
    expect(row.statusLabel).toBe("Linked")
    expect(row.syncLabel).toBe("Core synced")
    expect(row.flags).toMatchObject({
      linked: true,
      countryLinked: true,
      hasDubs: true,
      hasSubtitles: true,
      hasStudyQuestions: true,
      primaryVideoLanguage: true,
      hasAudioPreview: true,
      coreSynced: true,
      missingMetadata: false,
    })
    expect(row.counts.totalContentLinks).toBe(17)
    expect(row.audioPreview).toMatchObject({
      available: true,
      duration: "12s",
      size: "2.0 KB",
      bitrate: "128 kbps",
      codec: "mp3",
    })
    expect(row.countryPreviews[0]).toMatchObject({
      coreId: "US",
      label: "United States",
      continentLabel: "North America",
      flagUrl: "https://flags.example.com/us.webp",
      speakers: "270M",
      primary: true,
      suggested: true,
    })
    for (const term of [
      "lang_english",
      "529",
      "core",
      "english",
      "en / eng / english",
      "linked",
      "core synced",
      "has dubs",
      "has subtitles",
      "has study questions",
      "primary video language",
      "audio preview",
      "us",
      "united states",
      "north america",
      "270m",
    ]) {
      expect(row.searchText).toContain(term)
    }
    expect(row.searchText).not.toContain("cl_us_en")
  })

  it("surfaces missing metadata and non-Core provenance explicitly", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        id: "lang_custom",
        coreId: "custom",
        source: "MANAGER" as LanguageDiagnosticSourceRow["source"],
        name: {},
        bcp47: null,
        iso3: null,
        slug: null,
        audioPreviewValue: null,
        audioPreviewDuration: null,
        audioPreviewSize: null,
        audioPreviewBitrate: null,
        audioPreviewCodec: null,
        syncedAt: null,
        locales: [],
        countryLanguages: [],
        _count: {
          countryLanguages: 0,
          videoDubs: 0,
          videoSubtitles: 0,
          studyQuestions: 0,
          videosAsPrimary: 0,
        },
      }),
    )

    expect(row.title).toBe("custom")
    expect(row.codeLabel).toBe("No language codes")
    expect(row.statusLabel).toBe("Missing metadata")
    expect(row.syncLabel).toBe("Non-Core source")
    expect(row.flags).toMatchObject({
      referenceOnly: true,
      missingMetadata: true,
      countryLinked: false,
      hasAudioPreview: false,
      nonCoreSource: true,
    })
    expect(row.timestamps.syncedAt).toBe("None")
  })

  it("keeps all localized names available for detail display and search", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        locales: Array.from({ length: 13 }, (_, index) => ({
          id: `locale_${index}`,
          locale: `l${index}`,
          value: `Locale ${index}`,
          primary: index === 0,
          order: index,
        })),
      }),
    )

    expect(row.names).toContainEqual({
      locale: "l12",
      value: "Locale 12",
      primary: false,
    })
    expect(row.searchText).toContain("locale 12")
  })

  it("does not treat blank localized names as usable metadata", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        name: { en: "   " },
        locales: [
          {
            id: "blank",
            locale: "en",
            value: "   ",
            primary: true,
            order: 1,
          },
        ],
      }),
    )

    expect(row.names).toEqual([])
    expect(row.title).toBe("en")
    expect(row.flags.missingMetadata).toBe(true)
    expect(row.statusLabel).toBe("Missing metadata")
  })

  it("treats any audio preview metadata as audio preview availability", () => {
    const row = buildLanguageDiagnosticRow(
      sourceRow({
        audioPreviewValue: null,
        audioPreviewDuration: 21,
        audioPreviewSize: null,
        audioPreviewBitrate: null,
        audioPreviewCodec: null,
      }),
    )

    expect(row.flags.hasAudioPreview).toBe(true)
    expect(row.audioPreview.available).toBe(true)
    expect(row.searchText).toContain("audio preview")
  })
})
