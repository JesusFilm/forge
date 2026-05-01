import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock the env singleton — vitest hoists vi.mock before imports, so the
// action under test reads the mocked values when first imported below.
vi.mock("@/config/env", () => ({
  env: {
    ALGOLIA_APP_ID: "TESTAPP",
    ALGOLIA_SEARCH_API_KEY: "test-key",
    ALGOLIA_INDEX: "video-variants-test",
  },
}))

import { env } from "@/config/env"
import { searchAlgolia } from "./algolia-action"

const ENV = env as {
  ALGOLIA_APP_ID: string | undefined
  ALGOLIA_SEARCH_API_KEY: string | undefined
  ALGOLIA_INDEX: string | undefined
}

describe("searchAlgolia", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    ENV.ALGOLIA_APP_ID = "TESTAPP"
    ENV.ALGOLIA_SEARCH_API_KEY = "test-key"
    ENV.ALGOLIA_INDEX = "video-variants-test"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    })
  }

  it("returns shaped hits for a successful Algolia response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          {
            videoId: "BibleProject",
            titles: ["The BibleProject Collection", "Other"],
            description: ["A short film collection."],
          },
          {
            videoId: "JesusFilm",
            titles: ["JESUS Film"],
          },
        ],
      }),
    )

    const result = await searchAlgolia({
      q: "the bible project",
      locale: "en",
      limit: 5,
    })

    expect(result).toEqual({
      hits: [
        {
          videoId: "BibleProject",
          title: "The BibleProject Collection",
          description: "A short film collection.",
        },
        {
          videoId: "JesusFilm",
          title: "JESUS Film",
          description: null,
        },
      ],
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      "https://TESTAPP-dsn.algolia.net/1/indexes/video-variants-test/query",
    )
    expect((init as RequestInit).method).toBe("POST")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Algolia-API-Key"]).toBe("test-key")
    expect(headers["X-Algolia-Application-Id"]).toBe("TESTAPP")
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      query: "the bible project",
      hitsPerPage: 5,
    })
  })

  it("throws algolia_not_configured when any env var is missing", async () => {
    ENV.ALGOLIA_INDEX = undefined
    await expect(
      searchAlgolia({ q: "x", locale: "en", limit: 5 }),
    ).rejects.toThrow("algolia_not_configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws algolia_upstream_error on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
    await expect(
      searchAlgolia({ q: "x", locale: "en", limit: 5 }),
    ).rejects.toThrow("algolia_upstream_error")
  })

  it("throws algolia_upstream_error on fetch network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connection refused"))
    await expect(
      searchAlgolia({ q: "x", locale: "en", limit: 5 }),
    ).rejects.toThrow("algolia_upstream_error")
  })

  it("throws algolia_upstream_error on invalid JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<not json>", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    await expect(
      searchAlgolia({ q: "x", locale: "en", limit: 5 }),
    ).rejects.toThrow("algolia_upstream_error")
  })

  it("clamps limit to MAX_LIMIT (50)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hits: [] }))
    await searchAlgolia({ q: "x", locale: "en", limit: 999 })
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    )
    expect(body.hitsPerPage).toBe(50)
  })

  it("clamps non-positive / non-numeric limit to a sane minimum", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hits: [] }))
    await searchAlgolia({ q: "x", locale: "en", limit: 0 })
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    )
    expect(body.hitsPerPage).toBeGreaterThanOrEqual(1)
  })

  it("tolerates hits without titles or description fields", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          { videoId: "OnlyId" },
          { videoId: "EmptyArrays", titles: [], description: [] },
        ],
      }),
    )
    const result = await searchAlgolia({ q: "x", locale: "en", limit: 5 })
    expect(result.hits).toEqual([
      { videoId: "OnlyId", title: null, description: null },
      { videoId: "EmptyArrays", title: null, description: null },
    ])
  })

  it("drops hits without a string videoId", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [
          { videoId: 123, titles: ["bad"] },
          { videoId: "Good", titles: ["yes"] },
        ],
      }),
    )
    const result = await searchAlgolia({ q: "x", locale: "en", limit: 5 })
    expect(result.hits).toEqual([
      { videoId: "Good", title: "yes", description: null },
    ])
  })
})
