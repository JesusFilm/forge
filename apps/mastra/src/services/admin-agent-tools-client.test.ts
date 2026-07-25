import { describe, expect, it, vi } from "vitest"

import {
  fetchVideoImageViaAdmin,
  lookupBibleVerseViaAdmin,
  searchVideosViaAdmin,
  type AdminAgentToolsConfig,
} from "./admin-agent-tools-client"

const CONFIG: AdminAgentToolsConfig = {
  baseUrl: "https://admin.example",
  apiKey: "svc-key",
  timeoutMs: 10_000,
  userAgent: "forge-mastra-agent-tools/1.0",
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const VIDEOS_BODY = {
  videos: [
    {
      videoId: "v1",
      title: "Easter",
      snippet: "Easter video.",
      slug: "easter",
      imageUrl: null,
    },
  ],
}

describe("searchVideosViaAdmin", () => {
  it("short-circuits to config_missing (base_url_missing) when the base URL is unset", async () => {
    const fetchImpl = vi.fn()
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      { config: { ...CONFIG, baseUrl: undefined }, fetchImpl },
    )
    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "base_url_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("short-circuits to config_missing (api_key_missing) when the key is unset", async () => {
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      { config: { ...CONFIG, apiKey: undefined }, fetchImpl: vi.fn() },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "config_missing",
      detail: "api_key_missing",
    })
  })

  it("returns ssrf_blocked (no fetch) when the base host is not in the allowlist", async () => {
    const fetchImpl = vi.fn()
    const result = await searchVideosViaAdmin(
      { q: "easter", locale: "en" },
      { config: { ...CONFIG, allowedHosts: "trusted.example" }, fetchImpl },
    )
    expect(result).toMatchObject({ ok: false, reason: "ssrf_blocked" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("proceeds when the base host IS in the allowlist", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VIDEOS_BODY))
    const result = await searchVideosViaAdmin(
      { q: "easter", locale: "en" },
      { config: { ...CONFIG, allowedHosts: "admin.example" }, fetchImpl },
    )
    expect(result).toMatchObject({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("posts to the search-videos endpoint with a Bearer and returns the parsed data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VIDEOS_BODY))
    const result = await searchVideosViaAdmin(
      { q: "easter", locale: "en", limit: 5 },
      { config: CONFIG, fetchImpl },
    )
    expect(result).toEqual({ ok: true, data: VIDEOS_BODY })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe(
      "https://admin.example/api/internal/agent-tools/search-videos",
    )
    expect((init as RequestInit).redirect).toBe("error")
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ authorization: "Bearer svc-key" })
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      q: "easter",
      locale: "en",
      limit: 5,
    })
  })

  it("maps 401/403 to auth_failed", async () => {
    for (const status of [401, 403]) {
      const result = await searchVideosViaAdmin(
        { q: "x", locale: "en" },
        {
          config: CONFIG,
          fetchImpl: vi.fn().mockResolvedValue(jsonResponse(status, {})),
        },
      )
      expect(result).toMatchObject({
        ok: false,
        reason: "auth_failed",
        retryable: false,
      })
    }
  })

  it("maps 429 to rate_limited (retryable)", async () => {
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(429, {})),
      },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
    })
  })

  it("maps 5xx to network_error (retryable) and 4xx to rejected (not retryable)", async () => {
    const five = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(503, {})),
      },
    )
    expect(five).toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
    const four = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(400, {})),
      },
    )
    expect(four).toMatchObject({
      ok: false,
      reason: "rejected",
      retryable: false,
    })
  })

  it("classifies a TimeoutError as timeout (retryable) and a generic throw as network_error", async () => {
    const timeout = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("timed out"), { name: "TimeoutError" }),
          ),
      },
    )
    expect(timeout).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
    const network = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      },
    )
    expect(network).toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("returns parse_error when a 200 body has the wrong shape", async () => {
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { wat: true })),
      },
    )
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
  })
})

describe("lookupBibleVerseViaAdmin", () => {
  it("posts to the lookup-bible-verse endpoint and returns parsed books", async () => {
    const body = {
      books: [
        {
          bookId: "b1",
          osisId: "John",
          displayName: "John",
          testament: "NT",
          order: 43,
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body))
    const result = await lookupBibleVerseViaAdmin(
      { query: "John" },
      { config: CONFIG, fetchImpl },
    )
    expect(result).toEqual({ ok: true, data: body })
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://admin.example/api/internal/agent-tools/lookup-bible-verse",
    )
  })
})

describe("fetchVideoImageViaAdmin", () => {
  it("posts to the fetch-video-image endpoint and returns parsed image", async () => {
    const body = {
      imageUrl: "https://cdn/hero.png",
      variant: "mobileCinematicHigh",
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body))
    const result = await fetchVideoImageViaAdmin(
      { videoId: "v1" },
      { config: CONFIG, fetchImpl },
    )
    expect(result).toEqual({ ok: true, data: body })
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://admin.example/api/internal/agent-tools/fetch-video-image",
    )
  })
})
