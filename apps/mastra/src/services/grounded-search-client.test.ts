import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../config/seo"
import { searchGroundedWeb } from "./grounded-search-client"

const config = getSeoConfig({
  OPENROUTER_API_PAID_KEY: "paid-test-key",
  SEO_MAX_PROVIDER_ATTEMPTS: "1",
})

describe("searchGroundedWeb", () => {
  it("projects multiple output items, current queries, citations, and full sources without fetching citations", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "web_search_call",
            action: {
              queries: ["current query", "second query"],
              sources: [
                { url: "https://source.example/a?token=signed", title: "A" },
              ],
            },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Observed summary",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://citation.example/b#fragment",
                    title: "B",
                  },
                  {
                    type: "url_citation",
                    url: "http://127.0.0.1/private",
                    title: "unsafe",
                  },
                ],
              },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch
    const result = await searchGroundedWeb({
      query: "search intent",
      canonicalUrl: "https://example.com/watch?a=signed",
      locale: "en",
      config,
      fetchImpl,
      observationId: "grounded-test",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.observation.data.queries).toEqual([
      "current query",
      "second query",
    ])
    expect(result.observation.sources).toEqual([
      { url: "https://source.example/a", title: "A" },
      { url: "https://citation.example/b", title: "B" },
    ])
    expect(result.observation.scope.canonicalUrl).toBe(
      "https://example.com/watch",
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toBe("https://openrouter.ai/api/v1/responses")
    expect(request).toMatchObject({
      headers: expect.objectContaining({
        authorization: "Bearer paid-test-key",
      }),
    })
    const body = JSON.parse(String(request?.body))
    expect(body).toMatchObject({
      model: "openai/gpt-5.4-mini",
      max_tool_calls: 1,
      tools: [
        {
          type: "openrouter:web_search",
          parameters: {
            engine: "auto",
            max_results: 5,
            max_uses: 1,
            max_total_results: 5,
            search_context_size: "low",
          },
        },
      ],
    })
    expect(body).not.toHaveProperty("include")
  })

  it("marks a refusal and missing web search call as partial", async () => {
    const result = await searchGroundedWeb({
      query: "query",
      config,
      fetchImpl: vi.fn(async () =>
        Response.json({
          status: "incomplete",
          output: [
            { type: "message", content: [{ type: "refusal", refusal: "No." }] },
          ],
        }),
      ) as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.observation.status).toBe("partial")
    expect(result.observation.quality.caveats.join(" ")).toContain(
      "no web_search_call",
    )
  })

  it("retains the bounded direct OpenAI fallback", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: "completed",
        output: [{ type: "web_search_call", action: { sources: [] } }],
      }),
    ) as unknown as typeof fetch
    const directConfig = getSeoConfig({
      SEO_OPENAI_API_KEY: "direct-test-key",
      SEO_MAX_PROVIDER_ATTEMPTS: "1",
    })

    await expect(
      searchGroundedWeb({ query: "query", config: directConfig, fetchImpl }),
    ).resolves.toMatchObject({ ok: true })

    const [url, request] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toBe("https://api.openai.com/v1/responses")
    expect(request).toMatchObject({
      headers: expect.objectContaining({
        authorization: "Bearer direct-test-key",
      }),
    })
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "gpt-5.4-mini",
      include: ["web_search_call.action.sources"],
      tools: [{ type: "web_search" }],
    })
  })
})
