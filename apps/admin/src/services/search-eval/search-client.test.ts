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
    const fastSleep = () => Promise.resolve()

    it("throws rate_limited on persistent 429", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        name: "SearchClientError",
        code: "rate_limited",
        status: 429,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(3) // retried twice
    })

    it("throws validation on 400 (no retry — 400 is not retryable)", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "locale is required" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "validation",
        status: 400,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1) // 400 not retried
    })

    it("throws server_error on persistent 503", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "server_error",
        status: 503,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(3) // retried twice
    })

    it("throws transport on network error", async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "transport",
      })
    })

    it("throws timeout when AbortSignal fires on every attempt", async () => {
      const timeoutErr = new DOMException("aborted", "TimeoutError")
      const fetchImpl = vi.fn().mockRejectedValue(timeoutErr)
      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "timeout",
      })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
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

  describe("retry behavior (P1 fix)", () => {
    const fastSleep = () => Promise.resolve()
    const muteLogger = { warn: () => {}, info: () => {} }

    it("retries on 5xx then succeeds", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("err", {
            status: 502,
            headers: { "content-type": "text/plain" },
          }),
        )
        .mockResolvedValueOnce(buildResponse([sampleVideoResult]))

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
        logger: muteLogger,
      })

      const results = await client.search("q", "en")
      expect(results).toHaveLength(1)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it("retries on 429 then succeeds", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Too many" }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(buildResponse([sampleVideoResult]))

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
        logger: muteLogger,
      })

      const results = await client.search("q", "en")
      expect(results).toHaveLength(1)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it("honors Retry-After header on 429", async () => {
      const sleepCalls: number[] = []
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("rate", {
            status: 429,
            headers: { "retry-after": "5" },
          }),
        )
        .mockResolvedValueOnce(buildResponse([sampleVideoResult]))

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async (ms) => {
          sleepCalls.push(ms)
        },
        logger: muteLogger,
      })

      await client.search("q", "en")
      expect(sleepCalls[0]).toBe(5_000)
    })

    it("caps Retry-After at 30s", async () => {
      const sleepCalls: number[] = []
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("rate", {
            status: 429,
            headers: { "retry-after": "120" },
          }),
        )
        .mockResolvedValueOnce(buildResponse([sampleVideoResult]))

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async (ms) => {
          sleepCalls.push(ms)
        },
        logger: muteLogger,
      })

      await client.search("q", "en")
      expect(sleepCalls[0]).toBe(30_000)
    })

    it("retries on transport error then succeeds", async () => {
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(buildResponse([sampleVideoResult]))

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
        logger: muteLogger,
      })

      const results = await client.search("q", "en")
      expect(results).toHaveLength(1)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it("does NOT retry on 400 (validation)", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "bad" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: fastSleep,
        logger: muteLogger,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "validation",
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it("respects maxAttempts override (single-shot mode)", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response("err", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }),
      )

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxAttempts: 1,
        sleep: fastSleep,
        logger: muteLogger,
      })

      await expect(client.search("q", "en")).rejects.toMatchObject({
        code: "server_error",
        status: 503,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it("emits structured retry log on retryable status", async () => {
      const log = { warn: vi.fn(), info: vi.fn() }
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("err", { status: 503, headers: { "retry-after": "1" } }),
        )
        .mockResolvedValueOnce(buildResponse([sampleVideoResult]))

      const client = createSearchClient({
        baseUrl: "http://localhost:3003",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        logger: log,
      })

      await client.search("q", "en")
      const retryLine = log.info.mock.calls.find((c) =>
        String(c[0]).includes("event=search.retry"),
      )
      expect(retryLine).toBeDefined()
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
