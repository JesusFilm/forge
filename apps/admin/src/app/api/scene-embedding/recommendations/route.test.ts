import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))

const getRecommendationsMock = vi.fn()
vi.mock("@/services/scene-recommendations.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/scene-recommendations.service")
  >("@/services/scene-recommendations.service")
  return {
    ...actual,
    SceneRecommendationsService: vi.fn(() => ({
      getRecommendations: getRecommendationsMock,
    })),
  }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { VideoNotFoundError } from "@/services/scene-recommendations.service"
import { GET } from "./route"

const allowRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
    count: 1,
  })

const denyRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: false,
    source: "local",
    count: 31,
  })

function req(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  allowRateLimit()
  getRecommendationsMock.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/scene-embedding/recommendations", () => {
  it("returns 400 when neither videoId nor slug is provided", async () => {
    const res = await GET(req("/api/scene-embedding/recommendations?locale=en"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "videoId or slug is required" })
  })

  it("returns 400 when locale is missing", async () => {
    const res = await GET(
      req("/api/scene-embedding/recommendations?slug=jesus"),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "locale is required" })
  })

  it("returns 400 when sceneIndex is not numeric", async () => {
    const res = await GET(
      req(
        "/api/scene-embedding/recommendations?slug=jesus&locale=en&sceneIndex=foo",
      ),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "sceneIndex must be a number" })
  })

  it("returns 200 with { recommendations } envelope on success", async () => {
    getRecommendationsMock.mockResolvedValueOnce([
      {
        videoId: "vid-2",
        videoSlug: "other",
        videoTitle: "Other",
        imageUrl: null,
        sceneIndex: 0,
        description: "",
        startSeconds: 0,
        endSeconds: null,
        similarity: 0.9,
        themes: [],
        demographics: [],
        spiritualContext: [],
        playbackId: "mux-x",
      },
    ])
    const res = await GET(
      req("/api/scene-embedding/recommendations?slug=jesus&locale=en"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recommendations).toHaveLength(1)
    expect(body.recommendations[0].videoId).toBe("vid-2")
  })

  it("passes videoId, slug, locale, sceneIndex, limit through to the service", async () => {
    await GET(
      req(
        "/api/scene-embedding/recommendations?videoId=vid-1&slug=jesus&locale=en&sceneIndex=3&limit=5",
      ),
    )
    expect(getRecommendationsMock).toHaveBeenCalledWith({
      videoId: "vid-1",
      slug: "jesus",
      locale: "en",
      sceneIndex: 3,
      limit: 5,
    })
  })

  it("returns 404 when the service throws VideoNotFoundError", async () => {
    getRecommendationsMock.mockRejectedValueOnce(
      new VideoNotFoundError("vid-1", 3),
    )
    const res = await GET(
      req(
        "/api/scene-embedding/recommendations?videoId=vid-1&locale=en&sceneIndex=3",
      ),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/No embedding found/)
  })

  it("returns 429 when the rate limit denies", async () => {
    denyRateLimit()
    const res = await GET(
      req("/api/scene-embedding/recommendations?slug=jesus&locale=en"),
    )
    expect(res.status).toBe(429)
  })

  it("treats empty-string videoId and slug as missing (400)", async () => {
    const res = await GET(
      req("/api/scene-embedding/recommendations?videoId=&slug=&locale=en"),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "videoId or slug is required" })
  })

  it("treats whitespace-only slug as missing (400)", async () => {
    const res = await GET(
      req("/api/scene-embedding/recommendations?slug=%20%20%20&locale=en"),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "videoId or slug is required" })
  })

  it("rejects whitespace-only locale (400)", async () => {
    const res = await GET(
      req("/api/scene-embedding/recommendations?slug=jesus&locale=%20%20"),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "locale is required" })
  })

  it("forwards non-numeric limit as undefined (service uses default)", async () => {
    await GET(
      req(
        "/api/scene-embedding/recommendations?slug=jesus&locale=en&limit=abc",
      ),
    )
    expect(getRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: undefined }),
    )
  })

  it("forwards negative and zero limit verbatim (service clamps)", async () => {
    // Documents the boundary: REST accepts pathological numeric limits
    // and the service clamps to [1, MAX_LIMIT]. A future cms-parity fix
    // for `limit=0` should update both this test and the service.
    await GET(
      req("/api/scene-embedding/recommendations?slug=jesus&locale=en&limit=-5"),
    )
    expect(getRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: -5 }),
    )
    vi.clearAllMocks()
    allowRateLimit()
    getRecommendationsMock.mockResolvedValue([])
    await GET(
      req("/api/scene-embedding/recommendations?slug=jesus&locale=en&limit=0"),
    )
    expect(getRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 0 }),
    )
  })

  it("returns 503 on unexpected service failure", async () => {
    getRecommendationsMock.mockRejectedValueOnce(new Error("boom"))
    const res = await GET(
      req("/api/scene-embedding/recommendations?slug=jesus&locale=en"),
    )
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("Scene recommendation features not available")
  })
})
