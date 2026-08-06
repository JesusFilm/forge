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
