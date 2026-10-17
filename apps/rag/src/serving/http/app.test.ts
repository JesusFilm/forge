import { describe, expect, it, vi } from "vitest"

import type { RankedResult, RetrievalPolicy } from "@forge/rag-contracts"

import type { Retriever } from "../../contracts/index.js"
import { createApp } from "./app.js"

const SAMPLE: RankedResult = {
  chunkId: "chunk-1",
  score: 0.81,
  text: "Pray like this…",
  ord: 0,
  tags: ["topic:prayer"],
  citation: {
    sourceKey: "jesusfilm-org",
    sourceName: "Jesus Film",
    title: "How to pray",
    url: "https://example.org/pray",
  },
}

function spyRetriever(results: RankedResult[] = [SAMPLE]) {
  const calls: Array<{ query: string; policy?: RetrievalPolicy }> = []
  const retriever: Retriever = {
    search: async (query, policy) => {
      calls.push({ query, policy })
      return results
    },
  }
  return { retriever, calls }
}

const consumerAuth = {
  authenticate: async (secret: string) => {
    if (secret === "rag_scoped")
      return {
        consumerId: "scoped-consumer",
        allowedSourceKeys: ["jesusfilm-org"],
      }
    if (secret === "rag_multi")
      return {
        consumerId: "multi-consumer",
        allowedSourceKeys: ["jesusfilm-org", "other-source"],
      }
    return null
  },
}

function searchRequest(
  body: unknown,
  token?: string,
  headers: Record<string, string> = {},
): Request {
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    ...headers,
  }
  if (token) requestHeaders.authorization = `Bearer ${token}`
  return new Request("http://local/v1/search", {
    method: "POST",
    headers: requestHeaders,
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("GET /v1/health", () => {
  it("returns the public health contract without authentication", async () => {
    const response = await createApp({
      retriever: spyRetriever().retriever,
      consumerAuth,
    }).request("/v1/health")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })
})

describe("POST /v1/search", () => {
  it("accepts registered identity and denies a legacy static token", async () => {
    const { retriever, calls } = spyRetriever()
    const app = createApp({ retriever, consumerAuth })
    const accepted = await app.request(
      searchRequest({ query: "hope" }, "rag_scoped"),
    )
    expect(accepted.status).toBe(200)
    expect(calls[0]?.policy?.allowedSourceKeys).toEqual(["jesusfilm-org"])
    const denied = await app.request(
      searchRequest({ query: "hope" }, "retired-static-token"),
    )
    expect(denied.status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it("fails closed when registered authentication storage is unavailable", async () => {
    const { retriever, calls } = spyRetriever()
    const response = await createApp({
      retriever,
      consumerAuth: {
        authenticate: async () => {
          throw new Error("synthetic-storage-detail")
        },
      },
    }).request(searchRequest({ query: "hope" }, "rag_scoped"))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "auth_unavailable" })
    expect(calls).toHaveLength(0)
  })

  it.each([undefined, "unknown-token"])(
    "rejects missing or unknown bearer credentials",
    async (token) => {
      const { retriever, calls } = spyRetriever()
      const response = await createApp({ retriever, consumerAuth }).request(
        searchRequest({ query: "how to pray" }, token),
      )

      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe("Bearer")
      expect(await response.json()).toEqual({ error: "unauthorized" })
      expect(calls).toHaveLength(0)
    },
  )

  it("validates JSON and the strict published request contract", async () => {
    const app = createApp({ retriever: spyRetriever().retriever, consumerAuth })

    const malformed = await app.request(searchRequest("{not json", "rag_multi"))
    const unknownField = await app.request(
      searchRequest(
        { query: "hope", policy: { audience: "seeker" } },
        "rag_multi",
      ),
    )

    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: "invalid_json" })
    expect(unknownField.status).toBe(400)
    expect(await unknownField.json()).toMatchObject({
      error: "invalid_request",
      issues: expect.any(Array),
    })
  })

  it("rejects an oversized body before retrieval", async () => {
    const { retriever, calls } = spyRetriever()
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const response = await createApp({ retriever, consumerAuth }).request(
      searchRequest({ query: "x".repeat(20_000) }, "rag_multi"),
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "payload_too_large" })
    expect(calls).toHaveLength(0)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it("rejects a declared oversized body before reading it", async () => {
    const { retriever, calls } = spyRetriever()
    const response = await createApp({ retriever, consumerAuth }).request(
      searchRequest({ query: "hope" }, "rag_multi", {
        "content-length": "20000",
      }),
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "payload_too_large" })
    expect(calls).toHaveLength(0)
  })

  it("passes a scoped token's source restriction to retrieval", async () => {
    const { retriever, calls } = spyRetriever()
    const response = await createApp({ retriever, consumerAuth }).request(
      searchRequest({ query: "hope" }, "rag_scoped"),
    )

    expect(response.status).toBe(200)
    expect(calls[0]?.policy?.allowedSourceKeys).toEqual(["jesusfilm-org"])
    expect(await response.json()).toEqual({ results: [SAMPLE] })
  })

  it("allows request scope to narrow but never widen token scope", async () => {
    const { retriever, calls } = spyRetriever()
    const response = await createApp({ retriever, consumerAuth }).request(
      searchRequest(
        { query: "hope", policy: { allowedSourceKeys: ["other-source"] } },
        "rag_scoped",
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [] })
    expect(calls).toHaveLength(0)
  })

  it("allows a multi-source consumer to narrow to requested sources", async () => {
    const { retriever, calls } = spyRetriever()
    const response = await createApp({ retriever, consumerAuth }).request(
      searchRequest(
        { query: "hope", policy: { allowedSourceKeys: ["jesusfilm-org"] } },
        "rag_multi",
      ),
    )

    expect(response.status).toBe(200)
    expect(calls[0]?.policy?.allowedSourceKeys).toEqual(["jesusfilm-org"])
  })

  it("returns a valid empty result for an empty corpus", async () => {
    const response = await createApp({
      retriever: spyRetriever([]).retriever,
      consumerAuth,
    }).request(searchRequest({ query: "hope" }, "rag_multi"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [] })
  })

  it("maps retrieval failures to a JSON 500 without leaking details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const retriever: Retriever = {
      search: async () => {
        throw new Error("sentinel-sensitive-database-detail")
      },
    }

    const response = await createApp({ retriever, consumerAuth }).request(
      searchRequest({ query: "hope" }, "rag_multi"),
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "internal" })
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls.flat()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "sentinel-sensitive-database-detail",
        }),
      ]),
    )
    log.mockRestore()
  })
})
