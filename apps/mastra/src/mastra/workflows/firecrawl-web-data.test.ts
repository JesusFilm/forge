import { describe, expect, it, vi } from "vitest"

import {
  handleFirecrawlWebDataRouteRequest,
  runFirecrawlWebDataWorkflow,
  _internal,
  type FirecrawlWebDataResult,
} from "./firecrawl-web-data"

describe("firecrawl web data workflow", () => {
  it("runs a search action through the tool executor", async () => {
    const search = vi.fn(async () => ({
      ok: true as const,
      query: "firecrawl mastra",
      creditsUsed: 1,
      results: [
        {
          title: "Firecrawl Docs",
          url: "https://docs.firecrawl.dev",
          description: "Docs",
          markdown: null,
          markdownTruncated: false,
        },
      ],
    }))

    const result = await runFirecrawlWebDataWorkflow(
      {
        action: "search",
        query: " firecrawl mastra ",
        limit: 2,
      },
      { runId: "run-search", search },
    )

    expect(search).toHaveBeenCalledWith({
      query: "firecrawl mastra",
      limit: 2,
      includeMarkdown: false,
    })
    expect(result).toEqual({
      ok: true,
      action: "search",
      mastraRunId: "run-search",
      search: {
        query: "firecrawl mastra",
        creditsUsed: 1,
        results: [
          {
            title: "Firecrawl Docs",
            url: "https://docs.firecrawl.dev",
            description: "Docs",
            markdown: null,
            markdownTruncated: false,
          },
        ],
      },
    })
  })

  it("runs a scrape action through the tool executor", async () => {
    const scrape = vi.fn(async () => ({
      ok: true as const,
      url: "https://www.firecrawl.dev",
      markdown: "# Firecrawl",
      markdownTruncated: false,
      title: "Firecrawl",
      description: "Web data API",
      statusCode: 200,
      contentType: "text/html",
    }))

    const result = await runFirecrawlWebDataWorkflow(
      {
        action: "scrape",
        url: "https://www.firecrawl.dev",
        onlyMainContent: false,
        timeoutMs: 5000,
      },
      { runId: "run-scrape", scrape },
    )

    expect(scrape).toHaveBeenCalledWith({
      url: "https://www.firecrawl.dev",
      onlyMainContent: false,
      timeoutMs: 5000,
    })
    expect(result).toEqual({
      ok: true,
      action: "scrape",
      mastraRunId: "run-scrape",
      scrape: {
        url: "https://www.firecrawl.dev",
        markdown: "# Firecrawl",
        markdownTruncated: false,
        title: "Firecrawl",
        description: "Web data API",
        statusCode: 200,
        contentType: "text/html",
      },
    })
  })

  it("rejects action-specific missing inputs before calling tools", async () => {
    const search = vi.fn()

    const result = await runFirecrawlWebDataWorkflow(
      { action: "search" },
      { search },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
    expect(search).not.toHaveBeenCalled()
  })

  it("maps Firecrawl failures into workflow failures", async () => {
    const result = await runFirecrawlWebDataWorkflow(
      {
        action: "scrape",
        url: "https://docs.firecrawl.dev",
      },
      {
        scrape: vi.fn(async () => ({
          ok: false as const,
          reason: "config_missing" as const,
          retryable: false,
        })),
      },
    )

    expect(result).toEqual({
      ok: false,
      action: "scrape",
      reason: "config_missing",
      retryable: false,
    })
  })

  it("requires service bearer auth on the service route", async () => {
    const outcome = await handleFirecrawlWebDataRouteRequest({
      authHeader: undefined,
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "search", query: "firecrawl" }),
    })

    expect(outcome).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
  })

  it("launches the workflow from a valid service route request", async () => {
    const result: FirecrawlWebDataResult = {
      ok: true,
      action: "search",
      mastraRunId: "run-route",
      search: {
        query: "firecrawl",
        creditsUsed: null,
        results: [],
      },
    }
    const launch = vi.fn(async () => result)

    const outcome = await handleFirecrawlWebDataRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "search", query: "firecrawl" }),
      launch,
    })

    expect(outcome).toEqual({ status: 200, body: { result } })
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ action: "search", query: "firecrawl" }),
      { runId: expect.any(String) },
    )
  })

  it("maps invalid route input and upstream rate limits to route statuses", async () => {
    const invalidJson = await handleFirecrawlWebDataRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => {
        throw new Error("invalid json")
      },
    })
    expect(invalidJson).toEqual({
      status: 400,
      body: {
        result: {
          ok: false,
          reason: "invalid_input",
          retryable: false,
        },
        error: "Invalid JSON",
      },
    })

    const invalid = await handleFirecrawlWebDataRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "search" }),
    })
    expect(invalid.status).toBe(400)
    expect(invalid.body.result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })

    const rateLimited = await handleFirecrawlWebDataRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "search", query: "firecrawl" }),
      launch: vi.fn(async () => ({
        ok: false as const,
        action: "search" as const,
        reason: "rate_limited" as const,
        retryable: true,
        status: 429,
      })),
    })
    expect(rateLimited.status).toBe(429)
  })

  it("extracts workflow failures from wrapped Mastra run errors", () => {
    const failure: FirecrawlWebDataResult = {
      ok: false,
      action: "scrape",
      reason: "auth_failed",
      retryable: false,
      status: 401,
    }
    const wrapped = new Error(
      `Step failed: FIRECRAWL_WEB_DATA_WORKFLOW_FAILED:${JSON.stringify(
        failure,
      )}`,
    )

    expect(_internal.workflowFailureFromUnknown(wrapped)).toEqual(failure)
    expect(_internal.workflowFailureFromRunResult({ error: wrapped })).toEqual(
      failure,
    )
  })
})
