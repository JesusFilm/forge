import { describe, expect, it, vi } from "vitest"

import {
  FirecrawlSearchError,
  requestFirecrawlSearch,
} from "./firecrawl-search-client"

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

const noopSleep = async () => {}

describe("requestFirecrawlSearch", () => {
  it("returns normalized hits and tolerates unknown fields", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({
        success: true,
        data: [
          {
            url: "https://www.instagram.com/reel/ABC123/",
            title: "Someone on Instagram",
            description: "AI generated Jesus reel",
            metadata: { "og:image": "https://img.example/p.jpg" },
            unknownField: "ignored",
          },
        ],
        warning: "ignored-too",
      }),
    )

    const hits = await requestFirecrawlSearch("query", {
      apiKey: "fc-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noopSleep,
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]).toEqual({
      url: "https://www.instagram.com/reel/ABC123/",
      title: "Someone on Instagram",
      description: "AI generated Jesus reel",
      markdown: undefined,
      metadata: { "og:image": "https://img.example/p.jpg" },
    })

    const [endpoint, requestInit] = fetchImpl.mock.calls[0]!
    expect(String(endpoint)).toBe("https://api.firecrawl.dev/v1/search")
    expect(requestInit!.method).toBe("POST")
  })

  it("includes scrapeOptions only when scrape is requested", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({ data: [] }),
    )

    await requestFirecrawlSearch("q", {
      apiKey: "fc-key",
      scrape: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noopSleep,
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))
    expect(body.scrapeOptions).toEqual({
      formats: ["markdown"],
      onlyMainContent: true,
    })
  })

  it("truncates returned markdown when a caller supplies a cap", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ url: "https://example.com", markdown: "abcdefgh" }],
      }),
    )
    const hits = await requestFirecrawlSearch("q", {
      apiKey: "fc-key",
      maxMarkdownCharacters: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(hits[0]!.markdown).toBe("abc")
  })

  it("throws config_missing before any fetch when apiKey is absent", async () => {
    const fetchImpl = vi.fn()
    await expect(
      requestFirecrawlSearch("q", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "FirecrawlSearchError",
      code: "config_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps 401 to a non-retryable auth_failed error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "nope" }, { status: 401 }),
    )

    await expect(
      requestFirecrawlSearch("q", {
        apiKey: "fc-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({ code: "auth_failed", retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps 403 to a non-retryable auth_failed error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "forbidden" }, { status: 403 }),
    )

    await expect(
      requestFirecrawlSearch("q", {
        apiKey: "fc-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({ code: "auth_failed", retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("retries 500 then throws upstream_failed after max attempts", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "boom" }, { status: 500 }),
    )

    await expect(
      requestFirecrawlSearch("q", {
        apiKey: "fc-key",
        maxAttempts: 3,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({ code: "upstream_failed", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("omits scrapeOptions when scrape is not requested", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({ data: [] }),
    )

    await requestFirecrawlSearch("q", {
      apiKey: "fc-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noopSleep,
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))
    expect("scrapeOptions" in body).toBe(false)
  })

  it("retries 429 then throws rate_limited after max attempts", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "slow down" }, { status: 429 }),
    )

    const error = await requestFirecrawlSearch("q", {
      apiKey: "fc-key",
      maxAttempts: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noopSleep,
    }).catch((cause) => cause)

    expect(error).toBeInstanceOf(FirecrawlSearchError)
    expect(error).toMatchObject({ code: "rate_limited", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("retries 500 responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ url: "https://x.test" }] }),
      )

    const hits = await requestFirecrawlSearch("q", {
      apiKey: "fc-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noopSleep,
    })

    expect(hits).toEqual([
      {
        url: "https://x.test",
        title: undefined,
        description: undefined,
        markdown: undefined,
        metadata: undefined,
      },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("throws invalid_response when data is missing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }))

    await expect(
      requestFirecrawlSearch("q", {
        apiKey: "fc-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("retries transport errors then throws upstream_failed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down")
    })

    await expect(
      requestFirecrawlSearch("q", {
        apiKey: "fc-key",
        maxAttempts: 2,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({ code: "upstream_failed", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
