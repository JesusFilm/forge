import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../services/search", () => ({
  search: vi.fn(),
}))

import { search } from "../services/search"
import searchControllerFactory from "./search"

type StrapiContext = {
  status: number
  body: unknown
  request: {
    query?: Record<string, string | undefined>
  }
}

function makeCtx(query?: Record<string, string | undefined>): StrapiContext {
  return {
    status: 0,
    body: undefined,
    request: { query },
  }
}

const mockStrapi = {
  log: { error: vi.fn() },
} as unknown as Parameters<typeof searchControllerFactory>[0]["strapi"]

const controller = searchControllerFactory({ strapi: mockStrapi })

beforeEach(() => {
  vi.clearAllMocks()
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
    })
  })

  it("trims whitespace from the query before calling the service", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [],
      hasMore: false,
      query: "grief",
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
})
