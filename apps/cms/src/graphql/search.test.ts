import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../api/search/services/search", () => ({
  search: vi.fn(),
}))

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
    })
  })

  it("trims whitespace from the query before forwarding", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "grief",
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

  it("throws on empty query without calling the service", async () => {
    const { config } = buildExtension()

    await expect(
      config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "   ", locale: "en" },
        { koaContext: { ip: "127.0.0.1" } },
      ),
    ).rejects.toThrow("query must not be empty")

    expect(search).not.toHaveBeenCalled()
  })

  it("transforms service errors into a generic user-facing message", async () => {
    vi.mocked(search).mockRejectedValue(new Error("internal DB error"))

    const { config, strapi } = buildExtension()
    await expect(
      config.resolvers.Query.semanticSearch.resolve(
        null,
        { query: "hope", locale: "en" },
        { koaContext: { ip: "127.0.0.1" } },
      ),
    ).rejects.toThrow("Search is temporarily unavailable")

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

  it("attaches RATE_LIMITED extension with retryAfterSeconds for agents", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterSeconds: 42,
    })

    const { config } = buildExtension()

    // Capture the thrown error to inspect extensions (GraphQL clients
    // read these off errors[].extensions in the response envelope)
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

    expect(caught).toBeInstanceOf(Error)
    const extensions = (caught as { extensions?: unknown }).extensions
    expect(extensions).toEqual({
      code: "RATE_LIMITED",
      retryAfterSeconds: 42,
    })
  })

  it("uses x-forwarded-for for the rate limit key when present", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "hope",
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
})
