// Resolver wiring tests for the replacement public Watch search contract.
// Service tests own validation/retrieval; this file proves GraphQL delegates
// the structured input without reintroducing resolver-side search logic.

import { beforeEach, describe, expect, it, vi } from "vitest"

import { resolveWatchSearchInputForRequest } from "@/graphql/queries/watch-search"
import { schema } from "@/graphql/schema"

const { enqueueWatchSearchShadowMock, enqueueWatchSearchTraceMock } =
  vi.hoisted(() => ({
    enqueueWatchSearchShadowMock: vi.fn(),
    enqueueWatchSearchTraceMock: vi.fn(),
  }))

const searchMock = vi.fn()
const typesenseSearchMock = vi.fn()
const suggestMock = vi.fn()

vi.mock("@/services/search-trace.service", () => ({
  enqueueWatchSearchTrace: enqueueWatchSearchTraceMock,
}))

vi.mock("@/services/watch-search-shadow.service", () => ({
  enqueueWatchSearchShadow: enqueueWatchSearchShadowMock,
}))

type ResolverArgs = {
  input: {
    query: string
    languageSlug?: string
    mode?: "default" | "modern" | null
    shadowMode?: "default" | "modern" | null
    targetLanguageSlug?: string | null
    displayLanguageSlug?: string | null
    routeLanguageSlug?: string | null
    limit?: number | null
    offset?: number | null
    resultTypes?: Array<"video" | "experience"> | null
  }
}
type ResolverCtx = {
  user: {
    id: string | null
    role: "CONSUMER_BEARER" | "PUBLIC"
    fleet?: boolean
  } | null
  request: Request
  prisma: unknown
  services: {
    watchSearch: { search: typeof searchMock }
    typesenseWatchSearch: { search: typeof typesenseSearchMock } | null
    typesenseWatchSearchSuggestions: { suggest: typeof suggestMock } | null
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

function getResolver(name = "watchSearch"): FieldWithResolve["resolve"] {
  const fields = schema.getQueryType()!.getFields()
  const field = fields[name] as unknown as FieldWithResolve
  return field.resolve
}

async function invoke(
  args: ResolverArgs,
  typesenseWatchSearch: ResolverCtx["services"]["typesenseWatchSearch"] = {
    search: typesenseSearchMock,
  },
  user: ResolverCtx["user"] = {
    id: null,
    role: "CONSUMER_BEARER",
    fleet: false,
  },
  request = new Request("https://admin.jesusfilm.org/api/graphql"),
) {
  return getResolver()(
    null,
    args,
    {
      user,
      request,
      prisma: { searchTrace: {}, searchTraceAggregate: {} },
      services: {
        watchSearch: { search: searchMock },
        typesenseWatchSearch,
        typesenseWatchSearchSuggestions: { suggest: suggestMock },
      },
    },
    {},
  )
}

async function invokeSuggestions(
  input: { query: string; languageSlug: string },
  service: ResolverCtx["services"]["typesenseWatchSearchSuggestions"] = {
    suggest: suggestMock,
  },
) {
  return getResolver("watchSearchSuggestions")(
    null,
    { input },
    {
      user: null,
      request: new Request("https://admin.jesusfilm.org/api/graphql"),
      prisma: {},
      services: {
        watchSearch: { search: searchMock },
        typesenseWatchSearch: { search: typesenseSearchMock },
        typesenseWatchSearchSuggestions: service,
      },
    },
    {},
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  enqueueWatchSearchShadowMock.mockReturnValue(true)
  enqueueWatchSearchTraceMock.mockReturnValue(true)
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
  suggestMock.mockResolvedValue(["Jesus", "Jesus Wept"])
})

describe("watchSearchSuggestions resolver", () => {
  it("delegates exact public input and returns raw titles without tracing", async () => {
    const input = { query: "je", languageSlug: "english" }

    await expect(invokeSuggestions(input)).resolves.toEqual([
      "Jesus",
      "Jesus Wept",
    ])

    expect(suggestMock).toHaveBeenCalledWith(input)
    expect(searchMock).not.toHaveBeenCalled()
    expect(typesenseSearchMock).not.toHaveBeenCalled()
    expect(enqueueWatchSearchTraceMock).not.toHaveBeenCalled()
  })

  it("fails empty when the optional suggestion service is unavailable", async () => {
    await expect(
      invokeSuggestions({ query: "je", languageSlug: "english" }, null),
    ).resolves.toEqual([])
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

    expect(enqueueWatchSearchTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({ input, response: result }),
      expect.anything(),
    )
  })

  it("queues DEFAULT as a background shadow for trusted Web MODERN requests", async () => {
    const input = {
      query: "communion",
      mode: "modern" as const,
      shadowMode: "default" as const,
      targetLanguageSlug: "french",
    }

    const result = await invoke({ input })

    expect(enqueueWatchSearchShadowMock).toHaveBeenCalledWith({
      input,
      primaryResponse: result,
      prisma: expect.anything(),
      service: expect.objectContaining({ search: searchMock }),
    })
  })

  it("does not queue shadow work when the primary mode is DEFAULT", async () => {
    await invoke({
      input: {
        query: "communion",
        mode: "default",
        shadowMode: "default",
      },
    })

    expect(enqueueWatchSearchShadowMock).not.toHaveBeenCalled()
  })

  it("ignores shadow requests from anonymous callers", async () => {
    await invoke(
      {
        input: {
          query: "communion",
          mode: "modern",
          shadowMode: "default",
        },
      },
      { search: typesenseSearchMock },
      null,
    )

    expect(enqueueWatchSearchShadowMock).not.toHaveBeenCalled()
  })

  it("routes the anonymous canonical Web client to MODERN with DEFAULT shadow", async () => {
    const input = { query: "communion" }
    const effectiveInput = {
      ...input,
      mode: "modern" as const,
      shadowMode: "default" as const,
    }

    const result = await invoke(
      { input },
      { search: typesenseSearchMock },
      null,
      new Request("https://admin.jesusfilm.org/api/graphql", {
        headers: { origin: "https://www.jesusfilm.org" },
      }),
    )

    expect(typesenseSearchMock).toHaveBeenCalledWith(effectiveInput)
    expect(searchMock).not.toHaveBeenCalled()
    expect(enqueueWatchSearchShadowMock).toHaveBeenCalledWith({
      input: effectiveInput,
      primaryResponse: result,
      prisma: expect.anything(),
      service: expect.objectContaining({ search: searchMock }),
    })
  })

  it("applies the Admin DEFAULT rollback to a stale MODERN browser request", () => {
    const requestContext = {
      user: null,
      request: new Request("https://admin.jesusfilm.org/api/graphql", {
        headers: { origin: "https://www.jesusfilm.org" },
      }),
    }
    const staleClientInput = {
      query: "communion",
      mode: "modern" as const,
      shadowMode: "default" as const,
    }

    expect(
      resolveWatchSearchInputForRequest(staleClientInput, requestContext, {
        primaryMode: "DEFAULT",
        defaultShadowEnabled: false,
      }),
    ).toEqual({
      query: "communion",
      mode: "default",
      shadowMode: undefined,
    })
  })

  it("can stop shadow work without changing the MODERN primary", () => {
    const requestContext = {
      user: null,
      request: new Request("https://admin.jesusfilm.org/api/graphql", {
        headers: { origin: "https://www.jesusfilm.org" },
      }),
    }

    expect(
      resolveWatchSearchInputForRequest(
        { query: "communion" },
        requestContext,
        {
          primaryMode: "MODERN",
          defaultShadowEnabled: false,
        },
      ),
    ).toEqual({
      query: "communion",
      mode: "modern",
      shadowMode: undefined,
    })
  })

  it("ignores shadow requests from fleet consumer bearers", async () => {
    await invoke(
      {
        input: {
          query: "communion",
          mode: "modern",
          shadowMode: "default",
        },
      },
      { search: typesenseSearchMock },
      { id: null, role: "CONSUMER_BEARER", fleet: true },
    )

    expect(enqueueWatchSearchShadowMock).not.toHaveBeenCalled()
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

    expect(enqueueWatchSearchTraceMock).toHaveBeenCalledWith(
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

  it("keeps the search response unchanged when the trace queue is full", async () => {
    enqueueWatchSearchTraceMock.mockReturnValueOnce(false)

    const result = await invoke({ input: { query: "jesus" } })

    expect(result).toMatchObject({
      query: "jesus",
      searchMode: "watch-search",
    })
  })
})
