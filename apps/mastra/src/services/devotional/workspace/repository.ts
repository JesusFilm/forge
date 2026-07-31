import { createHash } from "node:crypto"

import {
  Bm25GenerationIndex,
  type CatalogStore,
  type Embedder,
  type GenerationVectorIndex,
} from "./catalog"
import type { CatalogDocument } from "./catalog-schema"
import { DevotionalWorkspaceError } from "./errors"
import type {
  DevotionalInventoryLimits,
  InventoryFilesystem,
} from "./inventory"
import { reconcileDevotionalWorkspace } from "./reconciler"
import type { DevotionalInputCategory } from "./schemas"

export type DevotionalSourceRef = Pick<
  CatalogDocument,
  "path" | "category" | "digest" | "size" | "modifiedAt" | "etag" | "title"
>

export type DevotionalSearchResult = DevotionalSourceRef & { score: number }

export class DevotionalWorkspaceRepository {
  private readonly filesystem: InventoryFilesystem
  private readonly catalog: CatalogStore
  private readonly vectorIndex?: GenerationVectorIndex
  private readonly embedder?: Embedder
  private readonly limits?: Partial<DevotionalInventoryLimits>
  private readonly keywordIndexes = new Map<number, Bm25GenerationIndex>()

  constructor(options: {
    filesystem: InventoryFilesystem
    catalog: CatalogStore
    vectorIndex?: GenerationVectorIndex
    embedder?: Embedder
    limits?: Partial<DevotionalInventoryLimits>
  }) {
    this.filesystem = options.filesystem
    this.catalog = options.catalog
    this.vectorIndex = options.vectorIndex
    this.embedder = options.embedder
    this.limits = options.limits
  }

  async reconcile() {
    const result = await reconcileDevotionalWorkspace({
      filesystem: this.filesystem,
      catalog: this.catalog,
      vectorIndex: this.vectorIndex,
      embedder: this.embedder,
      limits: this.limits,
    })
    this.keywordIndexes.set(result.generation, result.keywordIndex)
    return result
  }

  async search(
    query: string,
    options: { category?: DevotionalInputCategory; topK?: number } = {},
  ): Promise<DevotionalSearchResult[]> {
    if (!this.vectorIndex || !this.embedder) {
      throw new DevotionalWorkspaceError(
        "hybrid-search-unavailable",
        "Devotional hybrid retrieval is unavailable",
      )
    }
    const head = await this.catalog.getHead()
    if (!head) {
      throw new DevotionalWorkspaceError(
        "hybrid-search-unavailable",
        "No committed devotional catalog generation is available",
      )
    }
    const topK = Math.max(1, Math.min(options.topK ?? 10, 100))
    const overFetch = Math.min(500, topK * 5)
    let keywordIndex = this.keywordIndexes.get(head.generation)
    if (!keywordIndex) {
      keywordIndex = new Bm25GenerationIndex(head.documents)
      this.keywordIndexes.set(head.generation, keywordIndex)
    }

    const keyword = keywordIndex.search(query, {
      category: options.category,
      topK: overFetch,
    })
    const vector = await this.vectorIndex.search(
      head.generation,
      await this.embedder(query),
      overFetch,
    )
    const current = new Map(
      head.documents.map((document) => [
        `${document.path}\0${document.digest}`,
        document,
      ]),
    )
    const scores = new Map<string, number>()
    const rrfK = 60
    for (const [rank, result] of keyword.entries()) {
      const key = `${result.path}\0${result.digest}`
      if (current.has(key))
        scores.set(key, (scores.get(key) ?? 0) + 1 / (rrfK + rank))
    }
    for (const [rank, result] of vector.entries()) {
      const key = `${result.path}\0${result.digest}`
      const document = current.get(key)
      if (
        !document ||
        (options.category && document.category !== options.category)
      ) {
        continue
      }
      scores.set(key, (scores.get(key) ?? 0) + 1 / (rrfK + rank))
    }

    return [...scores.entries()]
      .map(([key, score]) => {
        const document = current.get(key)
        if (!document) return undefined
        return {
          path: document.path,
          category: document.category,
          digest: document.digest,
          size: document.size,
          modifiedAt: document.modifiedAt,
          ...(document.etag ? { etag: document.etag } : {}),
          title: document.title,
          score,
        }
      })
      .filter((value): value is DevotionalSearchResult => value !== undefined)
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)
  }

  async readVerified(ref: DevotionalSourceRef): Promise<string> {
    const before = await this.filesystem.stat(ref.path)
    const value = await this.filesystem.readFile(ref.path)
    const bytes = typeof value === "string" ? Buffer.from(value) : value
    const after = await this.filesystem.stat(ref.path)
    const digest = createHash("sha256").update(bytes).digest("hex")
    if (
      before.size !== after.size ||
      before.modifiedAt.getTime() !== after.modifiedAt.getTime() ||
      digest !== ref.digest
    ) {
      throw new DevotionalWorkspaceError(
        "source-changed",
        `Workspace source changed after reconciliation: ${ref.path}`,
        { details: { path: ref.path }, retryable: true },
      )
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  }

  async verifyAll(refs: DevotionalSourceRef[]): Promise<void> {
    for (const ref of refs) await this.readVerified(ref)
  }
}
