import { afterEach, describe, expect, it, vi } from "vitest"

import { wire } from "../src/main.js"
import type { SourceEntry } from "../src/registry/index.js"

const source = (fetchStrategy?: "plain-http" | "firecrawl"): SourceEntry => ({
  key: fetchStrategy ?? "default",
  name: "Test",
  domain: "example.test",
  trust: "trusted",
  ingestionMode: "html-scrape",
  languages: ["en"],
  defaultTags: [],
  defaultCategory: null,
  rights: null,
  crawl: {
    baseUrl: "https://example.test",
    fetchStrategy,
    contentSelectors: ["main"],
    stripSelectors: [],
    requestDelayMs: 0,
    maxPages: 1,
    minContentLength: 1,
  },
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("wire", () => {
  it("selects fetchers only from registry strategy and requires Firecrawl lazily", async () => {
    const wiring = wire({
      DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
      OPENROUTER_API_KEY: "openrouter-key",
    })

    expect(wiring.fetcherFor(source())).toBe(
      wiring.fetcherFor(source("plain-http")),
    )
    expect(() => wiring.fetcherFor(source("firecrawl"))).toThrow(
      /FIRECRAWL_API_KEY/,
    )
    await wiring.shutdown()
  })

  it("keeps corpus embedding patient and query embedding fast while preserving model identity", async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { input: string[] }
        seen.push(body.input[0])
        if (seen.filter((value) => value === "document").length < 3) {
          return new Response(null, { status: 503, statusText: "Unavailable" })
        }
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: new Array(1536).fill(0.5) }],
          }),
          { status: 200 },
        )
      }),
    )
    const wiring = wire({
      DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
      OPENROUTER_API_KEY: "openrouter-key",
      EMBED_MODEL_ID: "canonical-model",
      EMBED_MAX_ATTEMPTS: "3",
      QUERY_EMBED_MAX_ATTEMPTS: "1",
    })

    const result = wiring.embedder.embed(["document"])
    const expectation = expect(result).resolves.toHaveLength(1)
    await vi.runAllTimersAsync()
    await expectation
    expect(wiring.embedder.model).toBe("canonical-model")
    expect(wiring.queryEmbedder.model).toBe("canonical-model")
    expect(seen).toEqual(["document", "document", "document"])
    await wiring.shutdown()
  })

  it("falls back to OpenRouter after transient gateway attempts are exhausted", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const seen: Array<{ url: string; authorization: string; model: string }> =
      []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { model: string }
        const headers = init.headers as Record<string, string>
        seen.push({
          url,
          authorization: headers.authorization,
          model: body.model,
        })
        if (url === "https://gateway.test/v1/embeddings") {
          return new Response(null, { status: 503, statusText: "Unavailable" })
        }
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: new Array(1536).fill(0.5) }],
          }),
          { status: 200 },
        )
      }),
    )
    const wiring = wire({
      DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
      OPENROUTER_API_KEY: "openrouter-key",
      EMBED_BASE_URL: "https://gateway.test/v1",
      EMBED_API_KEY: "gateway-key",
      EMBED_WIRE_MODEL_ID: "gateway-model",
      EMBED_MODEL_ID: "canonical-model",
      QUERY_EMBED_MAX_ATTEMPTS: "2",
    })

    const result = wiring.queryEmbedder.embedQuery("hope")
    const expectation = expect(result).resolves.toHaveLength(1536)
    await vi.runAllTimersAsync()

    await expectation
    expect(wiring.queryEmbedder.model).toBe("canonical-model")
    expect(seen).toEqual([
      {
        url: "https://gateway.test/v1/embeddings",
        authorization: "Bearer gateway-key",
        model: "gateway-model",
      },
      {
        url: "https://gateway.test/v1/embeddings",
        authorization: "Bearer gateway-key",
        model: "gateway-model",
      },
      {
        url: "https://openrouter.ai/api/v1/embeddings",
        authorization: "Bearer openrouter-key",
        model: "canonical-model",
      },
    ])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      "query embed: gateway failed (embeddings failed: 503 Unavailable); falling back to hosted OpenRouter",
    )
    await wiring.shutdown()
  })
})
