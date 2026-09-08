import { afterEach, describe, expect, it, vi } from "vitest"
import {
  TypesenseClient,
  TypesenseImportError,
  TypesenseImportResponseError,
} from "./typesense-client"

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
        redirect: "error",
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

  it("owns versioned curation sets through the Typesense v30 API", async () => {
    const set = {
      items: [
        {
          id: "rescue-project",
          rule: { query: "rescue project", match: "exact" as const },
          includes: [{ id: "intro:slug:english", position: 1 }],
        },
      ],
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(set))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "operator-key",
      fetch: fetchMock,
    })

    await expect(
      client.upsertCurationSet("watch_search_curations_build-7", set),
    ).resolves.toEqual(set)
    await expect(
      client.deleteCurationSet("watch_search_curations_retired"),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8108/curation_sets/watch_search_curations_build-7",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-typesense-api-key": "operator-key",
        }),
        body: JSON.stringify(set),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8108/curation_sets/watch_search_curations_retired",
      expect.objectContaining({ method: "DELETE" }),
    )
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

  it("fetches one exact physical collection schema for publication validation", async () => {
    const schema = {
      name: "watch_candidate_catalog_generation_1",
      fields: [
        { name: "id", type: "string" },
        { name: "titles", type: "string[]", locale: "zh" },
      ],
      num_documents: 1_070,
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(schema))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.getCollectionSchema("watch_candidate_catalog_generation_1"),
    ).resolves.toEqual(schema)
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8108/collections/watch_candidate_catalog_generation_1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-typesense-api-key": "test-key",
        }),
      }),
    )
  })

  it("normalizes collection-schema HTTP failures without treating 404 as absent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("missing collection", { status: 404 }))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.getCollectionSchema("missing_candidate_collection"),
    ).rejects.toMatchObject(
      expect.objectContaining({
        name: "TypesenseRequestError",
        status: 404,
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

  it("rejects a mismatched Typesense import line count", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: true })))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.importDocuments("chunks", [{ id: "a" }, { id: "b" }]),
    ).rejects.toEqual(expect.any(TypesenseImportResponseError))
  })

  it("rejects import rows whose success marker is not the boolean true", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: "true" })))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.importDocuments("chunks", [{ id: "a" }]),
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

  it("reads one exact document and treats a missing document as absent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "chunk-1", text: "hope" }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const client = new TypesenseClient({
      host: "http://localhost:8108",
      apiKey: "test-key",
      fetch: fetchMock,
    })

    await expect(
      client.getDocument<{ id: string; text: string }>("chunks", "chunk-1"),
    ).resolves.toEqual({ id: "chunk-1", text: "hope" })
    await expect(
      client.getDocument("chunks", "missing-chunk"),
    ).resolves.toBeUndefined()
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

  it("preserves grouped search hits and optional lexical match metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        results: [
          {
            found: 3,
            out_of: 3,
            page: 1,
            search_time_ms: 3,
            grouped_hits: [
              {
                group_key: ["video-1"],
                found: 1,
                hits: [
                  {
                    document: { id: "chunk-1" },
                    text_match_info: {
                      score: "578730123365187679",
                      tokens_matched: 2,
                      num_tokens_dropped: 1,
                      typo_prefix_score: 3,
                    },
                  },
                ],
              },
              {
                group_key: ["video-2"],
                found: 1,
                hits: [
                  {
                    document: { id: "chunk-2" },
                    text_match_info: { tokens_matched: 1 },
                  },
                ],
              },
              {
                group_key: ["video-3"],
                found: 1,
                hits: [{ document: { id: "chunk-3" } }],
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

    expect(result?.grouped_hits).toEqual([
      {
        group_key: ["video-1"],
        found: 1,
        hits: [
          {
            document: { id: "chunk-1" },
            text_match_info: {
              score: "578730123365187679",
              tokens_matched: 2,
              num_tokens_dropped: 1,
              typo_prefix_score: 3,
            },
          },
        ],
      },
      {
        group_key: ["video-2"],
        found: 1,
        hits: [
          {
            document: { id: "chunk-2" },
            text_match_info: { tokens_matched: 1 },
          },
        ],
      },
      {
        group_key: ["video-3"],
        found: 1,
        hits: [{ document: { id: "chunk-3" } }],
      },
    ])

    const fullMatchInfo = result?.grouped_hits?.[0]?.hits[0]?.text_match_info
    expect(fullMatchInfo?.tokens_matched).toBe(2)
    expect(fullMatchInfo?.num_tokens_dropped).toBe(1)
    expect(fullMatchInfo?.typo_prefix_score).toBe(3)
    expect(result?.grouped_hits?.[2]?.hits[0]?.text_match_info).toBeUndefined()
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

  it("allows a multi-search call to use a shorter timeout", async () => {
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
      timeoutMs: 2_000,
      fetch: fetchMock,
    })

    await expect(
      client.multiSearch([{ collection: "watch", q: "jesus" }], {
        timeoutMs: 5,
      }),
    ).rejects.toThrow("timed out after 5ms")
  })
})
