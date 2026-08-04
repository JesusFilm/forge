// Resolver wiring tests for the replacement public Watch search contract.
// Service tests own validation/retrieval; this file proves GraphQL delegates
// the structured input without reintroducing resolver-side search logic.

import { beforeEach, describe, expect, it, vi } from "vitest"

import { schema } from "@/graphql/schema"

const { recordWatchSearchTraceSafelyMock } = vi.hoisted(() => ({
  recordWatchSearchTraceSafelyMock: vi.fn(),
}))

const searchMock = vi.fn()
const typesenseSearchMock = vi.fn()

vi.mock("@/services/search-trace.service", () => ({
  recordWatchSearchTraceSafely: recordWatchSearchTraceSafelyMock,
}))

type ResolverArgs = {
  input: {
    query: string
    mode?: "default" | "modern" | null
    targetLanguageSlug?: string | null
    displayLanguageSlug?: string | null
    routeLanguageSlug?: string | null
    limit?: number | null
    offset?: number | null
    resultTypes?: Array<"video" | "experience"> | null
  }
}
type ResolverCtx = {
  prisma: unknown
  services: {
    watchSearch: { search: typeof searchMock }
    typesenseWatchSearch: { search: typeof typesenseSearchMock } | null
  }
}
type FieldWithResolve = {
  resolve: (
    root: unknown,
    args: ResolverArgs,
    ctx: ResolverCtx,
    info: unknown,
  ) => unknown
}

function getResolver(): FieldWithResolve["resolve"] {
  const fields = schema.getQueryType()!.getFields()
  const field = fields.watchSearch as unknown as FieldWithResolve
  return field.resolve
}

async function invoke(
  args: ResolverArgs,
  typesenseWatchSearch: ResolverCtx["services"]["typesenseWatchSearch"] = {
    search: typesenseSearchMock,
  },
) {
  return getResolver()(
    null,
    args,
    {
      prisma: { searchTrace: {}, searchTraceAggregate: {} },
      services: {
        watchSearch: { search: searchMock },
        typesenseWatchSearch,
      },
    },
    {},
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  recordWatchSearchTraceSafelyMock.mockResolvedValue({
    ok: true,
    timedOut: false,
    aggregateStored: true,
    rawStored: true,
    rawCaptureDisabled: false,
  })
  searchMock.mockResolvedValue({
    query: "jesus",
    results: [],
    hasMore: false,
    nextOffset: 20,
    searchMode: "watch-search",
    requestId: "search-request-1",
    degraded: false,
    latencyMs: 2,
    laneStatuses: [],
    languageInterpretation: {
      queryLanguageSlug: null,
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    },
  })
  typesenseSearchMock.mockResolvedValue({
    query: "jesus",
    results: [],
    hasMore: false,
    nextOffset: 20,
    searchMode: "watch-search-typesense",
    requestId: "search-request-typesense-1",
    degraded: false,
    latencyMs: 1,
    laneStatuses: [],
    languageInterpretation: {
      queryLanguageSlug: null,
      queryNamedLanguageSlug: null,
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      currentWatchLanguageSlug: null,
      acceptLanguage: null,
      acceptLanguageSlug: null,
    },
  })
})

describe("watchSearch mode routing", () => {
  it("uses the modern service when mode is MODERN", async () => {
    const input = {
      query: "communion",
      mode: "modern" as const,
      targetLanguageSlug: "french",
      displayLanguageSlug: "french",
    }

    const result = await invoke({ input })

    expect(typesenseSearchMock).toHaveBeenCalledWith(input)
    expect(searchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ searchMode: "watch-search-typesense" })
  })

  it("uses the default service when mode is omitted", async () => {
    const input = { query: "communion", targetLanguageSlug: "french" }

    await invoke({ input })

    expect(searchMock).toHaveBeenCalledWith(input)
    expect(typesenseSearchMock).not.toHaveBeenCalled()
  })

  it("records the modern response through the existing trace sink", async () => {
    const input = {
      query: "communion",
      mode: "modern" as const,
      targetLanguageSlug: "french",
    }

    const result = await invoke({ input })

    expect(recordWatchSearchTraceSafelyMock).toHaveBeenCalledWith(
      expect.objectContaining({ input, response: result }),
      expect.anything(),
    )
  })

  it("fails explicitly when MODERN is requested without Typesense configuration", async () => {
    await expect(
      invoke({ input: { query: "communion", mode: "modern" } }, null),
    ).rejects.toThrow("Typesense Watch Search is not configured")
  })
})

describe("watchSearch resolver", () => {
  it("passes the structured input through to WatchSearchService.search", async () => {
    const input = {
      query: "jesus",
      targetLanguageSlug: "spanish-castilian",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      limit: 5,
      offset: 10,
      resultTypes: ["video" as const],
    }

    await invoke({ input })

    expect(searchMock).toHaveBeenCalledWith(input)
  })

  it("returns the service response unchanged", async () => {
    const result = await invoke({ input: { query: "jesus" } })

    expect(result).toMatchObject({
      query: "jesus",
      results: [],
      searchMode: "watch-search",
      languageInterpretation: {
        targetLanguageSlug: "spanish-castilian",
      },
    })
  })

  it("records an Admin-owned Watch search trace after a successful response", async () => {
    const input = {
      query: "jesus",
      targetLanguageSlug: "spanish-castilian",
    }

    const result = await invoke({ input })

    expect(recordWatchSearchTraceSafelyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input,
        response: result,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
      expect.objectContaining({
        searchTrace: {},
        searchTraceAggregate: {},
      }),
    )
  })

  it("keeps the search response unchanged when trace recording fails", async () => {
    recordWatchSearchTraceSafelyMock.mockRejectedValueOnce(
      new Error("trace unavailable"),
    )

    const result = await invoke({ input: { query: "jesus" } })

    expect(result).toMatchObject({
      query: "jesus",
      searchMode: "watch-search",
    })
  })
})
