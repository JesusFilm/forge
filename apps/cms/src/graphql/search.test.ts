import { beforeEach, describe, expect, it, vi } from "vitest"
import { GraphQLError } from "graphql"

vi.mock("../api/search/services/search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../api/search/services/search")>()
  return {
    ...actual,
    search: vi.fn(),
  }
})

vi.mock("../lib/rate-limit-bucket", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/rate-limit-bucket")>()
  return {
    ...actual,
    checkRateLimit: vi.fn(),
  }
})

import { search } from "../api/search/services/search"
import { checkRateLimit } from "../lib/rate-limit-bucket"
import { registerSearchExtension } from "./search"

type ExtensionFactory = () => {
  typeDefs: string
  resolvers: {
    Query: {
      semanticSearch: {
        resolve: (
          parent: unknown,
          args: {
            query: string
            locale: string
            limit?: number
            offset?: number
            type?: string
          },
          context: unknown,
        ) => Promise<unknown>
      }
    }
  }
  resolversConfig: Record<string, { auth: boolean }>
}

function buildExtension() {
  let capturedFactory: ExtensionFactory | undefined
  const mockUse = vi.fn((factory: ExtensionFactory) => {
    capturedFactory = factory
  })
  const mockStrapi = {
    plugin: () => ({
      service: () => ({ use: mockUse }),
    }),
    log: { error: vi.fn(), warn: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  registerSearchExtension(mockStrapi)

  if (!capturedFactory) throw new Error("extension factory not captured")
  return { config: capturedFactory(), strapi: mockStrapi }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true })
})

