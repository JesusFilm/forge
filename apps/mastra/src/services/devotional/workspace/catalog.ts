import { createHash } from "node:crypto"

import type { CatalogDocument, CatalogHead } from "./catalog-schema"
import type { DevotionalInputCategory } from "./schemas"

export type CatalogStore = {
  nextGeneration(): Promise<number>
  stage(generation: number, documents: CatalogDocument[]): Promise<void>
  commit(generation: number, inventoryDigest: string): Promise<CatalogHead>
  fail(generation: number, message: string): Promise<void>
  getHead(): Promise<CatalogHead | undefined>
  getGeneration(generation: number): Promise<CatalogDocument[]>
  retireBefore?(generation: number): Promise<number[]>
}

export type Embedder = (text: string) => Promise<number[]>

export type VectorSearchResult = {
  generation: number
  path: string
  digest: string
  score: number
}

export type GenerationVectorIndex = {
  replaceGeneration(
    generation: number,
    documents: Array<{
      path: string
      digest: string
      vector: number[]
    }>,
  ): Promise<void>
  search(
    generation: number,
    vector: number[],
    topK: number,
  ): Promise<VectorSearchResult[]>
  deleteGeneration(generation: number): Promise<void>
}

type MastraVectorStore = {
  createIndex(options: {
    indexName: string
    dimension: number
    metric: "cosine"
  }): Promise<void>
  upsert(options: {
    indexName: string
    vectors: number[][]
    metadata: Array<Record<string, unknown>>
    ids: string[]
  }): Promise<string[]>
  query(options: {
    indexName: string
    queryVector: number[]
    topK: number
  }): Promise<
    Array<{ id: string; score: number; metadata?: Record<string, unknown> }>
  >
  deleteIndex(options: { indexName: string }): Promise<void>
}

function vectorIndexName(generation: number): string {
  return `devotional_generation_${generation}`
}

export class MastraGenerationVectorIndex implements GenerationVectorIndex {
  constructor(private readonly vectorStore: MastraVectorStore) {}

  async replaceGeneration(
    generation: number,
    documents: Array<{
      path: string
      digest: string
      vector: number[]
    }>,
  ): Promise<void> {
    if (documents.length === 0)
      throw new Error("Cannot index an empty generation")
    const indexName = vectorIndexName(generation)
    await this.vectorStore.deleteIndex({ indexName }).catch(() => undefined)
    await this.vectorStore.createIndex({
      indexName,
      dimension: documents[0]!.vector.length,
      metric: "cosine",
    })
    await this.vectorStore.upsert({
      indexName,
      vectors: documents.map((document) => document.vector),
      ids: documents.map((document) =>
        createHash("sha256")
          .update(`${document.path}\0${document.digest}`)
          .digest("hex"),
      ),
      metadata: documents.map((document) => ({
        generation,
        path: document.path,
        digest: document.digest,
      })),
    })
  }

  async search(
    generation: number,
    vector: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    const results = await this.vectorStore.query({
      indexName: vectorIndexName(generation),
      queryVector: vector,
      topK,
    })
    return results.flatMap((result) => {
      const path = result.metadata?.path
      const digest = result.metadata?.digest
      if (typeof path !== "string" || typeof digest !== "string") return []
      return [{ generation, path, digest, score: result.score }]
    })
  }

  async deleteGeneration(generation: number): Promise<void> {
    await this.vectorStore.deleteIndex({
      indexName: vectorIndexName(generation),
    })
  }
}

type StagedGeneration = {
  documents: CatalogDocument[]
  status: "staged" | "failed" | "committed"
  error?: string
}

export class InMemoryCatalogStore implements CatalogStore {
  private sequence = 0
  private readonly generations = new Map<number, StagedGeneration>()
  private head?: CatalogHead

  async nextGeneration(): Promise<number> {
    this.sequence += 1
    return this.sequence
  }

  async stage(generation: number, documents: CatalogDocument[]): Promise<void> {
    this.generations.set(generation, {
      documents: structuredClone(documents),
      status: "staged",
    })
  }

  async commit(
    generation: number,
    inventoryDigest: string,
  ): Promise<CatalogHead> {
    const staged = this.generations.get(generation)
    if (!staged || staged.status !== "staged") {
      throw new Error(`Catalog generation ${generation} is not staged`)
    }
    staged.status = "committed"
    this.head = {
      generation,
      inventoryDigest,
      committedAt: new Date().toISOString(),
      documents: structuredClone(staged.documents),
    }
    return structuredClone(this.head)
  }

  async fail(generation: number, message: string): Promise<void> {
    const staged = this.generations.get(generation)
    if (staged) {
      staged.status = "failed"
      staged.error = message
    }
  }

