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

  it("upserts lightweight documents and deletes stale documents by filter", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(jsonResponse({ num_deleted: 3 }))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await client.importDocuments(
      "watch_search_transcripts_active",
      [{ id: "video:1" }],
      "upsert",
    )
    await client.deleteDocumentsByFilter(
      "watch_search_transcripts_active",
      "documentKind:=video && catalogGeneration:!=build",
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8108/collections/watch_search_transcripts_active/documents/import?action=upsert",
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8108/collections/watch_search_transcripts_active/documents?filter_by=documentKind%3A%3Dvideo%20%26%26%20catalogGeneration%3A!%3Dbuild",
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("partially updates documents selected by a filter", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ num_updated: 12 }))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.updateDocumentsByFilter(
        "watch_search_transcripts_active",
        "documentKind:=transcript && videoId:=`video-1`",
        { titles: ["Renamed title"] },
      ),
    ).resolves.toBe(12)

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8108/collections/watch_search_transcripts_active/documents?filter_by=documentKind%3A%3Dtranscript%20%26%26%20videoId%3A%3D%60video-1%60",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
        body: JSON.stringify({ titles: ["Renamed title"] }),
      }),
    )
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

  it("preserves grouped search hits for video-level retrieval", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        results: [
          {
            found: 1,
            out_of: 2,
            page: 1,
            search_time_ms: 3,
            grouped_hits: [
              {
                group_key: ["video-1"],
                found: 2,
                hits: [{ document: { id: "chunk-1" } }],
              },
            ],
          },
        ],
      }),
    )
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    const [result] = await client.multiSearch<{ id: string }>([
      {
        collection: "watch_search_hybrid",
        q: "communion",
        group_by: "canonicalVideoId",
        group_limit: 1,
      },
    ])

    expect(result?.grouped_hits?.[0]).toMatchObject({
      group_key: ["video-1"],
      found: 2,
      hits: [{ document: { id: "chunk-1" } }],
    })
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
