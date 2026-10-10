/* eslint-disable max-lines -- retrieval invariants are kept in one behavior suite */
/**
 * Retrieval tests — fakes only (no Postgres, no network). Drives createRetriever
 * over FakeCorpusSearchStore plus a fixed-vector Embedder double, so cosine
 * scores are hand-verifiable. Locks invariant 5: cosine ranking, the candidate
 * fan-out, the minScore cutoff, each of the 3 dedup keys, the soft source
 * preference, source-scope filtering, and citation assembly.
 */
import { describe, expect, it, vi } from "vitest"
import type {
  CorpusSearchStore,
  Embedder,
  SearchFilter,
} from "../contracts/index.js"
import { FakeCorpusSearchStore, type FakeIndexedChunk } from "../fakes/index.js"
import { candidateTopK, createRetriever } from "./index.js"

/** Embedder double returning a fixed query vector, so cosines are exact. */
class VecEmbedder implements Embedder {
  readonly model = "test/vec"
  readonly dimensions = 3
  constructor(private readonly q: number[]) {}
  async embed(texts: string[]): Promise<(number[] | null)[]> {
    return texts.map(() => this.q)
  }
  async embedQuery(): Promise<number[]> {
    return this.q
  }
}

const Q = [1, 0, 0] // query direction; chunk embeddings are scored against this

function chunk(
  p: Partial<FakeIndexedChunk> &
    Pick<FakeIndexedChunk, "chunkId" | "embedding">,
): FakeIndexedChunk {
  return {
    chunkId: p.chunkId,
    // Defaults to a per-chunk document so existing dedup cases (which key on
    // contentHash, not documentId) are unaffected; the #79 cases below pass an
    // explicit shared documentId to model many chunks of ONE article.
    documentId: p.documentId ?? `doc-${p.chunkId}`,
    text: p.text ?? `text ${p.chunkId}`,
    ord: p.ord ?? 0,
    tags: p.tags ?? [],
    sourceKey: p.sourceKey ?? "starting-with-god",
    sourceName: p.sourceName ?? "Starting With God",
    title: p.title ?? `Title ${p.chunkId}`,
    canonicalUrl:
      p.canonicalUrl ?? `https://www.startingwithgod.com/${p.chunkId}`,
    contentHash: p.contentHash ?? `hash-${p.chunkId}`,
    embedding: p.embedding,
    domain: p.domain ?? "www.startingwithgod.com",
    // `??` would coerce an explicit null (a "not confidently detected" row,
    // #74) back to "en" — only default when the field was omitted entirely.
    language: p.language === undefined ? "en" : p.language,
    category: p.category ?? null,
    embeddingModel: p.embeddingModel,
  }
}

function retriever(seed: FakeIndexedChunk[], q: number[] = Q) {
  return createRetriever({
    embedder: new VecEmbedder(q),
    search: new FakeCorpusSearchStore(seed),
  })
}

describe("candidateTopK (fan-out, invariant 5)", () => {
  it("over-fetches topK*3 (or topK+5 for small topK)", () => {
    expect(candidateTopK(5)).toBe(15) // max(15, 10) — retrieval default, unchanged
    expect(candidateTopK(1)).toBe(6) // max(3, 6)
    expect(candidateTopK(10)).toBe(30) // max(30, 15) — the eval's topK, unchanged
  })

  it("scales the fan-out with topK instead of pinning at a flat cap", () => {
    // Regression: the ceiling was a flat 50, so every topK >= 17 fanned out to
    // exactly 50 candidates. After the 3-key dedup that answered a request for
    // 100 results with ~33 documents — silent truncation. The fan-out must keep
    // growing with topK or `search` cannot honour its own topK.
    expect(candidateTopK(20)).toBe(60) // was 50
    expect(candidateTopK(40)).toBe(120) // was 50
    expect(candidateTopK(100)).toBe(300) // was 50
  })

  it("still bounds the fan-out so a pathological topK cannot scan the corpus", () => {
    expect(candidateTopK(100_000)).toBe(500)
  })
})

