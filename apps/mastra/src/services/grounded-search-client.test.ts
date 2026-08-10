import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../config/seo"
import { searchGroundedWeb } from "./grounded-search-client"

const config = getSeoConfig({
  SEO_OPENAI_API_KEY: "test-key",
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
})
