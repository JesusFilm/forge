/**
 * Fakes-only unit tests — no Postgres, no network. These lock the load-bearing
 * behaviours later context tests will lean on (the null-per-empty embedding
 * skip path, upsertSource-before-replaceDocument, delete-then-insert, cosine
 * ranking, and the filter semantics that mirror the real pgvector store).
 */
import { describe, it, expect } from "vitest"
import type {
  EmbeddedChunk,
  NormalizedDocument,
  PendingRawDocument,
} from "../contracts/index.js"
import {
  FakeCorpusSearchStore,
  FakeCorpusWriteStore,
  FakeEmbedder,
  FakeFetcher,
  FakeFetchStateStore,
  FakeRawDocumentReader,
  FakeRawDocumentStore,
  type FakeIndexedChunk,
  cosineSimilarity,
} from "../fakes/index.js"

const DIMS = 16

function pending(
  id: string,
  sourceKey: string,
  canonicalUrl: string,
): PendingRawDocument {
  return {
    id,
    sourceKey,
    url: canonicalUrl,
    canonicalUrl,
    title: null,
    rawContent: "content",
    fetch: {
      status: 200,
      bodyHash: `body-${id}`,
      etag: null,
      lastModified: null,
      fetchedAt: "2026-08-27T00:00:00.000Z",
      notModified: false,
    },
  }
}

function doc(overrides: Partial<NormalizedDocument> = {}): NormalizedDocument {
  return {
    sourceKey: "demo",
    source: "demo.org",
    canonicalUrl: "https://demo.org/a",
    title: "A",
    content: "the body",
    language: "en",
    category: "article",
    tags: ["audience:public"],
    contentHash: "hash-1",
    metadata: {},
    ...overrides,
  }
}

function chunk(ord: number, embedding: number[]): EmbeddedChunk {
  return {
    ord,
    text: `chunk ${ord}`,
    charStart: 0,
    charEnd: 10,
    tokenCount: 3,
    tags: [],
    embedding,
    embeddingModel: "fake/deterministic-embedder",
  }
}

describe("FakeEmbedder", () => {
  it("returns null for empty/whitespace input and vectors otherwise", async () => {
    const embedder = new FakeEmbedder({ dimensions: DIMS })
    const out = await embedder.embed(["hello", "", "   ", "world"])
    expect(out[0]).toHaveLength(DIMS)
    expect(out[1]).toBeNull()
    expect(out[2]).toBeNull()
    expect(out[3]).toHaveLength(DIMS)
  })

  it("is deterministic: same text embeds to a unit-cosine match", async () => {
    const embedder = new FakeEmbedder({ dimensions: DIMS })
    const [vec] = await embedder.embed(["the gospel of John"])
    const query = await embedder.embedQuery("the gospel of John")
    expect(cosineSimilarity(vec as number[], query)).toBeCloseTo(1, 6)
    expect(embedder.dimensions).toBe(DIMS)
    expect(embedder.model).toContain("fake")
  })

  it("rejects vector widths that pgvector cannot compare", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(
      /vector dimension mismatch/,
    )
  })
})

describe("FakeCorpusWriteStore", () => {
  it("requires upsertSource before replaceDocument", async () => {
    const store = new FakeCorpusWriteStore()
    await expect(store.replaceDocument(doc(), [])).rejects.toThrow(
      /unknown source key/,
    )
  })

  it("replaceDocument is delete-then-insert (re-index replaces chunks)", async () => {
    const store = new FakeCorpusWriteStore()
    const embedder = new FakeEmbedder({ dimensions: DIMS })
    await store.upsertSource({
      key: "demo",
      name: "Demo",
      domain: "demo.org",
      trust: "owned",
      ingestionMode: "html-scrape",
      languages: ["en"],
      defaultTags: [],
      defaultCategory: null,
      rights: null,
      contentHash: null,
    })
    const [a, b, c] = (await embedder.embed(["a", "b", "c"])) as number[][]

    await store.replaceDocument(doc(), [chunk(0, a), chunk(1, b), chunk(2, c)])
    expect(store.totalChunks()).toBe(3)
    // getDedup reports the document's embedding model (from a stored chunk) too,
    // so the ingest force-gate can skip docs already on the target model.
    expect(await store.getDedup("demo", "https://demo.org/a")).toEqual({
      contentHash: "hash-1",
      embeddingModel: "fake/deterministic-embedder",
    })

    // Re-index the same document with fewer chunks: old chunks must be gone.
    await store.replaceDocument(doc({ contentHash: "hash-2" }), [chunk(0, a)])
    expect(store.totalChunks()).toBe(1)
    expect(
      store.getDocument("demo", "https://demo.org/a")?.doc.contentHash,
    ).toBe("hash-2")
  })
})

