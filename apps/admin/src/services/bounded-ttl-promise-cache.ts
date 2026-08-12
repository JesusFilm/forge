type TimedCacheEntry<T> =
  | { expiresAtMs: number; state: "resolved"; value: T }
  | { expiresAtMs: number; state: "pending"; promise: Promise<T> }

export type BoundedTtlCache<T> = Map<string, TimedCacheEntry<T>>

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
  if (cached && cached.expiresAtMs > now) {
    return cached.state === "resolved"
      ? Promise.resolve(cached.value)
      : cached.promise
  }
  cache.delete(key)

  const setEntry = (entry: TimedCacheEntry<T>) => {
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      cache.delete(oldestKey)
    }
  }

  const promise = loader()
    .then((value) => {
      const current = cache.get(key)
      if (current?.state === "pending" && current.promise === promise) {
        setEntry({ expiresAtMs: Date.now() + ttlMs, state: "resolved", value })
      }
      return value
    })
    .catch((error) => {
      const current = cache.get(key)
      if (current?.state === "pending" && current.promise === promise) {
        cache.delete(key)
      }
      throw error
    })
  setEntry({ expiresAtMs: now + ttlMs, state: "pending", promise })
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
    key: string
    promise: Promise<T>
    reject: (error: unknown) => void
    resolve: (value: T) => void
  }> = []

  for (const key of keys) {
    const cached = cache.get(key)
    if (cached && cached.expiresAtMs > now) {
      pendingValues.push(
        cached.state === "resolved"
          ? Promise.resolve(cached.value)
          : cached.promise,
      )
      continue
    }
    cache.delete(key)

    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    cache.set(key, { expiresAtMs: now + ttlMs, state: "pending", promise })
    misses.push({ key, promise, reject, resolve })
    pendingValues.push(promise)
  }

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }

  if (misses.length > 0) {
    try {
      const loaded = await loader(misses.map(({ key }) => key))
      if (loaded.length !== misses.length) {
        throw new Error("Bounded TTL batch loader result count mismatch")
      }
      const resolvedAt = Date.now()
      for (const [index, miss] of misses.entries()) {
        const value = loaded[index] as T
        const current = cache.get(miss.key)
        if (current?.state === "pending" && current.promise === miss.promise) {
          cache.set(miss.key, {
            expiresAtMs: resolvedAt + ttlMs,
            state: "resolved",
            value,
          })
        }
        miss.resolve(value)
      }
    } catch (error) {
      for (const miss of misses) {
        const current = cache.get(miss.key)
        if (current?.state === "pending" && current.promise === miss.promise) {
          cache.delete(miss.key)
        }
        miss.reject(error)
      }
    }
  }

  return Promise.all(pendingValues)
}
