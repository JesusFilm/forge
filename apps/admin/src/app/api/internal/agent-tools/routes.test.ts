import { beforeEach, describe, expect, it, vi } from "vitest"

// -----------------------------------------------------------------------------
// Hoisted mocks for the shared route plumbing + the service fns. Schemas stay
// REAL (importOriginal) so body validation is load-bearing, not stubbed.
// -----------------------------------------------------------------------------

const {
  rateLimitMock,
  bearerMock,
  searchVideosMock,
  lookupBibleVerseMock,
  fetchVideoImageMock,
} = vi.hoisted(() => ({
  rateLimitMock: vi.fn(),
  bearerMock: vi.fn(),
  searchVideosMock: vi.fn(),
  lookupBibleVerseMock: vi.fn(),
  fetchVideoImageMock: vi.fn(),
}))

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute: rateLimitMock }))
vi.mock("@/auth/agent-tools-bearer", () => ({
  isValidAgentToolsBearer: bearerMock,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock(
  "@/services/experience-ai/agent-tools.service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/services/experience-ai/agent-tools.service")
      >()
    return {
      ...actual,
      searchVideosForAgent: searchVideosMock,
      lookupBibleVerseForAgent: lookupBibleVerseMock,
      fetchVideoImageForAgent: fetchVideoImageMock,
    }
  },
)

import {
  POST as searchVideosPost,
  GET as searchVideosGet,
} from "./search-videos/route"
import { POST as lookupBiblePost } from "./lookup-bible-verse/route"
import { POST as fetchImagePost } from "./fetch-video-image/route"

function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: "Bearer test-key",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const SEARCH_URL = "http://admin/api/internal/agent-tools/search-videos"
const BIBLE_URL = "http://admin/api/internal/agent-tools/lookup-bible-verse"
const IMAGE_URL = "http://admin/api/internal/agent-tools/fetch-video-image"

describe("agent-tools routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMock.mockResolvedValue({ allowed: true, source: "ip" })
    bearerMock.mockReturnValue(true)
  })

  describe("shared plumbing (via search-videos)", () => {
    it("rate-limits BEFORE the bearer check — 429 and bearer never consulted", async () => {
      rateLimitMock.mockResolvedValue({ allowed: false, source: "ip" })
      const res = await searchVideosPost(
        post(SEARCH_URL, { q: "hope", locale: "en" }),
      )
      expect(res.status).toBe(429)
      expect(bearerMock).not.toHaveBeenCalled()
    })

    it("returns 401 when the bearer is invalid", async () => {
      bearerMock.mockReturnValue(false)
      const res = await searchVideosPost(
        post(SEARCH_URL, { q: "hope", locale: "en" }),
      )
      expect(res.status).toBe(401)
      expect(searchVideosMock).not.toHaveBeenCalled()
    })

    it("returns 415 when the content-type is not application/json", async () => {
      const res = await searchVideosPost(
        post(
          SEARCH_URL,
          { q: "hope", locale: "en" },
          { "content-type": "text/plain" },
        ),
      )
      expect(res.status).toBe(415)
    })

    it("returns 400 on a body that fails the request schema (missing q)", async () => {
      const res = await searchVideosPost(post(SEARCH_URL, { locale: "en" }))
      expect(res.status).toBe(400)
      expect(searchVideosMock).not.toHaveBeenCalled()
    })

    it("degrades a thrown service error to 503", async () => {
      searchVideosMock.mockRejectedValue(new Error("DB unreachable"))
      const res = await searchVideosPost(
        post(SEARCH_URL, { q: "hope", locale: "en" }),
      )
      expect(res.status).toBe(503)
    })

    it("GET is unauthorized (405-ish: this is a POST-only internal surface)", async () => {
      const res = await searchVideosGet()
      expect(res.status).toBe(401)
    })
  })

  describe("search-videos happy path", () => {
    it("returns 200 + the trimmed { videos } from the service", async () => {
      searchVideosMock.mockResolvedValue({
        videos: [
          {
            videoId: "v2",
            title: "Easter",
            snippet: "Easter video.",
            slug: "easter",
            imageUrl: null,
            playbackId: "pb-1",
            durationSeconds: 312,
            languageSlug: "english",
          },
        ],
      })
      const res = await searchVideosPost(
        post(SEARCH_URL, { q: "easter", locale: "en", limit: 5 }),
      )
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        videos: [
          {
            videoId: "v2",
            title: "Easter",
            snippet: "Easter video.",
            slug: "easter",
            imageUrl: null,
            playbackId: "pb-1",
            durationSeconds: 312,
            languageSlug: "english",
          },
        ],
      })
      expect(searchVideosMock).toHaveBeenCalledWith(
        {},
        { q: "easter", locale: "en", limit: 5 },
      )
    })
  })

  describe("lookup-bible-verse happy path", () => {
    it("returns 200 + { books } and applies the default locale/limit", async () => {
      lookupBibleVerseMock.mockResolvedValue({
        books: [
          {
            bookId: "b1",
            osisId: "John",
            displayName: "John",
            testament: "NT",
            order: 43,
          },
        ],
      })
      const res = await lookupBiblePost(post(BIBLE_URL, { query: "John" }))
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({
        books: [{ bookId: "b1" }],
      })
      // Defaults applied by the request schema before the service is called.
      expect(lookupBibleVerseMock).toHaveBeenCalledWith(
        {},
        { query: "John", locale: "en", limit: 3 },
      )
    })

    it("returns 400 on a missing query", async () => {
      const res = await lookupBiblePost(post(BIBLE_URL, { locale: "en" }))
      expect(res.status).toBe(400)
    })
  })

  describe("fetch-video-image happy path", () => {
    it("returns 200 + { imageUrl, variant }", async () => {
      fetchVideoImageMock.mockResolvedValue({
        imageUrl: "https://cdn/hero.png",
        variant: "mobileCinematicHigh",
      })
      const res = await fetchImagePost(post(IMAGE_URL, { videoId: "v1" }))
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        imageUrl: "https://cdn/hero.png",
        variant: "mobileCinematicHigh",
      })
    })

    it("returns 400 on a missing videoId", async () => {
      const res = await fetchImagePost(post(IMAGE_URL, {}))
      expect(res.status).toBe(400)
    })
  })
})
