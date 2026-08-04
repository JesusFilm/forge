import { afterEach, describe, expect, it, vi } from "vitest"
import { TypesenseClient, TypesenseImportError } from "./typesense-client"

afterEach(() => vi.restoreAllMocks())

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("TypesenseClient", () => {
  it("normalizes the host and authenticates collection requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}))
    const client = new TypesenseClient({
      host: "http://localhost:8108/",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await client.upsertAlias("watch", "watch_123")

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8108/aliases/watch",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "x-typesense-api-key": "test-key",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ collection_name: "watch_123" }),
      }),
    )
  })

  it("treats a missing alias as absent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(client.getAlias("missing")).resolves.toBeUndefined()
  })

  it("lists physical collections for release cleanup", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([
        {
          name: "watch_search_transcripts_active",
          fields: [],
          num_documents: 280_107,
        },
      ]),
    )
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(client.listCollections()).resolves.toEqual([
      expect.objectContaining({
        name: "watch_search_transcripts_active",
        num_documents: 280_107,
      }),
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8108/collections",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-typesense-api-key": "test-key",
        }),
      }),
    )
  })

  it("checks every row in an HTTP-200 import response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        [
          JSON.stringify({ success: true }),
          JSON.stringify({
            success: false,
            error: "Field embedding must have 1536 dimensions",
          }),
        ].join("\n"),
      ),
    )
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.importDocuments("chunks", [{ id: "a" }, { id: "b" }]),
    ).rejects.toEqual(expect.any(TypesenseImportError))
  })

  it("surfaces a failed multi-search result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ results: [{ error: "bad filter", code: 400 }] }),
      )
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.multiSearch([{ collection: "watch", q: "communion" }]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it("turns aborts into bounded timeout errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          )
        }),
    )
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      timeoutMs: 5,
      fetch: fetchMock,
    })

    await expect(client.health()).rejects.toThrow("timed out after 5ms")
  })
})