  async getHead(): Promise<CatalogHead | undefined> {
    return this.head ? structuredClone(this.head) : undefined
  }

  async getGeneration(generation: number): Promise<CatalogDocument[]> {
    return structuredClone(this.generations.get(generation)?.documents ?? [])
  }

  async retireBefore(generation: number): Promise<number[]> {
    const retired: number[] = []
    for (const value of this.generations.keys()) {
      if (value < generation && value !== this.head?.generation) {
        this.generations.delete(value)
        retired.push(value)
      }
    }
    return retired
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftMagnitude += a * a
    rightMagnitude += b * b
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}

export class InMemoryGenerationVectorIndex implements GenerationVectorIndex {
  private readonly generations = new Map<
    number,
    Array<{ path: string; digest: string; vector: number[] }>
  >()
  private readonly injected: VectorSearchResult[] = []
  private nextWriteError?: Error

  failNextWrite(error: Error): void {
    this.nextWriteError = error
  }

  injectSearchResult(result: VectorSearchResult): void {
    this.injected.push(result)
  }

  async replaceGeneration(
    generation: number,
    documents: Array<{
      path: string
      digest: string
      vector: number[]
    }>,
  ): Promise<void> {
    if (this.nextWriteError) {
      const error = this.nextWriteError
      this.nextWriteError = undefined
      throw error
    }
    this.generations.set(generation, structuredClone(documents))
  }

  async search(
    generation: number,
    vector: number[],
    topK: number,
  ): Promise<VectorSearchResult[]> {
    const results = (this.generations.get(generation) ?? []).map(
      (document) => ({
        generation,
        path: document.path,
        digest: document.digest,
        score: cosineSimilarity(vector, document.vector),
      }),
    )
    results.push(
      ...this.injected.filter((result) => result.generation === generation),
    )
    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)
  }

  async deleteGeneration(generation: number): Promise<void> {
    this.generations.delete(generation)
  }
}

function tokenize(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}

export type KeywordSearchResult = {
  path: string
  digest: string
  score: number
}

export class Bm25GenerationIndex {
  private readonly documents: CatalogDocument[]
  private readonly terms: Map<string, number>[]
  private readonly documentFrequency = new Map<string, number>()
  private readonly averageLength: number

  constructor(documents: CatalogDocument[]) {
    this.documents = documents
    this.terms = documents.map((document) => {
      const counts = new Map<string, number>()
      for (const term of tokenize(`${document.title}\n${document.content}`)) {
        counts.set(term, (counts.get(term) ?? 0) + 1)
      }
      for (const term of counts.keys()) {
        this.documentFrequency.set(
          term,
          (this.documentFrequency.get(term) ?? 0) + 1,
        )
      }
      return counts
    })
    this.averageLength =
      this.terms.reduce(
        (total, terms) =>
          total + [...terms.values()].reduce((sum, count) => sum + count, 0),
        0,
      ) / Math.max(1, this.documents.length)
  }

  search(
    query: string,
    options: { topK: number; category?: DevotionalInputCategory },
  ): KeywordSearchResult[] {
    const queryTerms = [...new Set(tokenize(query))]
    const count = this.documents.length
    const k1 = 1.2
    const b = 0.75

    return this.documents
      .map((document, index) => {
        if (options.category && document.category !== options.category) {
          return undefined
        }
        const terms = this.terms[index] ?? new Map<string, number>()
        const length = [...terms.values()].reduce(
          (sum, value) => sum + value,
          0,
        )
        let score = 0
        for (const term of queryTerms) {
          const frequency = terms.get(term) ?? 0
          if (frequency === 0) continue
          const df = this.documentFrequency.get(term) ?? 0
          const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5))
          score +=
            idf *
            ((frequency * (k1 + 1)) /
              (frequency +
                k1 * (1 - b + b * (length / Math.max(1, this.averageLength)))))
        }
        return { path: document.path, digest: document.digest, score }
      })
      .filter((result): result is KeywordSearchResult => Boolean(result?.score))
      .sort((left, right) => right.score - left.score)
      .slice(0, options.topK)
  }
}

export function createInventoryDigest(documents: CatalogDocument[]): string {
  return createHash("sha256")
    .update(
      documents
        .map((document) => `${document.path}\0${document.digest}`)
        .sort()
        .join("\n"),
    )
    .digest("hex")
}

export function createDeterministicTestEmbedder(dimensions = 32): Embedder {
  return async (text) => {
    const vector = Array.from({ length: dimensions }, () => 0)
    for (const term of tokenize(text)) {
      const digest = createHash("sha256").update(term).digest()
      const index = digest.readUInt16BE(0) % dimensions
      vector[index] = (vector[index] ?? 0) + 1
    }
    return vector
  }
}
