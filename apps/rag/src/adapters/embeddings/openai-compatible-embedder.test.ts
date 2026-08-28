import { afterEach, describe, expect, it, vi } from "vitest"

import { OpenAICompatibleEmbedder } from "./openai-compatible-embedder.js"

afterEach(() => vi.unstubAllGlobals())

describe("OpenAICompatibleEmbedder", () => {
  it("keeps blank inputs null and aligns out-of-order provider rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "test",
      model: "test/model",
      dimensions: 2,
      baseUrl: "https://embed.test/v1/",
    })

    await expect(embedder.embed(["alpha", " ", "beta"])).resolves.toEqual([
      [1, 0],
      null,
      [0, 1],
    ])
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(request.input).toEqual(["alpha", "beta"])
  })

  it("uses the query instruction and rejects dimension drift", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), {
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "test",
      model: "test/model",
      dimensions: 2,
      baseUrl: "https://embed.test/v1",
      queryInstruction: "retrieve passages",
    })

    await expect(embedder.embedQuery("hope")).rejects.toThrow(/expected 2/)
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(request.input).toEqual(["Instruct: retrieve passages\nQuery: hope"])
  })

  it("truncates wider responses and L2-normalizes the requested prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: [3, 4, 12] }],
          }),
          { status: 200 },
        ),
      ),
    )
    const embedder = new OpenAICompatibleEmbedder({
      apiKey: "test",
      model: "test/model",
      dimensions: 2,
      baseUrl: "https://embed.test/v1",
      truncateToDimensions: true,
    })

    await expect(embedder.embedQuery("hope")).resolves.toEqual([0.6, 0.8])
  })
})
