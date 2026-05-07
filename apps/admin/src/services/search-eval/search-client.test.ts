import { describe, expect, it, vi } from "vitest"

import {
  SearchClientError,
  SNIPPET_MAX_CODEPOINTS,
  createSearchClient,
  truncateSnippet,
} from "./search-client"
import type { SearchResult } from "./types"

const sampleVideoResult: SearchResult = {
  type: "video",
  id: "v_abc",
  slug: "easter-explained",
  title: "Easter Explained",
  imageUrl: "https://example/img.jpg",
  snippet: "Themes: new life, awe, meaning. Bible verses: 2 Cor 5:17.",
  startSeconds: 0,
  playbackId: "pb_abc",
  score: 0.488,
}

const sampleExperienceResult: SearchResult = {
  type: "experience",
  id: "e_xyz",
  slug: "advent",
  title: "Advent Experience",
  imageUrl: null,
  snippet: "Reflections for the season.",
  startSeconds: null,
  playbackId: null,
  score: 0.412,
}

function buildResponse(results: SearchResult[], status = 200): Response {
  return new Response(
    JSON.stringify({
      results,
      hasMore: false,
      query: "test",
      searchMode: "hybrid",
    }),
    { status, headers: { "content-type": "application/json" } },
  )
}

describe("createSearchClient", () => {
  describe("happy path", () => {
    it("returns the parsed result list with snippets truncated", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          buildResponse([sampleVideoResult, sampleExperienceResult]),
        )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      const results = await client.search("hope", "en")
      expect(results).toHaveLength(2)
      expect(results[0]?.id).toBe("v_abc")
      expect(results[0]?.snippet.length).toBeLessThanOrEqual(
        SNIPPET_MAX_CODEPOINTS,
      )
    })

    it("builds a URL with q, locale, and default limit=20", async () => {
      let capturedUrl: string | undefined
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = input.toString()
        return buildResponse([])
      })

      const client = createSearchClient({
        baseUrl: "http://localhost:3003/",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await client.search("hope in suffering", "fr")
      expect(capturedUrl).toBe(
        "http://localhost:3003/api/search?q=hope+in+suffering&locale=fr&limit=20",
      )
    })

    it("forwards optional mode + contentType params", async () => {
      let capturedUrl: string | undefined
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = input.toString()
        return buildResponse([])
      })

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await client.search("q", "en", {
        mode: "keyword-first",
        contentType: "video",
      })
      expect(capturedUrl).toContain("mode=keyword-first")
      expect(capturedUrl).toContain("type=video")
    })

    it("preserves null playbackId / imageUrl", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(buildResponse([sampleExperienceResult]))

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      const [result] = await client.search("q", "en")
      expect(result?.imageUrl).toBeNull()
      expect(result?.playbackId).toBeNull()
    })
  })

  describe("error paths", () => {
    it("throws rate_limited on 429", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        name: "SearchClientError",
        code: "rate_limited",
        status: 429,
      })
    })

    it("throws validation on 400", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "locale is required" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "validation",
        status: 400,
      })
    })

    it("throws server_error on 503", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "server_error",
        status: 503,
      })
    })

    it("throws transport on network error", async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "transport",
      })
    })

    it("throws timeout when AbortSignal fires", async () => {
      const timeoutErr = new DOMException("aborted", "TimeoutError")
      const fetchImpl = vi.fn().mockRejectedValue(timeoutErr)
      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "timeout",
      })
    })

    it("rejects an empty query before issuing fetch", async () => {
      const fetchImpl = vi.fn()
      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("", "en")).rejects.toBeInstanceOf(
        SearchClientError,
      )
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it("throws response_invalid on malformed response shape", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "response_invalid",
      })
    })

    it("throws response_invalid on invalid JSON body", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "response_invalid",
      })
    })
  })
})

describe("truncateSnippet", () => {
  it("leaves short snippets untouched", () => {
    const r = { ...sampleVideoResult, snippet: "short" }
    expect(truncateSnippet(r).snippet).toBe("short")
  })

  it("cuts long snippets to 200 codepoints", () => {
    const r = { ...sampleVideoResult, snippet: "a".repeat(500) }
    expect(Array.from(truncateSnippet(r).snippet).length).toBe(
      SNIPPET_MAX_CODEPOINTS,
    )
  })

  it("does not slice mid-codepoint for emoji / CJK", () => {
    // Each emoji is a surrogate pair (2 UTF-16 units, 1 codepoint).
    // 250 emoji = 500 UTF-16 units, 250 codepoints. Truncated should
    // be exactly 200 codepoints, never half an emoji.
    const r = { ...sampleVideoResult, snippet: "🙏".repeat(250) }
    const truncated = truncateSnippet(r).snippet
    expect(Array.from(truncated)).toHaveLength(SNIPPET_MAX_CODEPOINTS)
    // Round-trip via Array.from should yield only intact emoji.
    expect(truncated).toBe("🙏".repeat(SNIPPET_MAX_CODEPOINTS))
  })
})
