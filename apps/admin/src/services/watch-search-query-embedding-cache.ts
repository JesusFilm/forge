export type WatchSearchQueryEmbeddingCacheIdentity = {
  provider: string
  model: string
  dimensions: number
  queryHash: string
}

type ProcessCacheEntry = {
  embedding: number[]
  expiresAtMs: number
}

type ProcessCacheOptions = {
  maxEntries: number
  ttlMs: number
  now?: () => number
}

function serializedIdentity(
  identity: WatchSearchQueryEmbeddingCacheIdentity,
): string {
  return JSON.stringify([
    identity.provider,
    identity.model,
    identity.dimensions,
    identity.queryHash,
  ])
}

function isValidEmbedding(
  embedding: readonly number[],
  dimensions: number,
): boolean {
  return (
    embedding.length === dimensions &&
    embedding.every((value) => Number.isFinite(value))
  )
}

export class WatchSearchQueryEmbeddingProcessCache {
  private readonly entries = new Map<string, ProcessCacheEntry>()
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly now: () => number

  constructor(private readonly options: ProcessCacheOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("Query embedding cache maxEntries must be positive")
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error("Query embedding cache ttlMs must be positive")
    }
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.entries.size
  }

  get(identity: WatchSearchQueryEmbeddingCacheIdentity): number[] | null {
    const key = serializedIdentity(identity)
    const entry = this.entries.get(key)
    if (entry == null) return null

    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key)
      return null
    }

    // Map insertion order is the LRU order. Reinsert a hit as most recent.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return [...entry.embedding]
  }

  set(
    identity: WatchSearchQueryEmbeddingCacheIdentity,
    embedding: readonly number[],
  ): boolean {
    if (!isValidEmbedding(embedding, identity.dimensions)) return false

    const key = serializedIdentity(identity)
    this.entries.delete(key)
    this.entries.set(key, {
      embedding: [...embedding],
      expiresAtMs: this.now() + this.options.ttlMs,
    })

    while (this.entries.size > this.options.maxEntries) {
      const leastRecentlyUsedKey = this.entries.keys().next().value
      if (leastRecentlyUsedKey == null) break
      this.entries.delete(leastRecentlyUsedKey)
    }
    return true
  }

  coalesce<T>(
    identity: WatchSearchQueryEmbeddingCacheIdentity,
    loader: () => Promise<T>,
  ): { promise: Promise<T>; coalesced: boolean } {
    const key = serializedIdentity(identity)
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing != null) return { promise: existing, coalesced: true }

    const promise = Promise.resolve()
      .then(loader)
      .finally(() => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
      })
    this.inFlight.set(key, promise)
    return { promise, coalesced: false }
  }

  clear(): void {
    this.entries.clear()
    this.inFlight.clear()
  }
}

const QUERY_EMBEDDING_L1_MAX_ENTRIES = 256
const QUERY_EMBEDDING_L1_TTL_MS = 60 * 60 * 1_000

export const watchSearchQueryEmbeddingProcessCache =
  new WatchSearchQueryEmbeddingProcessCache({
    maxEntries: QUERY_EMBEDDING_L1_MAX_ENTRIES,
    ttlMs: QUERY_EMBEDDING_L1_TTL_MS,
  })

export function resetWatchSearchQueryEmbeddingProcessCacheForTests(): void {
  watchSearchQueryEmbeddingProcessCache.clear()
}
