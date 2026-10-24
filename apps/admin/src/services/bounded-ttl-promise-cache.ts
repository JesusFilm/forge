type TimedCacheEntry<T> =
  | { expiresAtMs: number; state: "resolved"; value: T }
  | { state: "pending"; promise: Promise<T> }

export type BoundedTtlCache<T> = Map<string, TimedCacheEntry<T>>

function trimResolvedEntries<T>(cache: BoundedTtlCache<T>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const resolvedKey = Array.from(cache).find(
      ([, entry]) => entry.state === "resolved",
    )?.[0]
    if (resolvedKey === undefined) break
    cache.delete(resolvedKey)
  }
}

function makeRoomForPendingEntry<T>(
  cache: BoundedTtlCache<T>,
  maxEntries: number,
) {
  const boundedMaximum = Math.max(1, maxEntries)
  while (cache.size >= boundedMaximum) {
    const resolvedKey = Array.from(cache).find(
      ([, entry]) => entry.state === "resolved",
    )?.[0]
    if (resolvedKey === undefined) return false
    cache.delete(resolvedKey)
  }
  return true
}

export function cachedBoundedTtlValue<T>({
  cacheByOwner,
  owner,
  key,
  ttlMs,
  maxEntries,
  loader,
}: {
  cacheByOwner: WeakMap<object, BoundedTtlCache<T>>
  owner: object
  key: string
  ttlMs: number
  maxEntries: number
  loader: () => Promise<T>
}): Promise<T> {
  let cache = cacheByOwner.get(owner)
  if (!cache) {
    cache = new Map()
    cacheByOwner.set(owner, cache)
  }

  const now = Date.now()
  const cached = cache.get(key)
  if (cached?.state === "pending") return cached.promise
  if (cached?.state === "resolved" && cached.expiresAtMs > now) {
    return Promise.resolve(cached.value)
  }
  cache.delete(key)

  const setEntry = (entry: TimedCacheEntry<T>) => {
    cache.delete(key)
    cache.set(key, entry)
    trimResolvedEntries(cache, maxEntries)
  }

  const shouldCache = makeRoomForPendingEntry(cache, maxEntries)
  const promise = loader()
    .then((value) => {
      if (!shouldCache) return value
      const current = cache.get(key)
      if (current?.state === "pending" && current.promise === promise) {
        setEntry({ expiresAtMs: Date.now() + ttlMs, state: "resolved", value })
      }
      return value
    })
    .catch((error) => {
      if (!shouldCache) throw error
      const current = cache.get(key)
      if (current?.state === "pending" && current.promise === promise) {
        cache.delete(key)
      }
      throw error
    })
  if (shouldCache) setEntry({ state: "pending", promise })
  return promise
}

export async function cachedBoundedTtlBatchValues<T>({
  cacheByOwner,
  owner,
  keys,
  ttlMs,
  maxEntries,
  loader,
}: {
  cacheByOwner: WeakMap<object, BoundedTtlCache<T>>
  owner: object
  keys: readonly string[]
  ttlMs: number
  maxEntries: number
  loader: (missingKeys: readonly string[]) => Promise<readonly T[]>
}): Promise<T[]> {
  let cache = cacheByOwner.get(owner)
  if (!cache) {
    cache = new Map()
    cacheByOwner.set(owner, cache)
  }

  const now = Date.now()
  const pendingValues: Promise<T>[] = []
  const misses: Array<{
    cached: boolean
    key: string
    promise: Promise<T>
    reject: (error: unknown) => void
    resolve: (value: T) => void
  }> = []

  for (const key of keys) {
    const cached = cache.get(key)
    if (cached?.state === "pending") {
      pendingValues.push(cached.promise)
      continue
    }
    if (cached?.state === "resolved" && cached.expiresAtMs > now) {
      pendingValues.push(Promise.resolve(cached.value))
      continue
    }
    cache.delete(key)

    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const shouldCache = makeRoomForPendingEntry(cache, maxEntries)
    if (shouldCache) cache.set(key, { state: "pending", promise })
    misses.push({ cached: shouldCache, key, promise, reject, resolve })
    pendingValues.push(promise)
  }

  trimResolvedEntries(cache, maxEntries)

  if (misses.length > 0) {
    try {
      const loaded = await loader(misses.map(({ key }) => key))
      if (loaded.length !== misses.length) {
        throw new Error("Bounded TTL batch loader result count mismatch")
      }
      const resolvedAt = Date.now()
      for (const [index, miss] of misses.entries()) {
        const value = loaded[index] as T
        const current = miss.cached ? cache.get(miss.key) : null
        if (
          miss.cached &&
          current?.state === "pending" &&
          current.promise === miss.promise
        ) {
          cache.set(miss.key, {
            expiresAtMs: resolvedAt + ttlMs,
            state: "resolved",
            value,
          })
          trimResolvedEntries(cache, maxEntries)
        }
        miss.resolve(value)
      }
    } catch (error) {
      for (const miss of misses) {
        const current = miss.cached ? cache.get(miss.key) : null
        if (
          miss.cached &&
          current?.state === "pending" &&
          current.promise === miss.promise
        ) {
          cache.delete(miss.key)
        }
        miss.reject(error)
      }
    }
  }

  return Promise.all(pendingValues)
}
