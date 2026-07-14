import { describe, expect, it, vi } from "vitest"

import {
  executeFirecrawlScrapeTool,
  executeFirecrawlSearchTool,
  firecrawlScrapeToolInputSchema,
  firecrawlSearchToolInputSchema,
} from "./firecrawl"

describe("Firecrawl Mastra tools", () => {
  it("searches through the Firecrawl client with bounded tool input", async () => {
    const search = vi.fn(async () => ({
      ok: true as const,
      result: {
        query: "mastra firecrawl",
        creditsUsed: 2,
        results: [
          {
            title: "Firecrawl",
            url: "https://www.firecrawl.dev",
            description: "Web data API",
            markdown: null,
            markdownTruncated: false,
            metadata: { "og:image": "https://example.com/image.jpg" },
          },
        ],
      },
    }))

    const result = await executeFirecrawlSearchTool(
      {
        query: "  mastra firecrawl  ",
        limit: 3,
        includeMarkdown: true,
      },
      { search },
    )

    expect(search).toHaveBeenCalledWith({
      query: "mastra firecrawl",
      limit: 3,
      includeMarkdown: true,
    })
    expect(result).toEqual({
      ok: true,
      query: "mastra firecrawl",
      creditsUsed: 2,
      results: [
        {
          title: "Firecrawl",
          url: "https://www.firecrawl.dev",
          description: "Web data API",
          markdown: null,
          markdownTruncated: false,
        },
      ],
    })
  })

  it("scrapes a known URL through the Firecrawl client", async () => {
    const scrape = vi.fn(async () => ({
      ok: true as const,
      result: {
        url: "https://docs.firecrawl.dev",
        markdown: "# Docs",
        markdownTruncated: false,
        title: "Docs",
        description: null,
        statusCode: 200,
        contentType: "text/html",
      },
    }))

    const result = await executeFirecrawlScrapeTool(
      {
        url: "https://docs.firecrawl.dev",
        onlyMainContent: false,
        timeoutMs: 5000,
      },
      { scrape },
    )

    expect(scrape).toHaveBeenCalledWith({
      url: "https://docs.firecrawl.dev",
      onlyMainContent: false,
      timeoutMs: 5000,
    })
    expect(result).toEqual({
      ok: true,
      url: "https://docs.firecrawl.dev",
      markdown: "# Docs",
      markdownTruncated: false,
      title: "Docs",
      description: null,
      statusCode: 200,
      contentType: "text/html",
    })
  })

  it("returns safe client failures for agent context", async () => {
    const result = await executeFirecrawlSearchTool(
      { query: "news" },
      {
        search: vi.fn(async () => ({
          ok: false as const,
          reason: "rate_limited" as const,
          retryable: true,
          status: 429,
          upstreamReason: "plan limit reached",
        })),
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status: 429,
      upstreamReason: "plan limit reached",
    })
  })

  it("validates user-facing search and scrape input", () => {
    expect(
      firecrawlSearchToolInputSchema.safeParse({ query: "" }).success,
    ).toBe(false)
    expect(
      firecrawlScrapeToolInputSchema.safeParse({ url: "not-a-url" }).success,
    ).toBe(false)
  })
})
