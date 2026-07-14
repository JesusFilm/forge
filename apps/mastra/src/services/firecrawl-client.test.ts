import { describe, expect, it, vi } from "vitest"

import {
  scrapeFirecrawl,
  searchFirecrawl,
  type FirecrawlConfig,
} from "./firecrawl-client"

const testConfig: FirecrawlConfig = {
  apiKey: "firecrawl-key",
  apiUrl: "https://api.firecrawl.dev",
  timeoutMs: 60_000,
  userAgent: "forge-test-firecrawl/1.0",
  maxSearchResults: 2,
  maxMarkdownCharacters: 12,
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    }),
  )
}

describe("Firecrawl client", () => {
  it("searches with bounded limits and truncates hydrated markdown", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({
        success: true,
        data: {
          web: [
            {
              title: "One",
              description: "First result",
              url: "https://example.com/one",
              markdown: "abcdefghijklmnop",
              metadata: {
                "og:image": "https://example.com/thumbnail.jpg",
              },
            },
            {
              title: "Two",
              description: null,
              url: "https://example.com/two",
            },
            {
              title: "Three",
              description: "Third result",
              url: "https://example.com/three",
            },
          ],
        },
        creditsUsed: 3,
      }),
    )

    const result = await searchFirecrawl({
      query: "firecrawl mastra",
      limit: 10,
      includeMarkdown: true,
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      result: {
        query: "firecrawl mastra",
        creditsUsed: 3,
        results: [
          {
            title: "One",
            description: "First result",
            url: "https://example.com/one",
            markdown: "abcdefghi...",
            markdownTruncated: true,
            metadata: {
              "og:image": "https://example.com/thumbnail.jpg",
            },
          },
          {
            title: "Two",
            description: null,
            url: "https://example.com/two",
            markdown: null,
            markdownTruncated: false,
            metadata: null,
          },
        ],
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.firecrawl.dev/v2/search"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer firecrawl-key",
          "user-agent": "forge-test-firecrawl/1.0",
        }),
        body: JSON.stringify({
          query: "firecrawl mastra",
          limit: 2,
          sources: ["web"],
          timeout: 60_000,
          ignoreInvalidURLs: true,
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: true,
            timeout: 60_000,
          },
        }),
      }),
    )
  })

  it("scrapes a known URL into bounded markdown and safe metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({
        success: true,
        data: {
          markdown: "long page markdown",
          metadata: {
            title: "Example",
            description: "Example description",
            sourceURL: "https://example.com/source",
            statusCode: 200,
            contentType: "text/html",
          },
        },
      }),
    )

    const result = await scrapeFirecrawl({
      url: "https://example.com",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      result: {
        url: "https://example.com/source",
        markdown: "long page...",
        markdownTruncated: true,
        title: "Example",
        description: "Example description",
        statusCode: 200,
        contentType: "text/html",
      },
    })
  })

  it("returns config_missing without making a request when the key is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await searchFirecrawl({
      query: "firecrawl",
      config: { ...testConfig, apiKey: undefined },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("retries rate limits using retry-after before returning success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() =>
        jsonResponse(
          { error: "rate limited" },
          { status: 429, headers: { "retry-after": "1" } },
        ),
      )
      .mockImplementationOnce(() =>
        jsonResponse({ success: true, data: { web: [] }, creditsUsed: 1 }),
      )
    const sleep = vi.fn(async () => {})

    const result = await searchFirecrawl({
      query: "firecrawl",
      config: testConfig,
      fetchImpl,
      sleep,
    })

    expect(result).toEqual({
      ok: true,
      result: { query: "firecrawl", results: [], creditsUsed: 1 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it("returns retryable network_error when 5xx retries are exhausted", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "upstream down" }, { status: 503 }),
    )
    const sleep = vi.fn(async () => {})

    const result = await scrapeFirecrawl({
      url: "https://example.com",
      config: testConfig,
      fetchImpl,
      maxAttempts: 2,
      sleep,
    })

    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      status: 503,
      upstreamReason: "upstream down",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500)
  })

  it("does not retry credential failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "bad key" }, { status: 401 }),
    )

    const result = await scrapeFirecrawl({
      url: "https://example.com",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
      upstreamReason: "bad key",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("keeps tiny markdown caps exact", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({
        success: true,
        data: {
          markdown: "abcdef",
          metadata: {
            sourceURL: "https://example.com",
          },
        },
      }),
    )

    const result = await scrapeFirecrawl({
      url: "https://example.com",
      config: { ...testConfig, maxMarkdownCharacters: 2 },
      fetchImpl,
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        markdown: "..",
        markdownTruncated: true,
      },
    })
  })

  it("maps invalid JSON to a retryable parse failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await searchFirecrawl({
      query: "firecrawl",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: 200,
    })
  })
})