describe("createRetriever.search", () => {
  it("ranks by cosine, applies the minScore cutoff, and cites each hit", async () => {
    const out = await retriever([
      chunk({ chunkId: "hi", embedding: [1, 0, 0] }), // cosine 1.0
      chunk({ chunkId: "mid", embedding: [0.8, 0.6, 0] }), // cosine 0.8
      chunk({ chunkId: "low", embedding: [0, 1, 0] }), // cosine 0.0 → dropped
    ]).search("anything")

    expect(out.map((r) => r.chunkId)).toEqual(["hi", "mid"])
    expect(out[0].score).toBeCloseTo(1.0)
    expect(out[1].score).toBeCloseTo(0.8)
    expect(out[0].citation).toEqual({
      sourceKey: "starting-with-god",
      sourceName: "Starting With God",
      title: "Title hi",
      url: "https://www.startingwithgod.com/hi",
    })
  })

  it("honours topK (default 5, overridable)", async () => {
    const seed = Array.from({ length: 8 }, (_, i) =>
      chunk({ chunkId: `c${i}`, embedding: [1, 0, 0] }),
    )
    expect((await retriever(seed).search("q")).length).toBe(5) // default
    expect((await retriever(seed).search("q", { topK: 2 })).length).toBe(2)
  })

  it("honours an overridden minScore", async () => {
    const out = await retriever([
      chunk({ chunkId: "hi", embedding: [1, 0, 0] }), // 1.0
      chunk({ chunkId: "mid", embedding: [0.8, 0.6, 0] }), // 0.8 → below 0.9
    ]).search("q", { minScore: 0.9 })
    expect(out.map((r) => r.chunkId)).toEqual(["hi"])
  })

  it("requests the fan-out candidate count from the store", async () => {
    let seenK = -1
    const base = new FakeCorpusSearchStore([
      chunk({ chunkId: "a", embedding: [1, 0, 0] }),
    ])
    const spy: CorpusSearchStore = {
      vectorSearch: (v: number[], f: SearchFilter, k: number) => {
        seenK = k
        return base.vectorSearch(v, f, k)
      },
      fetchById: (id: string) => base.fetchById(id),
      fetchDocumentTexts: (ids: string[]) => base.fetchDocumentTexts(ids),
    }
    await createRetriever({ embedder: new VecEmbedder(Q), search: spy }).search(
      "q",
      { topK: 5 },
    )
    expect(seenK).toBe(15)
  })
})

describe("3-key dedup (invariant 5) — at most one chunk per distinct document", () => {
  it("collapses on shared document content-hash", async () => {
    const out = await retriever([
      chunk({
        chunkId: "a",
        contentHash: "same",
        canonicalUrl: "u/a",
        ord: 0,
        title: "A",
        text: "alpha",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "b",
        contentHash: "same",
        canonicalUrl: "u/b",
        ord: 1,
        title: "B",
        text: "beta",
        embedding: [1, 0, 0],
      }),
    ]).search("q")
    expect(out.map((r) => r.chunkId)).toEqual(["a"])
  })

  it("collapses on shared canonicalUrl + ord", async () => {
    const out = await retriever([
      chunk({
        chunkId: "a",
        contentHash: "h1",
        canonicalUrl: "u/x",
        ord: 2,
        title: "A",
        text: "alpha",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "b",
        contentHash: "h2",
        canonicalUrl: "u/x",
        ord: 2,
        title: "B",
        text: "beta",
        embedding: [1, 0, 0],
      }),
    ]).search("q")
    expect(out.map((r) => r.chunkId)).toEqual(["a"])
  })

  it("collapses on shared title + text fingerprint", async () => {
    const out = await retriever([
      chunk({
        chunkId: "a",
        contentHash: "h1",
        canonicalUrl: "u/a",
        ord: 0,
        title: "Same",
        text: "Identical  body.",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "b",
        contentHash: "h2",
        canonicalUrl: "u/b",
        ord: 1,
        title: "Same",
        text: "identical body.",
        embedding: [1, 0, 0],
      }),
    ]).search("q")
    expect(out.map((r) => r.chunkId)).toEqual(["a"])
  })

  it("keeps rows that differ on all three keys", async () => {
    const out = await retriever([
      chunk({
        chunkId: "a",
        contentHash: "h1",
        canonicalUrl: "u/a",
        ord: 0,
        title: "A",
        text: "alpha",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "b",
        contentHash: "h2",
        canonicalUrl: "u/b",
        ord: 1,
        title: "B",
        text: "beta",
        embedding: [1, 0, 0],
      }),
    ]).search("q")
    expect(out.map((r) => r.chunkId)).toEqual(["a", "b"])
  })
})

