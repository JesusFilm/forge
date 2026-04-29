import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../services/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/search")>()
  return {
    ...actual,
    search: vi.fn(),
  }
})

vi.mock("../../../lib/openrouter", () => ({
  embedQuery: vi.fn(),
}))

import { embedQuery } from "../../../lib/openrouter"
import { search } from "../services/search"
import { __resetSearchHealthForTest, getStats } from "../services/search-health"
import searchControllerFactory from "./search"

type StrapiContext = {
  status: number
  body: unknown
  request: {
    query?: Record<string, string | undefined>
    headers?: Record<string, string | undefined>
  }
}

function makeCtx(
  query?: Record<string, string | undefined>,
  headers?: Record<string, string | undefined>,
): StrapiContext {
  return {
    status: 0,
    body: undefined,
    request: { query, headers },
  }
}

const mockStrapi = {
  log: { error: vi.fn(), warn: vi.fn() },
} as unknown as Parameters<typeof searchControllerFactory>[0]["strapi"]

const controller = searchControllerFactory({ strapi: mockStrapi })

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
})

describe("search controller", () => {
  it("returns 400 when q is missing", async () => {
    const ctx = makeCtx({ locale: "en" })
    await controller.search(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: "q (search query) is required" })
    expect(search).not.toHaveBeenCalled()
  })

  it("returns 400 when q is whitespace-only", async () => {
    const ctx = makeCtx({ q: "   ", locale: "en" })
    await controller.search(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: "q (search query) is required" })
    expect(search).not.toHaveBeenCalled()
  })

  it("returns 400 when locale is missing", async () => {
    const ctx = makeCtx({ q: "forgiveness" })
    await controller.search(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: "locale is required" })
    expect(search).not.toHaveBeenCalled()
  })

  it("returns 200 with search results on success", async () => {
    const mockResult = {
      results: [
        {
          type: "video" as const,
          id: 1,
          slug: "forgiveness",
          title: "Forgiveness",
          imageUrl: null,
          snippet: "A scene",
          startSeconds: 0,
          playbackId: "abc",
          score: 0.9,
        },
      ],
      hasMore: false,
      query: "forgiveness",
      searchMode: "hybrid" as const,
    }
    vi.mocked(search).mockResolvedValue(mockResult)

    const ctx = makeCtx({ q: "forgiveness", locale: "en" })
    await controller.search(ctx)

    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual(mockResult)
    expect(search).toHaveBeenCalledWith(mockStrapi, {
      query: "forgiveness",
      locale: "en",
      limit: undefined,
      offset: undefined,
      contentTypes: undefined,
      mode: undefined,
      debug: false,
    })
  })

  it("trims whitespace from the query before calling the service", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "grief",
      searchMode: "hybrid",
    })

    const ctx = makeCtx({ q: "  grief  ", locale: "en" })
    await controller.search(ctx)

    expect(search).toHaveBeenCalledWith(
      mockStrapi,
      expect.objectContaining({ query: "grief" }),
    )
  })

  it("parses numeric limit and offset params", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "hope",
      searchMode: "hybrid",
    })

    const ctx = makeCtx({
      q: "hope",
      locale: "en",
      limit: "10",
      offset: "20",
    })
    await controller.search(ctx)

    expect(search).toHaveBeenCalledWith(
      mockStrapi,
      expect.objectContaining({ limit: 10, offset: 20 }),
    )
  })

  it("returns 503 when the search service throws", async () => {
    vi.mocked(search).mockRejectedValue(new Error("OpenRouter down"))

    const ctx = makeCtx({ q: "grief", locale: "en" })
    await controller.search(ctx)

    expect(ctx.status).toBe(503)
    expect(ctx.body).toEqual({ error: "Search is temporarily unavailable" })
    expect(mockStrapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining("OpenRouter down"),
    )
  })

  it("handles an undefined request.query object", async () => {
    const ctx = makeCtx(undefined)
    await controller.search(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: "q (search query) is required" })
  })

  describe("type filter", () => {
    beforeEach(() => {
      vi.mocked(search).mockResolvedValue({
        results: [],
        hasMore: false,
        query: "test",
        searchMode: "hybrid",
      })
    })

    it("passes contentTypes=['video'] when type=video", async () => {
      const ctx = makeCtx({ q: "test", locale: "en", type: "video" })
      await controller.search(ctx)

      expect(ctx.status).toBe(200)
      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ contentTypes: ["video"] }),
      )
    })

    it("passes contentTypes=['experience'] when type=experience", async () => {
      const ctx = makeCtx({ q: "test", locale: "en", type: "experience" })
      await controller.search(ctx)

      expect(ctx.status).toBe(200)
      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ contentTypes: ["experience"] }),
      )
    })

    it("passes contentTypes=undefined when type is omitted", async () => {
      const ctx = makeCtx({ q: "test", locale: "en" })
      await controller.search(ctx)

      expect(ctx.status).toBe(200)
      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ contentTypes: undefined }),
      )
    })

    it("returns 400 when type is invalid", async () => {
      const ctx = makeCtx({ q: "test", locale: "en", type: "invalid" })
      await controller.search(ctx)

      expect(ctx.status).toBe(400)
      expect(ctx.body).toEqual({
        error: "type must be 'video' or 'experience'",
      })
      expect(search).not.toHaveBeenCalled()
    })

    it("treats an explicit empty-string type as omitted (defaults to both)", async () => {
      // An explicit empty string is treated the same as omitting the param.
      // Callers building URLs with optional values shouldn't get spurious 400s.
      const ctx = makeCtx({ q: "test", locale: "en", type: "" })
      await controller.search(ctx)

      // Empty string falls through to the default — both content types.
      expect(ctx.status).toBe(200)
      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ contentTypes: undefined }),
      )
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

    it("forwards mode='keyword-first' to the service", async () => {
      const ctx = makeCtx({ q: "test", locale: "en", mode: "keyword-first" })
      await controller.search(ctx)

      expect(ctx.status).toBe(200)
      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ mode: "keyword-first" }),
      )
    })

    it("forwards mode='hybrid' to the service explicitly", async () => {
      const ctx = makeCtx({ q: "test", locale: "en", mode: "hybrid" })
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ mode: "hybrid" }),
      )
    })

    it("treats explicit empty-string mode as omitted", async () => {
      // Mirrors `type=""` — callers building URLs with unset variables
      // should not trigger spurious behavior changes.
      const ctx = makeCtx({ q: "test", locale: "en", mode: "" })
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ mode: undefined }),
      )
    })

    it("forwards unknown mode values verbatim — service warn-and-falls-back", async () => {
      // The controller does NOT validate `mode` (unlike `type`). An
      // unknown value reaches the service, which logs a structured warn
      // and falls back to hybrid behavior. This keeps a typoed param
      // from breaking a user's search.
      const ctx = makeCtx({ q: "test", locale: "en", mode: "garbage" })
      await controller.search(ctx)

      expect(ctx.status).toBe(200)
      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ mode: "garbage" }),
      )
    })

    it("passes mode=undefined when not provided", async () => {
      const ctx = makeCtx({ q: "test", locale: "en" })
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ mode: undefined }),
      )
    })
  })

  describe("debug argument (feat-109)", () => {
    const SAVED_NODE_ENV = process.env.NODE_ENV

    beforeEach(() => {
      vi.mocked(search).mockResolvedValue({
        results: [],
        hasMore: false,
        query: "test",
        searchMode: "hybrid",
      })
      // Default to development so the allowlist permits localhost.
      process.env.NODE_ENV = "development"
    })

    afterEach(() => {
      if (SAVED_NODE_ENV == null) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = SAVED_NODE_ENV
      }
    })

    it("forwards debug=true when origin is allowed", async () => {
      const ctx = makeCtx(
        { q: "test", locale: "en", debug: "true" },
        { origin: "http://localhost:3000" },
      )
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ debug: true }),
      )
    })

    it("forwards debug=false when origin is undefined (fail closed)", async () => {
      const ctx = makeCtx({ q: "test", locale: "en", debug: "true" })
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ debug: false }),
      )
    })

    it("forwards debug=false when origin is empty string", async () => {
      const ctx = makeCtx(
        { q: "test", locale: "en", debug: "true" },
        { origin: "" },
      )
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ debug: false }),
      )
    })

    it("forwards debug=false in production when no allowlist is configured", async () => {
      process.env.NODE_ENV = "production"
      delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS

      const ctx = makeCtx(
        { q: "test", locale: "en", debug: "true" },
        { origin: "https://prod.example.com" },
      )
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ debug: false }),
      )
    })

    it("forwards debug=false when query has no debug param", async () => {
      const ctx = makeCtx(
        { q: "test", locale: "en" },
        { origin: "http://localhost:3000" },
      )
      await controller.search(ctx)

      expect(search).toHaveBeenCalledWith(
        mockStrapi,
        expect.objectContaining({ debug: false }),
      )
    })
  })
})