describe("FakeCorpusSearchStore", () => {
  async function seeded(): Promise<{
    store: FakeCorpusSearchStore
    embedder: FakeEmbedder
  }> {
    const embedder = new FakeEmbedder({ dimensions: DIMS })
    const texts = ["faith and grace", "loaves and fishes", "the road to Emmaus"]
    const vecs = (await embedder.embed(texts)) as number[][]
    const rows: FakeIndexedChunk[] = texts.map((text, i) => ({
      chunkId: `chunk-${i}`,
      documentId: `doc-${i}`,
      text,
      ord: i,
      tags: [],
      sourceKey: i === 2 ? "other" : "demo",
      sourceName: "Demo",
      title: `Doc ${i}`,
      canonicalUrl: `https://demo.org/${i}`,
      contentHash: `h${i}`,
      embedding: vecs[i],
      domain: "demo.org",
      language: "en",
      category: "article",
    }))
    return { store: new FakeCorpusSearchStore(rows), embedder }
  }

  it("ranks the closest chunk first by cosine", async () => {
    const { store, embedder } = await seeded()
    const q = await embedder.embedQuery("loaves and fishes")
    const results = await store.vectorSearch(q, {}, 3)
    expect(results[0].chunkId).toBe("chunk-1")
    expect(results[0].score).toBeCloseTo(1, 6)
  })

  it("applies the allowedSourceKeys visibility filter", async () => {
    const { store, embedder } = await seeded()
    const q = await embedder.embedQuery("the road to Emmaus")
    const visible = await store.vectorSearch(
      q,
      { allowedSourceKeys: ["demo"] },
      5,
    )
    expect(visible.every((r) => r.sourceKey === "demo")).toBe(true)
    const none = await store.vectorSearch(q, { allowedSourceKeys: [] }, 5)
    expect(none).toHaveLength(0)
  })

  it("fetchById returns the seeded row or null", async () => {
    const { store } = await seeded()
    expect((await store.fetchById("chunk-0"))?.text).toBe("faith and grace")
    expect(await store.fetchById("missing")).toBeNull()
  })
})

describe("FakeFetcher + FakeFetchStateStore", () => {
  it("fetcher 404s unknown URLs and 304s on a matching etag", async () => {
    const fetcher = new FakeFetcher({
      "https://x/1": {
        status: 200,
        body: "hi",
        etag: "v1",
        lastModified: null,
        notModified: false,
      },
    })
    expect((await fetcher.fetch("https://x/missing")).status).toBe(404)
    const cond = await fetcher.fetch("https://x/1", { ifNoneMatch: "v1" })
    expect(cond.notModified).toBe(true)
    expect(cond.status).toBe(304)
  })

  it("fetch-state store round-trips http + robots entries by copy", async () => {
    const store = new FakeFetchStateStore()
    await store.putHttpCache({
      url: "https://x/1",
      etag: "v1",
      lastModified: null,
      bodyHash: "bh",
      status: 200,
      fetchedAt: "2026-05-22T00:00:00.000Z",
    })
    expect((await store.getHttpCache("https://x/1"))?.bodyHash).toBe("bh")
    expect(await store.getHttpCache("https://x/2")).toBeNull()

    await store.putRobots({
      robotsUrl: "https://x/robots.txt",
      body: "User-agent: *",
      status: 200,
      fetchedAt: "2026-05-22T00:00:00.000Z",
    })
    expect((await store.getRobots("https://x/robots.txt"))?.status).toBe(200)
  })
})

describe("raw-document fakes", () => {
  it("models the pending, ingested, source, and limit views", async () => {
    const reader = new FakeRawDocumentReader([
      pending("1", "alpha", "https://alpha.test/1"),
      pending("2", "alpha", "https://alpha.test/2"),
      pending("3", "beta", "https://beta.test/1"),
    ])

    await reader.markIngested(["1"])
    expect((await reader.listPending()).map(({ id }) => id)).toEqual(["2", "3"])
    expect(
      (await reader.listPending({ includeIngested: true })).map(({ id }) => id),
    ).toEqual(["1", "2", "3"])
    expect(
      (await reader.listPending({ sourceKey: "alpha", limit: 1 })).map(
        ({ id }) => id,
      ),
    ).toEqual(["2"])
  })

  it("replaces staged identities and keeps source URL lists scoped", async () => {
    const store = new FakeRawDocumentStore()
    const original = pending("1", "alpha", "https://alpha.test/1")
    const replacement = { ...original, title: "Updated" }
    await store.putRawDocument(original)
    await store.putRawDocument(replacement)
    await store.putRawDocument(pending("2", "beta", "https://beta.test/1"))

    expect(store.count()).toBe(2)
    expect(store.get("alpha", original.canonicalUrl)?.title).toBe("Updated")
    expect(await store.listStagedCanonicalUrls("alpha")).toEqual([
      "https://alpha.test/1",
    ])
  })
})
