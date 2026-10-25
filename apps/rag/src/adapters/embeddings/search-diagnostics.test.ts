import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../../serving/http/app.js"
import { createRetriever } from "../../retrieval/index.js"
import { OpenAICompatibleEmbedder } from "../../adapters/embeddings/index.js"
const secret = "injected-private-query-bearer-url-sql"
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function search(storeFailure?: "model_check" | "vector_search") {
  const embedder = new OpenAICompatibleEmbedder({
    apiKey: "fixture-key",
    model: "fixture/model",
    dimensions: 2,
    baseUrl: "https://fixture.invalid",
    timeoutMs: 4000,
    maxAttempts: 2,
  })
  const fail = () => {
    throw Object.assign(new Error(secret), {
      name: secret,
      code: "P1001",
      meta: { sql: secret },
      cause: new Error(secret),
    })
  }
  return createRetriever({
    embedder,
    search: {
      embeddingModels: async () =>
        storeFailure === "model_check" ? fail() : ["fixture/model"],
      vectorSearch: async () =>
        storeFailure === "vector_search" ? fail() : [],
      fetchDocumentTexts: async () => new Map(),
      fetchById: async () => null,
    },
  })
}
async function request(retriever: ReturnType<typeof search>) {
  return createApp({
    retriever,
    consumerAuth: {
      authenticate: async (token) =>
        token === "rag_fixture"
          ? { consumerId: "fixture", allowedSourceKeys: ["fixture-source"] }
          : null,
    },
  }).request("/v1/search", {
    method: "POST",
    headers: {
      authorization: "Bearer rag_fixture",
      "content-type": "application/json",
      "x-rag-request-id": secret,
    },
    body: JSON.stringify({ query: secret, policy: { topK: 3 } }),
  })
}
function check(
  response: Response,
  logs: ReturnType<typeof vi.spyOn>,
  stage: string,
  category: string,
  detail: string,
) {
  const id = response.headers.get("x-rag-request-id")
  expect(id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  const output = logs.mock.calls.flat().join(" ")
  expect(output).toContain("request_id=" + id)
  expect(output).toContain("stage=" + stage)
  expect(output).toContain("category=" + category)
  expect(output).toContain("detail=" + detail)
  expect(output).not.toContain(secret)
  expect(response.status).toBe(500)
}
describe("safe real search failure diagnostics", () => {
  it("classifies the actual two-attempt 8.25s query abort pattern without leaking error data", async () => {
    vi.useFakeTimers()
    const logs = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetcher = vi.fn(
      (_url: unknown, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          options.signal!.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error(secret), {
                  name: "AbortError",
                  cause: new Error(secret),
                }),
              ),
            { once: true },
          ),
        ),
    )
    vi.stubGlobal("fetch", fetcher)
    const start = Date.now()
    const pending = request(search())
    await vi.runAllTimersAsync()
    const response = await pending
    expect(Date.now() - start).toBe(8250)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await response.json()).toEqual({ error: "internal" })
    check(response, logs, "embedding", "transport", "abort")
  })
  it.each(["model_check", "vector_search"] as const)(
    "classifies %s Prisma codes and hides arbitrary exception names",
    async (stage) => {
      const logs = vi.spyOn(console, "error").mockImplementation(() => {})
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ data: [{ index: 0, embedding: [0, 1] }] }),
            ),
        ),
      )
      const response = await request(search(stage))
      expect(await response.json()).toEqual({ error: "internal" })
      check(response, logs, stage, "database", "P1001")
    },
  )
  it("classifies provider HTTP failure while preserving two retries", async () => {
    vi.useFakeTimers()
    const logs = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetcher = vi.fn(
      async () => new Response(secret, { status: 503, statusText: secret }),
    )
    vi.stubGlobal("fetch", fetcher)
    const pending = request(search())
    await vi.runAllTimersAsync()
    const response = await pending
    expect(fetcher).toHaveBeenCalledTimes(2)
    check(response, logs, "embedding", "provider", "http_503")
  })
  it("classifies network failures without serializing their messages", async () => {
    vi.useFakeTimers()
    const logs = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(secret)
      }),
    )
    const pending = request(search())
    await vi.runAllTimersAsync()
    check(await pending, logs, "embedding", "transport", "network")
  })
  it("classifies response contract failures without logging result content", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {})
    const retriever = {
      search: async () => [
        {
          chunkId: "fixture",
          score: NaN,
          text: secret,
          ord: 0,
          tags: [],
          citation: {
            sourceKey: "fixture",
            sourceName: secret,
            title: secret,
            url: "https://fixture.invalid",
          },
        },
      ],
    }
    const response = await request(retriever)
    check(response, logs, "response_contract", "contract", "invalid_response")
  })
  it("keeps unknown failures bounded and server-generated IDs independent", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {})
    const retriever = {
      search: async () => {
        throw Object.assign(new Error(secret), { name: secret, code: secret })
      },
    }
    const first = await request(retriever)
    const second = await request(retriever)
    check(first, logs, "http", "unknown", "unclassified")
    expect(second.headers.get("x-rag-request-id")).not.toBe(
      first.headers.get("x-rag-request-id"),
    )
  })
})
