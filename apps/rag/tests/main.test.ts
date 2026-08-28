import { afterEach, describe, expect, it, vi } from "vitest"

import { wire } from "../src/main.js"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("wire", () => {
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