describe("registerSearchExtension", () => {
  it("registers typeDefs with nullable startSeconds and playbackId", () => {
    const { config } = buildExtension()

    // Nullable signals keyword-only results with no scene-level data
    expect(config.typeDefs).toContain("startSeconds: Float\n")
    expect(config.typeDefs).toContain("playbackId: String\n")
    // hasMore replaces the broken `total` field
    expect(config.typeDefs).toContain("hasMore: Boolean!")
    expect(config.typeDefs).not.toContain("total: Int!")
  })

  it("exposes searchMode on SearchResponse (feat-097 visibility signal)", () => {
    const { config } = buildExtension()

    // Non-null so clients can always branch on the value — the service
    // always populates it. "hybrid" when semantic ran, "keyword-only"
    // when the embedding call failed.
    expect(config.typeDefs).toContain("searchMode: String!")
  })

  it("forwards searchMode through the resolver to clients", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "forgiveness",
      searchMode: "keyword-only",
    })

    const { config } = buildExtension()
    const result = (await config.resolvers.Query.semanticSearch.resolve(
      null,
      { query: "forgiveness", locale: "en" },
      { koaContext: { ip: "127.0.0.1" } },
    )) as { searchMode: string }

    expect(result.searchMode).toBe("keyword-only")
  })

  it("registers semanticSearch as publicly accessible (auth: false)", () => {
    const { config } = buildExtension()

    expect(config.resolversConfig["Query.semanticSearch"]).toEqual({
      auth: false,
    })
  })

  it("forwards args to the search service on success", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "forgiveness",
      searchMode: "hybrid",
    })

    const { config, strapi } = buildExtension()
    await config.resolvers.Query.semanticSearch.resolve(
      null,
      { query: "forgiveness", locale: "en", limit: 10, offset: 0 },
      { koaContext: { ip: "127.0.0.1" } },
    )

    expect(search).toHaveBeenCalledWith(strapi, {
      query: "forgiveness",
      locale: "en",
      limit: 10,
      offset: 0,
      contentTypes: undefined,
    })
  })

  it("trims whitespace from the query before forwarding", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "grief",
      searchMode: "hybrid",
    })

    const { config } = buildExtension()
    await config.resolvers.Query.semanticSearch.resolve(
      null,
      { query: "  grief  ", locale: "en" },
      { koaContext: { ip: "127.0.0.1" } },
    )

    expect(search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: "grief" }),
    )
  })

  it("throws GraphQLError with BAD_USER_INPUT on empty query", async () => {
    const { config } = buildExtension()

    let caught: unknown = null
    try {
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "   ", locale: "en" },
        { koaContext: { ip: "127.0.0.1" } },
      )
    } catch (err) {
      caught = err
    }

    // Must be a GraphQLError (not a plain Error) so Strapi's formatter
    // propagates extensions instead of replacing with INTERNAL_SERVER_ERROR.
    expect(caught).toBeInstanceOf(GraphQLError)
    expect((caught as GraphQLError).message).toBe("query must not be empty")
    expect((caught as GraphQLError).extensions).toEqual({
      code: "BAD_USER_INPUT",
    })
    expect(search).not.toHaveBeenCalled()
  })

  it("transforms service errors into GraphQLError with SERVICE_UNAVAILABLE", async () => {
    vi.mocked(search).mockRejectedValue(new Error("internal DB error"))

    const { config, strapi } = buildExtension()
    let caught: unknown = null
    try {
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "hope", locale: "en" },
        { koaContext: { ip: "127.0.0.1" } },
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(GraphQLError)
    expect((caught as GraphQLError).message).toBe(
      "Search is temporarily unavailable",
    )
    expect((caught as GraphQLError).extensions).toEqual({
      code: "SERVICE_UNAVAILABLE",
    })
    expect(strapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining("internal DB error"),
    )
  })

  it("rejects with 429-equivalent when rate limit exceeded", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterSeconds: 30,
    })

    const { config } = buildExtension()

    await expect(
      config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "hope", locale: "en" },
        { koaContext: { ip: "127.0.0.1" } },
      ),
    ).rejects.toThrow("Too many requests")

    expect(search).not.toHaveBeenCalled()
  })

  it("throws GraphQLError with RATE_LIMITED and retryAfterSeconds extensions", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterSeconds: 42,
    })

    const { config } = buildExtension()

    let caught: unknown = null
    try {
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "hope", locale: "en" },
        { koaContext: { ip: "127.0.0.1" } },
      )
    } catch (err) {
      caught = err
    }

    // Must be a GraphQLError so Strapi's formatter preserves extensions
    // instead of replacing with INTERNAL_SERVER_ERROR. Plain Error subclasses
    // get stripped — agents must receive the code and retry window.
    expect(caught).toBeInstanceOf(GraphQLError)
    expect((caught as GraphQLError).extensions).toEqual({
      code: "RATE_LIMITED",
      retryAfterSeconds: 42,
    })
  })

  it("uses x-forwarded-for for the rate limit key when present", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "hope",
      searchMode: "hybrid",
    })

    const { config } = buildExtension()
    await config.resolvers.Query.semanticSearch.resolve(
      null,
      { query: "hope", locale: "en" },
      {
        koaContext: {
          ip: "127.0.0.1",
          request: { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } },
        },
      },
    )

    expect(checkRateLimit).toHaveBeenCalledWith(
      "search:203.0.113.5",
      expect.any(Number),
      expect.any(Number),
    )
  })

  it("prefers cf-connecting-ip over x-forwarded-for (spoof-resistant)", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "hope",
      searchMode: "hybrid",
    })

    const { config } = buildExtension()
    await config.resolvers.Query.semanticSearch.resolve(
      null,
      { query: "hope", locale: "en" },
      {
        koaContext: {
          ip: "127.0.0.1",
          request: {
            headers: {
              "cf-connecting-ip": "198.51.100.7",
              // attacker-controlled x-forwarded-for should be ignored
              "x-forwarded-for": "9.9.9.9",
            },
          },
        },
      },
    )

    expect(checkRateLimit).toHaveBeenCalledWith(
      "search:198.51.100.7",
      expect.any(Number),
      expect.any(Number),
    )
  })

  it("falls back to 'unknown' when koaContext is absent", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "hope",
      searchMode: "hybrid",
    })

    const { config } = buildExtension()
    await config.resolvers.Query.semanticSearch.resolve(
      null,
      { query: "hope", locale: "en" },
      undefined,
    )

    expect(checkRateLimit).toHaveBeenCalledWith(
      "search:unknown",
      expect.any(Number),
      expect.any(Number),
    )
  })

  describe("type argument", () => {
    beforeEach(() => {
      vi.mocked(search).mockResolvedValue({
        results: [],
        hasMore: false,
        query: "test",
        searchMode: "hybrid",
      })
    })

    it("declares optional type argument on the semanticSearch query", () => {
      const { config } = buildExtension()
      expect(config.typeDefs).toContain("type: String")
    })

    it("forwards contentTypes=['video'] when type=video", async () => {
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en", type: "video" },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ contentTypes: ["video"] }),
      )
    })

    it("forwards contentTypes=['experience'] when type=experience", async () => {
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en", type: "experience" },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ contentTypes: ["experience"] }),
      )
    })

    it("forwards contentTypes=undefined when type is omitted", async () => {
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en" },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ contentTypes: undefined }),
      )
    })

    it("treats an explicit empty-string type as omitted (defaults to both)", async () => {
      // Mirrors REST behavior so a GraphQL client sending an unset variable
      // as "" doesn't get a spurious BAD_USER_INPUT.
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en", type: "" },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ contentTypes: undefined }),
      )
    })

    it("throws GraphQLError with BAD_USER_INPUT when type is invalid", async () => {
      const { config } = buildExtension()

      let caught: unknown = null
      try {
        await config.resolvers.Query.semanticSearch.resolve(
          null,
          { query: "test", locale: "en", type: "invalid" },
          { koaContext: { ip: "127.0.0.1" } },
        )
      } catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(GraphQLError)
      expect((caught as GraphQLError).message).toBe(
        "type must be 'video' or 'experience'",
      )
      expect((caught as GraphQLError).extensions).toEqual({
        code: "BAD_USER_INPUT",
      })
      expect(search).not.toHaveBeenCalled()
    })
  })

  describe("mode argument (feat-109)", () => {
    beforeEach(() => {
      vi.mocked(search).mockResolvedValue({
        results: [],
        hasMore: false,
        query: "test",
        searchMode: "hybrid",
      })
    })

    it("declares optional mode argument on the semanticSearch query", () => {
      const { config } = buildExtension()
      // Nullable String, NOT a closed enum — see plan: future modes
      // ship as new values without a schema change.
      expect(config.typeDefs).toContain("mode: String")
    })

    it("forwards mode='keyword-first' to the service", async () => {
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en", mode: "keyword-first" },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: "keyword-first" }),
      )
    })

    it("treats null mode as omitted (defaults to hybrid)", async () => {
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en", mode: null },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: undefined }),
      )
    })

    it("treats explicit empty-string mode as omitted", async () => {
      // Mirrors REST + the type='' behavior — a GraphQL client sending
      // an unset variable as "" must not trigger different routing.
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en", mode: "" },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: undefined }),
      )
    })

    it("forwards unknown mode values verbatim and never throws", async () => {
      // Unlike `type=invalid` (BAD_USER_INPUT), `mode=garbage` reaches
      // the service. The service logs a structured warn and falls back
      // to hybrid. A typo in a query variable must not break the user's
      // search.
      const { config } = buildExtension()
      await config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "test", locale: "en", mode: "garbage" },
        { koaContext: { ip: "127.0.0.1" } },
      )

      expect(search).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: "garbage" }),
      )
    })
  })
})
