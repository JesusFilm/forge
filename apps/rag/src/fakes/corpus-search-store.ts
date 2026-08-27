/**
 * In-memory CorpusSearchStore fake for Retrieval unit tests. Seed it with
 * indexed chunks (each carrying an embedding + filter fields); vectorSearch
 * ranks by cosine, mirroring the real pgvector store's filter + ordering
 * semantics so Retrieval tests are faithful to production behaviour. Pair it
 * with FakeEmbedder at the same `dimensions` to embed both chunks and queries.
 *
 * Like the real store, this returns the top-k candidates ordered by score; the
 * minScore cutoff and 3-key dedup live in Retrieval (architecture §2/§4).
 */
import type {
  CorpusSearchStore,
  ScoredRow,
  SearchFilter,
} from "../contracts/index.js"
import { cosineSimilarity } from "./vector-math.js"

/** A seeded row: the public ScoredRow fields plus embedding + filter columns. */
export interface FakeIndexedChunk extends Omit<ScoredRow, "score"> {
  embedding: number[]
  domain: string | null
  language: string | null
  category: string | null
  /** Model that produced `embedding`; feeds `embeddingModels()` (guard). Optional. */
  embeddingModel?: string
}

function matchesFilter(chunk: FakeIndexedChunk, filter: SearchFilter): boolean {
  if (filter.allowedSourceKeys !== undefined) {
    if (filter.allowedSourceKeys.length === 0) return false
    if (!filter.allowedSourceKeys.includes(chunk.sourceKey)) return false
  }
  if (filter.sourceKey && chunk.sourceKey !== filter.sourceKey) return false
  if (filter.domain && chunk.domain !== filter.domain) return false
  if (filter.urlPrefix && !chunk.canonicalUrl.startsWith(filter.urlPrefix)) {
    return false
  }
  if (filter.language && chunk.language !== filter.language) return false
  if (filter.category && chunk.category !== filter.category) return false
  if (
    filter.embeddingModel &&
    chunk.embeddingModel !== undefined &&
    chunk.embeddingModel !== filter.embeddingModel
  ) {
    return false
  }
  return true
}

function toScoredRow(chunk: FakeIndexedChunk, score: number): ScoredRow {
  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    score,
    text: chunk.text,
    ord: chunk.ord,
    tags: chunk.tags,
    sourceKey: chunk.sourceKey,
    sourceName: chunk.sourceName,
    title: chunk.title,
    canonicalUrl: chunk.canonicalUrl,
    contentHash: chunk.contentHash,
  }
}

export class FakeCorpusSearchStore implements CorpusSearchStore {
  private readonly chunks: FakeIndexedChunk[] = []

  constructor(seed: FakeIndexedChunk[] = []) {
    this.chunks.push(...seed)
  }

  add(chunk: FakeIndexedChunk): this {
    this.chunks.push(chunk)
    return this
  }

  async vectorSearch(
    queryVec: number[],
    filter: SearchFilter,
    k: number,
  ): Promise<ScoredRow[]> {
    return this.chunks
      .filter((c) => matchesFilter(c, filter))
      .map((c) => toScoredRow(c, cosineSimilarity(queryVec, c.embedding)))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }

  async keywordSearch(
    query: string,
    filter: SearchFilter,
    k: number,
  ): Promise<ScoredRow[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return this.chunks
      .filter((c) => matchesFilter(c, filter))
      .map((c) => {
        const hay = `${c.title ?? ""} ${c.text}`.toLowerCase()
        const hits = terms.filter((t) => hay.includes(t)).length
        return toScoredRow(c, hits)
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }

  async fetchById(chunkId: string): Promise<ScoredRow | null> {
    const chunk = this.chunks.find((c) => c.chunkId === chunkId)
    return chunk ? toScoredRow(chunk, 1) : null
  }

  /** Full document text per id: seeded chunks grouped by documentId, `ord`-ordered, joined. */
  async fetchDocumentTexts(
    documentIds: string[],
  ): Promise<Map<string, string>> {
    const want = new Set(documentIds)
    const byDoc = new Map<string, FakeIndexedChunk[]>()
    for (const c of this.chunks) {
      if (!want.has(c.documentId)) continue
      const bucket = byDoc.get(c.documentId)
      if (bucket) bucket.push(c)
      else byDoc.set(c.documentId, [c])
    }
    return new Map(
      [...byDoc].map(([id, cs]) => [
        id,
        [...cs]
          .sort((a, b) => a.ord - b.ord)
          .map((c) => c.text)
          .join("\n\n"),
      ]),
    )
  }

  async embeddingModels(): Promise<string[]> {
    return [
      ...new Set(
        this.chunks
          .map((c) => c.embeddingModel)
          .filter((m): m is string => Boolean(m)),
      ),
    ]
  }
}