describe("search controller health probe", () => {
  // ctx for health probe has no query params but includes the `set`
  // function signature. The controller only writes status + body, but we
  // pass `set` to match the real Koa shape.
  function makeHealthCtx(): StrapiContext & {
    set: (h: string, v: string) => void
  } {
    return {
      status: 0,
      body: undefined,
      request: {},
      set: vi.fn(),
    }
  }

  it("returns status 'ok' with counter snapshot when the probe embedding succeeds", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1, 0.2, 0.3])

    const ctx = makeHealthCtx()
    await controller.health(ctx)

    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({
      status: "ok",
      error: null,
      attempts: 1,
      failures: 0,
      lastErrorMessage: null,
      lastErrorClass: null,
      lastErrorAt: null,
    })
    expect(embedQuery).toHaveBeenCalledWith("health probe")
    // The happy path must NOT log an error — alert channels should only
    // fire on real problems.
    expect(mockStrapi.log.error).not.toHaveBeenCalled()
  })

  it("returns status 'degraded' with the error details when embedQuery rejects", async () => {
    vi.mocked(embedQuery).mockRejectedValue(
      new Error("OPENROUTER_API_KEY is not set"),
    )

    const ctx = makeHealthCtx()
    await controller.health(ctx)

    // Still 200 — the probe endpoint is always reachable; the body
    // carries the machine-readable status. This matches Railway's
    // healthcheck convention of body-based signals.
    expect(ctx.status).toBe(200)
    expect(ctx.body).toMatchObject({
      status: "degraded",
      error: "OPENROUTER_API_KEY is not set",
      attempts: 1,
      failures: 1,
      lastErrorClass: "Error",
      lastErrorMessage: "OPENROUTER_API_KEY is not set",
    })
    expect(
      (ctx.body as { lastErrorAt: string | null }).lastErrorAt,
    ).not.toBeNull()
    expect(mockStrapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining("event=health_probe_failed"),
    )
    expect(mockStrapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining("error_class=Error"),
    )
    // feat-097 regression guard: failures must surface at error level, never
    // downgraded to warn where Railway's default retention would hide them.
    expect(mockStrapi.log.warn).not.toHaveBeenCalled()
  })

  it("formats degraded response correctly for non-Error rejection values", async () => {
    vi.mocked(embedQuery).mockRejectedValue("raw string error")

    const ctx = makeHealthCtx()
    await controller.health(ctx)

    expect(ctx.status).toBe(200)
    expect(ctx.body).toMatchObject({
      status: "degraded",
      error: "raw string error",
      lastErrorClass: "UnknownError",
      lastErrorMessage: "raw string error",
    })
    expect(mockStrapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining("error_class=UnknownError"),
    )
    expect(mockStrapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining("message=raw string error"),
    )
  })

  it("treats a hung embedding call as degraded after the 5s timeout", async () => {
    vi.useFakeTimers()
    try {
      const hung = new Promise<number[]>(() => {
        // never resolves — simulates OpenRouter network hang
      })
      vi.mocked(embedQuery).mockReturnValue(hung)

      const ctx = makeHealthCtx()
      const pending = controller.health(ctx)
      await vi.advanceTimersByTimeAsync(5_001)
      await pending

      expect(ctx.status).toBe(200)
      expect(ctx.body).toMatchObject({ status: "degraded" })
      expect((ctx.body as { error: string }).error).toMatch(
        /Timed out after 5000ms/,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("updates the shared counters so user-search and probe traffic aggregate", async () => {
    vi.mocked(embedQuery).mockResolvedValue([0.1])
    await controller.health(makeHealthCtx())

    vi.mocked(embedQuery).mockRejectedValue(new Error("network down"))
    await controller.health(makeHealthCtx())

    const stats = getStats()
    expect(stats.attempts).toBe(2)
    expect(stats.failures).toBe(1)
    expect(stats.lastErrorClass).toBe("Error")
    expect(stats.lastErrorMessage).toBe("network down")
  })
})
