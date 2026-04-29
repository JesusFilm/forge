import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))

// The route constructs a HybridSearchService with the shared `prisma`
// import; we mock the class so tests don't touch the DB.
const searchMock = vi.fn()
vi.mock("@/services/hybrid-search.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/hybrid-search.service")
  >("@/services/hybrid-search.service")
  return {
    ...actual,
    HybridSearchService: vi.fn(() => ({ search: searchMock })),
  }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { GET } from "./route"

const allowRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
  })

const denyRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: false,
    source: "local",
  })

function req(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  allowRateLimit()
  searchMock.mockResolvedValue({
    results: [],
    hasMore: false,
    query: "",
    searchMode: "hybrid",
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/search", () => {
  it("returns 400 when `q` is missing", async () => {
    const res = await GET(req("/api/search?locale=en"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "q (search query) is required",
    })
  })

  it("returns 400 when `q` is whitespace-only", async () => {
    const res = await GET(req("/api/search?q=%20%20&locale=en"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when `locale` is missing", async () => {
    const res = await GET(req("/api/search?q=jesus"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "locale is required" })
  })

  it("returns 400 when `type` is not video/experience", async () => {
    const res = await GET(req("/api/search?q=jesus&locale=en&type=foo"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "type must be 'video' or 'experience'",
    })
  })

  it("passes contentTypes=[video] when type=video", async () => {
    await GET(req("/api/search?q=jesus&locale=en&type=video"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ contentTypes: ["video"] }),
    )
  })

  it("passes contentTypes=undefined when type omitted", async () => {
    await GET(req("/api/search?q=jesus&locale=en"))
    const call = searchMock.mock.calls[0][0]
    expect(call.contentTypes).toBeUndefined()
  })

  it("parses limit + offset as numbers", async () => {
    await GET(req("/api/search?q=jesus&locale=en&limit=10&offset=5"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 5 }),
    )
  })

  it("ignores non-numeric limit/offset", async () => {
    await GET(req("/api/search?q=jesus&locale=en&limit=abc&offset=xyz"))
    const call = searchMock.mock.calls[0][0]
    expect(call.limit).toBeUndefined()
    expect(call.offset).toBeUndefined()
  })

  it("returns 200 with service response on happy path", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        {
          type: "video",
          id: "vid-1",
          slug: "jesus",
          title: "Jesus",
          imageUrl: null,
          snippet: "scene",
          startSeconds: 0,
          playbackId: "mux-1",
          score: 1,
        },
      ],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })

    const res = await GET(req("/api/search?q=jesus&locale=en"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(1)
    expect(body.searchMode).toBe("hybrid")
  })

  it("returns 429 when rate limit exceeded", async () => {
    denyRateLimit()
    const res = await GET(req("/api/search?q=jesus&locale=en"))
    expect(res.status).toBe(429)
  })

  it("forwards mode='keyword-first' to the service", async () => {
    await GET(req("/api/search?q=jesus&locale=en&mode=keyword-first"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "keyword-first" }),
    )
  })

  it("forwards arbitrary mode values verbatim (service warn-and-falls-back)", async () => {
    await GET(req("/api/search?q=jesus&locale=en&mode=garbage"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "garbage" }),
    )
  })

  it("treats empty mode (?mode=) as undefined to avoid polluting the warn log", async () => {
    await GET(req("/api/search?q=jesus&locale=en&mode="))
    const call = searchMock.mock.calls[0][0]
    expect(call.mode).toBeUndefined()
  })

  it("treats omitted mode as undefined", async () => {
    await GET(req("/api/search?q=jesus&locale=en"))
    const call = searchMock.mock.calls[0][0]
    expect(call.mode).toBeUndefined()
  })

  it("returns 503 when service throws", async () => {
    searchMock.mockRejectedValueOnce(new Error("boom"))
    const res = await GET(req("/api/search?q=jesus&locale=en"))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: "Search is temporarily unavailable",
    })
  })
})