describe("full-document retrieval — the buried-answer fix (issue #79)", () => {
  // A cru-shaped article: chunk 0 is a lead-in anecdote that best matches the
  // query; chunk 1 buries the actual answer. Both are chunks of ONE document
  // (shared documentId + contentHash), so the 3-key dedup returns exactly one —
  // the anecdote — and chunk-only retrieval never surfaces the answer.
  function buriedAnswerDoc() {
    // Source-agnostic shape (cru is the issue's example; the bug isn't cru-specific).
    const doc = {
      documentId: "d-bible",
      contentHash: "doc-bible",
      canonicalUrl: "u/bible",
      sourceKey: "cru",
      sourceName: "Cru",
      title: "How to study the Bible effectively",
    }
    return [
      chunk({
        ...doc,
        chunkId: "anecdote",
        ord: 0,
        text: "Admiral Byrd sat alone through the Antarctic winter, and it changed him.",
        embedding: [1, 0, 0], // cosine 1.0 — wins the ranking
      }),
      chunk({
        ...doc,
        chunkId: "answer",
        ord: 1,
        text: "To study the Bible on your own, start with a single book and read it slowly.",
        embedding: [0.8, 0.6, 0], // cosine 0.8 — above cutoff, but dedup drops it
      }),
    ]
  }

  it("chunk-only (default) surfaces the anecdote and never the buried answer", async () => {
    const out = await retriever(buriedAnswerDoc()).search(
      "how do I study the Bible on my own?",
    )
    expect(out.map((r) => r.chunkId)).toEqual(["anecdote"]) // one chunk per doc
    expect(out[0].text).toContain("Admiral Byrd")
    expect(out[0].text).not.toContain("start with a single book") // the answer is buried
    expect(out[0].document).toBeUndefined() // no full doc on the default path
  })

  it("returns the FULL document — including the buried answer — when includeDocument is set", async () => {
    const out = await retriever(buriedAnswerDoc()).search(
      "how do I study the Bible on my own?",
      { includeDocument: true },
    )
    expect(out.map((r) => r.chunkId)).toEqual(["anecdote"]) // ranking is unchanged
    expect(out[0].document).toBeDefined()
    expect(out[0].document).toContain("Admiral Byrd") // the lead-in
    expect(out[0].document).toContain("start with a single book") // AND the answer chunk 1 buried
    expect(out[0].text).toBe(
      "Admiral Byrd sat alone through the Antarctic winter, and it changed him.",
    ) // `text` still the matched chunk (the ranking evidence)
  })

  it("attaches each hit its OWN document across multiple hits (no cross-wiring)", async () => {
    // Two distinct documents, each with a buried second chunk. The winners are
    // the two lead chunks; each result must carry ITS OWN reassembled document —
    // a regression that mis-indexed winners[i].documentId would swap them.
    const out = await retriever([
      chunk({
        chunkId: "a0",
        documentId: "dA",
        contentHash: "hA",
        canonicalUrl: "u/a",
        ord: 0,
        text: "alpha lead",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "a1",
        documentId: "dA",
        contentHash: "hA",
        canonicalUrl: "u/a",
        ord: 1,
        text: "alpha buried",
        embedding: [0, 0, 1],
      }), // below cutoff, dropped from ranking
      chunk({
        chunkId: "b0",
        documentId: "dB",
        contentHash: "hB",
        canonicalUrl: "u/b",
        ord: 0,
        text: "beta lead",
        embedding: [0.9, 0.1, 0],
      }),
      chunk({
        chunkId: "b1",
        documentId: "dB",
        contentHash: "hB",
        canonicalUrl: "u/b",
        ord: 1,
        text: "beta buried",
        embedding: [0, 1, 0],
      }), // below cutoff, dropped from ranking
    ]).search("q", { includeDocument: true })

    expect(out.map((r) => r.chunkId)).toEqual(["a0", "b0"]) // two distinct docs ranked
    expect(out[0].document).toBe("alpha lead\n\nalpha buried") // dA's chunks only
    expect(out[1].document).toBe("beta lead\n\nbeta buried") // dB's chunks only
  })

  it("reassembles overlapping chunks verbatim — the documented stutter, not de-overlapped (ADR-0011)", async () => {
    // Real chunks overlap ~50 tokens (chunk.ts), so chunk 1 repeats chunk 0's
    // tail. Reassembly is a plain ord-order join and deliberately does NOT
    // de-overlap, so the boundary phrase appears twice. Lock that documented
    // behavior so a future ord/overlap regression can't pass silently.
    const out = await retriever([
      chunk({
        chunkId: "o0",
        documentId: "dOv",
        contentHash: "hOv",
        canonicalUrl: "u/ov",
        ord: 0,
        text: "the answer is found later in the article",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "o1",
        documentId: "dOv",
        contentHash: "hOv",
        canonicalUrl: "u/ov",
        ord: 1,
        text: "later in the article the method is spelled out in full",
        embedding: [0, 0, 1],
      }),
    ]).search("q", { includeDocument: true })

    expect(out[0].document).toBe(
      "the answer is found later in the article\n\n" +
        "later in the article the method is spelled out in full",
    )
    // The overlap phrase survives twice (front of chunk 1 == tail of chunk 0).
    expect(out[0].document!.split("later in the article").length - 1).toBe(2)
  })

  it("omits `document` when the batch cannot resolve it (TOCTOU), rather than mislabeling the chunk", async () => {
    // A concurrent re-ingest can delete-then-insert a document between the
    // vectorSearch and the fetchDocumentTexts call, so the batch returns nothing
    // for a winner. `document` must be OMITTED (undefined), never set to the
    // matched chunk — else a consumer can't tell it apart from a 1-chunk doc.
    const base = new FakeCorpusSearchStore([
      chunk({ chunkId: "x", documentId: "dX", embedding: [1, 0, 0] }),
    ])
    const raced: CorpusSearchStore = {
      vectorSearch: (v, f, k) => base.vectorSearch(v, f, k),
      fetchById: (id) => base.fetchById(id),
      fetchDocumentTexts: async () => new Map(), // doc vanished mid-request
      embeddingModels: () => base.embeddingModels(),
    }
    const out = await createRetriever({
      embedder: new VecEmbedder(Q),
      search: raced,
    }).search("q", { includeDocument: true })

    expect(out).toHaveLength(1)
    expect(out[0].document).toBeUndefined() // omitted, NOT out[0].text
    expect(out[0].text).toBe("text x") // the matched chunk is still present as `text`
  })
})

