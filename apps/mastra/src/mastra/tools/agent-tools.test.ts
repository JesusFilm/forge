import { describe, expect, it, vi } from "vitest"

import { executeSearchVideos } from "./search-videos"
import { executeLookupBibleVerse } from "./lookup-bible-verse"
import { executeFetchVideoImage } from "./fetch-video-image"

/**
 * Tool executor tests (consolidation U8). Each tool maps a successful
 * admin-agent-tools-client result to its output shape and degrades EVERY client
 * failure to an empty result so a tool outage never crashes the agent turn.
 */

describe("executeSearchVideos", () => {
  it("maps an ok client result to { videos }", async () => {
    const search = vi.fn(async (_input: unknown) => ({
      ok: true as const,
      data: {
        videos: [
          {
            videoId: "v1",
            title: "Easter",
            snippet: "Easter video.",
            slug: "easter",
            imageUrl: null,
          },
        ],
      },
    }))
    const result = await executeSearchVideos(
      { q: "easter", locale: "en", limit: 5 },
      { search },
    )
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].videoId).toBe("v1")
    // The executor forwards the parsed input (q/locale/limit) to the client.
    expect(search.mock.calls[0][0]).toEqual({
      q: "easter",
      locale: "en",
      limit: 5,
    })
  })

  it("degrades any client failure (auth_failed) to an empty videos array", async () => {
    const search = vi.fn(async (_input: unknown) => ({
      ok: false as const,
      reason: "auth_failed" as const,
      retryable: false,
    }))
    const result = await executeSearchVideos(
      { q: "x", locale: "en" },
      { search },
    )
    expect(result).toEqual({ videos: [] })
  })

  it("degrades a config_missing failure to an empty videos array", async () => {
    const search = vi.fn(async (_input: unknown) => ({
      ok: false as const,
      reason: "config_missing" as const,
      retryable: false,
    }))
    const result = await executeSearchVideos(
      { q: "x", locale: "en" },
      { search },
    )
    expect(result).toEqual({ videos: [] })
  })
})

describe("executeLookupBibleVerse", () => {
  it("maps an ok client result to { books }", async () => {
    const lookup = vi.fn(async (_input: unknown) => ({
      ok: true as const,
      data: {
        books: [
          {
            bookId: "b1",
            osisId: "John",
            displayName: "John",
            testament: "NT",
            order: 43,
          },
        ],
      },
    }))
    const result = await executeLookupBibleVerse({ query: "John" }, { lookup })
    expect(result.books[0].bookId).toBe("b1")
    // Defaults applied (locale "en", limit 3) and forwarded.
    expect(lookup.mock.calls[0][0]).toEqual({
      query: "John",
      locale: "en",
      limit: 3,
    })
  })

  it("degrades a timeout failure to an empty books array", async () => {
    const lookup = vi.fn(async (_input: unknown) => ({
      ok: false as const,
      reason: "timeout" as const,
      retryable: true,
    }))
    const result = await executeLookupBibleVerse({ query: "John" }, { lookup })
    expect(result).toEqual({ books: [] })
  })
})

describe("executeFetchVideoImage", () => {
  it("maps an ok client result to { imageUrl, variant }", async () => {
    const fetchImage = vi.fn(async (_input: unknown) => ({
      ok: true as const,
      data: {
        imageUrl: "https://cdn/hero.png",
        variant: "mobileCinematicHigh",
      },
    }))
    const result = await executeFetchVideoImage(
      { videoId: "v1" },
      { fetchImage },
    )
    expect(result).toEqual({
      imageUrl: "https://cdn/hero.png",
      variant: "mobileCinematicHigh",
    })
  })

  it("degrades a network_error failure to { imageUrl: null, variant: null }", async () => {
    const fetchImage = vi.fn(async (_input: unknown) => ({
      ok: false as const,
      reason: "network_error" as const,
      retryable: true,
    }))
    const result = await executeFetchVideoImage(
      { videoId: "v1" },
      { fetchImage },
    )
    expect(result).toEqual({ imageUrl: null, variant: null })
  })
})
