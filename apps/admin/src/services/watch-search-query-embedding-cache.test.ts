import { describe, expect, it, vi } from "vitest"
import { ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID } from "./content-embedding-contract"

import {
  WatchSearchQueryEmbeddingProcessCache,
  type WatchSearchQueryEmbeddingCacheIdentity,
} from "./watch-search-query-embedding-cache"

const identity = (
  overrides: Partial<WatchSearchQueryEmbeddingCacheIdentity> = {},
): WatchSearchQueryEmbeddingCacheIdentity => ({
  contractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  provider: "openrouter",
  model: "qwen/qwen3-embedding-8b",
  dimensions: 3,
  queryHash: "query-a",
  ...overrides,
})

describe("WatchSearchQueryEmbeddingProcessCache", () => {
  it("isolates entries by the complete provider identity and returns clones", () => {
    const cache = new WatchSearchQueryEmbeddingProcessCache({
      maxEntries: 2,
      ttlMs: 1_000,
    })
    cache.set(identity(), [0.1, 0.2, 0.3])

    const first = cache.get(identity())
    first![0] = 99

    expect(cache.get(identity())).toEqual([0.1, 0.2, 0.3])
    expect(cache.get(identity({ model: "different" }))).toBeNull()
    expect(cache.get(identity({ dimensions: 2 }))).toBeNull()
    expect(cache.get(identity({ queryHash: "query-b" }))).toBeNull()
  })

  it("expires entries and evicts the least recently used entry", () => {
    let now = 1_000
    const cache = new WatchSearchQueryEmbeddingProcessCache({
      maxEntries: 2,
      ttlMs: 100,
      now: () => now,
    })
    const first = identity({ queryHash: "first" })
    const second = identity({ queryHash: "second" })
    const third = identity({ queryHash: "third" })

    cache.set(first, [1, 2, 3])
    cache.set(second, [4, 5, 6])
    expect(cache.get(first)).toEqual([1, 2, 3])
    cache.set(third, [7, 8, 9])

    expect(cache.get(second)).toBeNull()
    expect(cache.get(first)).toEqual([1, 2, 3])
    now += 101
    expect(cache.get(first)).toBeNull()
    expect(cache.size).toBe(1)
  })

  it("rejects invalid vectors without consuming bounded capacity", () => {
    const cache = new WatchSearchQueryEmbeddingProcessCache({
      maxEntries: 2,
      ttlMs: 1_000,
    })

    expect(cache.set(identity(), [0.1, Number.NaN, 0.3])).toBe(false)
    expect(cache.set(identity(), [0.1, 0.2])).toBe(false)
    expect(cache.size).toBe(0)
  })

  it("coalesces identical work and clears rejected flights", async () => {
    const cache = new WatchSearchQueryEmbeddingProcessCache({
      maxEntries: 2,
      ttlMs: 1_000,
    })
    const loader = vi.fn(async () => [0.1, 0.2, 0.3])

    const first = cache.coalesce(identity(), loader)
    const second = cache.coalesce(identity(), loader)

    expect(first.coalesced).toBe(false)
    expect(second.coalesced).toBe(true)
    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual(
      [
        [0.1, 0.2, 0.3],
        [0.1, 0.2, 0.3],
      ],
    )
    expect(loader).toHaveBeenCalledTimes(1)

    const rejection = new Error("provider unavailable")
    const failedLoader = vi.fn().mockRejectedValue(rejection)
    await expect(
      cache.coalesce(identity({ queryHash: "failed" }), failedLoader).promise,
    ).rejects.toBe(rejection)
    await expect(
      cache.coalesce(identity({ queryHash: "failed" }), failedLoader).promise,
    ).rejects.toBe(rejection)
    expect(failedLoader).toHaveBeenCalledTimes(2)
  })
})