describe("query/corpus model-match guard", () => {
  // VecEmbedder.model is "test/vec"; the corpus reports its own embedding model(s).
  it("throws when the query model is in NONE of the corpus models", async () => {
    const r = retriever([
      chunk({
        chunkId: "a",
        embedding: [1, 0, 0],
        embeddingModel: "openai/text-embedding-3-small",
      }),
    ])
    await expect(r.search("q")).rejects.toThrow(/model mismatch/i)
    await expect(r.search("q")).rejects.toThrow(/test\/vec/) // reports the query model
  })

  it("passes when the query model is present in the corpus", async () => {
    const out = await retriever([
      chunk({ chunkId: "a", embedding: [1, 0, 0], embeddingModel: "test/vec" }),
    ]).search("q")
    expect(out.map((r) => r.chunkId)).toEqual(["a"])
  })

  it("passes during a partial re-embed (mixed models) if the query model is one of them", async () => {
    const out = await retriever([
      chunk({
        chunkId: "new",
        contentHash: "h1",
        canonicalUrl: "u/1",
        embedding: [1, 0, 0],
        embeddingModel: "test/vec",
      }),
      chunk({
        chunkId: "old",
        contentHash: "h2",
        canonicalUrl: "u/2",
        embedding: [1, 0, 0],
        embeddingModel: "legacy/model",
      }),
    ]).search("q")
    expect(out.map((r) => r.chunkId)).toEqual(["new"])
  })

  it("skips the guard when the corpus reports no models (empty / model not tracked)", async () => {
    const out = await retriever([
      chunk({ chunkId: "a", embedding: [1, 0, 0] }), // no embeddingModel set
    ]).search("q")
    expect(out.map((r) => r.chunkId)).toEqual(["a"])
  })

  it("does not cache an empty-corpus guard result", async () => {
    let checks = 0
    const store = new FakeCorpusSearchStore()
    store.embeddingModels = async () => (++checks === 1 ? [] : ["legacy/model"])
    const r = createRetriever({ embedder: new VecEmbedder(Q), search: store })

    await expect(r.search("q")).resolves.toEqual([])
    await expect(r.search("q")).rejects.toThrow(/model mismatch/i)
  })

  it("refreshes the model guard after its cache window", async () => {
    let now = 1_000
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now)
    const base = new FakeCorpusSearchStore([
      chunk({ chunkId: "a", embedding: Q, embeddingModel: "test/vec" }),
    ])
    let models = ["test/vec"]
    base.embeddingModels = async () => models
    const r = createRetriever({ embedder: new VecEmbedder(Q), search: base })

    try {
      await expect(r.search("q")).resolves.toHaveLength(1)
      models = ["legacy/model"]
      now += 60_001
      await expect(r.search("q")).rejects.toThrow(/model mismatch/i)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe("source scope + preference", () => {
  it("treats an empty allowedSourceKeys scope as deny-all", async () => {
    const embedder = new VecEmbedder(Q)
    const embedSpy = vi.spyOn(embedder, "embedQuery")
    const r = createRetriever({
      embedder,
      search: new FakeCorpusSearchStore([
        chunk({ chunkId: "private", embedding: Q }),
      ]),
    })

    await expect(r.search("q", { allowedSourceKeys: [] })).resolves.toEqual([])
    expect(embedSpy).not.toHaveBeenCalled()
  })

  it("hard-scopes to allowedSourceKeys", async () => {
    const out = await retriever([
      chunk({
        chunkId: "swg",
        sourceKey: "starting-with-god",
        contentHash: "h1",
        canonicalUrl: "u/1",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "cru",
        sourceKey: "cru",
        contentHash: "h2",
        canonicalUrl: "u/2",
        embedding: [1, 0, 0],
      }),
    ]).search("q", { allowedSourceKeys: ["starting-with-god"] })
    expect(out.map((r) => r.chunkId)).toEqual(["swg"])
  })

  it("filters by language", async () => {
    const out = await retriever([
      chunk({
        chunkId: "en",
        language: "en",
        contentHash: "h1",
        canonicalUrl: "u/1",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "es",
        language: "es",
        contentHash: "h2",
        canonicalUrl: "u/2",
        embedding: [1, 0, 0],
      }),
    ]).search("q", { language: "es" })
    expect(out.map((r) => r.chunkId)).toEqual(["es"])
  })

  it("excludes null-language rows from every language filter but returns them unfiltered (#74)", async () => {
    // A null language means "not confidently detected" — the row must be
    // invisible to any language:<code> filter yet fully present in unfiltered
    // search (it is excluded, not lost).
    const seed = [
      chunk({
        chunkId: "en",
        language: "en",
        contentHash: "h1",
        canonicalUrl: "u/1",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "es",
        language: "es",
        contentHash: "h2",
        canonicalUrl: "u/2",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "unk",
        language: null,
        contentHash: "h3",
        canonicalUrl: "u/3",
        embedding: [1, 0, 0],
      }),
    ]
    const es = await retriever(seed).search("q", { language: "es" })
    expect(es.map((r) => r.chunkId)).toEqual(["es"])
    const en = await retriever(seed).search("q", { language: "en" })
    expect(en.map((r) => r.chunkId)).toEqual(["en"])
    const all = await retriever(seed).search("q")
    expect(all.map((r) => r.chunkId).sort()).toEqual(["en", "es", "unk"])
  })

  it("applies preferSourceKey as a tiebreak only (scores untouched)", async () => {
    const seed = [
      chunk({
        chunkId: "x",
        sourceKey: "a-src",
        contentHash: "hx",
        canonicalUrl: "u/x",
        embedding: [1, 0, 0],
      }),
      chunk({
        chunkId: "y",
        sourceKey: "b-src",
        contentHash: "hy",
        canonicalUrl: "u/y",
        embedding: [1, 0, 0],
      }),
    ]
    expect((await retriever(seed).search("q")).map((r) => r.chunkId)).toEqual([
      "x",
      "y",
    ])
    const preferred = await retriever(seed).search("q", {
      preferSourceKey: "b-src",
    })
    expect(preferred.map((r) => r.chunkId)).toEqual(["y", "x"])
    expect(preferred[0].score).toBeCloseTo(1.0) // preference did not alter the score
  })
})
